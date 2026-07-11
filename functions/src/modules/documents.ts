import { onCall, HttpsError } from "firebase-functions/https";
import { storage, db } from "../firebase.js";
import { claudeApiKey } from "../config.js";
import { requireRole } from "../lib/auth.js";
import { nowIso } from "../lib/utils.js";

export const extractUtilityBillData = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as { billId?: string };
  if (!data.billId) {
    throw new HttpsError("invalid-argument", "billId es obligatorio.");
  }

  const billDoc = await db.collection("utilityBills").doc(data.billId).get();
  if (!billDoc.exists) {
    throw new HttpsError("not-found", "No existe la factura solicitada.");
  }

  const bill = billDoc.data() ?? {};
  if (!bill.storagePath) {
    throw new HttpsError("failed-precondition", "La factura no tiene archivo asociado.");
  }

  const result = await analyzeFileWithClaude({
    storagePath: String(bill.storagePath),
    mediaType: String(bill.fileType ?? "application/pdf"),
    task: "utility_bill"
  });

  await billDoc.ref.set(
    {
      claudeStatus: "processed",
      amount: result.amount ?? bill.amount ?? null,
      dueDate: result.date ?? bill.dueDate ?? null,
      extractionSummary: result.summary,
      extractionConfidence: result.confidence,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  return { ok: true, providerConfigured: true, result };
});

export const extractPaymentReceiptData = onCall(async (request) => {
  await requireRole(request, ["tenant", "admin", "superadmin"]);

  const data = request.data as { receiptId?: string };
  if (!data.receiptId) {
    throw new HttpsError("invalid-argument", "receiptId es obligatorio.");
  }

  const receiptDoc = await db.collection("paymentReceipts").doc(data.receiptId).get();
  if (!receiptDoc.exists) {
    throw new HttpsError("not-found", "No existe el comprobante solicitado.");
  }

  const receipt = receiptDoc.data() ?? {};
  if (!receipt.storagePath) {
    throw new HttpsError("failed-precondition", "El comprobante no tiene archivo asociado.");
  }

  const receiptEvaluation = await analyzeStoredReceipt(String(receiptDoc.id), receipt);

  await receiptDoc.ref.set(
    {
      ...receiptEvaluation.updates,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  return {
    ok: true,
    providerConfigured: true,
    result: receiptEvaluation.result
  };
});

export async function analyzeStoredReceipt(receiptId: string, receipt?: Record<string, unknown>) {
  const resolvedReceipt = receipt
    ?? (await db.collection("paymentReceipts").doc(receiptId).get()).data()
    ?? {};

  if (!resolvedReceipt.storagePath) {
    throw new HttpsError("failed-precondition", "El comprobante no tiene archivo asociado.");
  }

  const extraction = await analyzeFileWithClaude({
    storagePath: String(resolvedReceipt.storagePath),
    mediaType: String(resolvedReceipt.fileType ?? "image/jpeg"),
    task: "payment_receipt"
  });

  let chargeAmount: number | null = null;
  let reviewSuggestion = "pending_manual_review";
  const amountTolerance = resolveReceiptAmountTolerance(extraction);

  if (resolvedReceipt.paymentId) {
    const paymentDoc = await db.collection("payments").doc(String(resolvedReceipt.paymentId)).get();
    const payment = paymentDoc.data() ?? {};
    if (payment.chargeId) {
      const chargeDoc = await db.collection("charges").doc(String(payment.chargeId)).get();
      const charge = chargeDoc.data() ?? {};
      chargeAmount = Number(charge.total ?? 0);
    }
  }

  if (chargeAmount && extraction.amount) {
    const difference = Math.abs(chargeAmount - extraction.amount);
    reviewSuggestion = difference <= amountTolerance ? "likely_match" : "amount_mismatch";
  }

  return {
    updates: {
      claudeExtractionStatus: "processed",
      detectedAmount: extraction.amount,
      detectedDate: extraction.date,
      detectedTime: extraction.time,
      detectedPaidAt: extraction.paidAt,
      detectedDestination: extraction.destinationText,
      detectedDocumentType: extraction.documentType,
      extractionSummary: extraction.summary,
      extractionConfidence: extraction.confidence,
      reviewSuggestion
    },
    result: {
      ...extraction,
      reviewSuggestion,
      chargeAmount,
      amountTolerance
    }
  };
}

async function analyzeFileWithClaude(input: {
  storagePath: string;
  mediaType: string;
  task: "payment_receipt" | "utility_bill";
}) {
  const apiKey = claudeApiKey.value();
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "Falta configurar CLAUDE_API_KEY.");
  }

  const [fileBuffer] = await storage.bucket().file(input.storagePath).download();
  const base64Data = fileBuffer.toString("base64");

  const source =
    input.mediaType === "application/pdf"
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64Data
          }
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: normalizeImageMediaType(input.mediaType),
            data: base64Data
          }
        };

  const prompt =
    input.task === "payment_receipt"
      ? "Analiza este comprobante de pago. Puede ser una transferencia digital, una captura bancaria o un ticket fisico de deposito en efectivo. Responde solo JSON con estas claves exactas: amount, date, time, destinationText, documentType, confidence, summary. amount debe ser numero o null. date debe ser YYYY-MM-DD o null. time debe ser HH:mm:ss, HH:mm o null si aparece visible. destinationText debe ser string corto o null e incluir cualquier dato visible del destino: titular, alias, CBU, numero de cuenta, CUIL o banco si aparece. documentType debe ser uno de: transfer_receipt, cash_deposit_ticket, bank_receipt, unknown. Si ves frases como 'Deposito en Efectivo', 'caja', 'ticket', 'sucursal' o un comprobante impreso de banco, usa cash_deposit_ticket. confidence debe ser numero entre 0 y 1. summary debe ser una frase corta en espanol describiendo el comprobante. Si la hora no se ve con claridad, devuelve null."
      : "Analiza esta factura de servicio. Responde solo JSON con estas claves exactas: amount, date, destinationText, confidence, summary. amount debe ser numero o null. date debe ser YYYY-MM-DD o null. destinationText debe ser null. confidence debe ser numero entre 0 y 1. summary debe ser una frase corta en espanol.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            source,
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new HttpsError("internal", `Claude no pudo analizar el archivo: ${errorBody}`);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };

  const textBlock = payload.content?.find((item) => item.type === "text")?.text ?? "";
  const parsed = safeJsonParse(textBlock);

  return {
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    date: typeof parsed.date === "string" ? parsed.date : null,
    time: typeof parsed.time === "string" ? parsed.time : null,
    paidAt: buildDetectedPaidAtValue(
      typeof parsed.date === "string" ? parsed.date : null,
      typeof parsed.time === "string" ? parsed.time : null
    ),
    destinationText: typeof parsed.destinationText === "string" ? parsed.destinationText : null,
    documentType: typeof parsed.documentType === "string" ? parsed.documentType : "unknown",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    summary: typeof parsed.summary === "string" ? parsed.summary : "Sin resumen generado."
  };
}

function buildDetectedPaidAtValue(date: string | null, time: string | null) {
  if (!date) {
    return null;
  }

  if (!time) {
    return `${date}T12:00:00`;
  }

  const normalizedTime = /^\d{2}:\d{2}$/.test(time)
    ? `${time}:00`
    : time;

  return `${date}T${normalizedTime}`;
}

function resolveReceiptAmountTolerance(extraction: {
  documentType?: string;
  confidence?: number;
}) {
  if (String(extraction.documentType ?? "") === "cash_deposit_ticket") {
    return 50;
  }

  if (Number(extraction.confidence ?? 0) < 0.6) {
    return 5;
  }

  return 1;
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeImageMediaType(mediaType: string): string {
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  return allowed.includes(mediaType) ? mediaType : "image/jpeg";
}
