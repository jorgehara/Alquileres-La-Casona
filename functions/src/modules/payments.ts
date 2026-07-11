import { createHmac, timingSafeEqual } from "node:crypto";
import { onCall, HttpsError, onRequest } from "firebase-functions/https";
import { db } from "../firebase.js";
import {
  backendBaseUrl,
  mercadoPagoAccessToken,
  mercadoPagoWebhookSecret,
  webAppUrl
} from "../config.js";
import { assertOwnerScopeAccess, requireRole, requireTenantOwner } from "../lib/auth.js";
import { nowIso } from "../lib/utils.js";
import { analyzeStoredReceipt } from "./documents.js";
import { generateAndSendPaymentReceiptInternal } from "./receipts.js";

export const submitTransferPayment = onCall(async (request) => {
  const data = request.data as {
    tenantId?: string;
    chargeId?: string;
    amountReported?: number;
    receiptIds?: string[];
  };

  if (!data.tenantId || !data.chargeId || !data.amountReported || !data.receiptIds?.length) {
    throw new HttpsError(
      "invalid-argument",
      "tenantId, chargeId, amountReported y receiptIds son obligatorios."
    );
  }

  await requireTenantOwner(request, data.tenantId);

  return processTransferPaymentSubmission({
    tenantId: data.tenantId,
    chargeId: data.chargeId,
    amountReported: Number(data.amountReported),
    receiptIds: data.receiptIds,
    createdBy: request.auth?.uid ?? "system"
  });
});

export const approveTransferPayment = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    paymentId?: string;
    chargeId?: string;
    amountConfirmed?: number;
  };

  if (!data.paymentId || !data.chargeId || !data.amountConfirmed) {
    throw new HttpsError(
      "invalid-argument",
      "paymentId, chargeId y amountConfirmed son obligatorios."
    );
  }

  const chargeDoc = await db.collection("charges").doc(data.chargeId).get();
  if (!chargeDoc.exists) {
    throw new HttpsError("not-found", "No existe el cobro indicado.");
  }

  const chargeData = chargeDoc.data() ?? {};
  const propertyId = String(chargeData.propertyId ?? "").trim();
  if (!propertyId) {
    throw new HttpsError("failed-precondition", "El cobro no tiene una unidad asociada.");
  }

  const paymentDoc = await db.collection("payments").doc(data.paymentId).get();
  const paymentData = paymentDoc.data() ?? {};

  await assertOwnerScopeAccess(request, propertyId);

  await db.collection("payments").doc(data.paymentId).set(
    {
      amountConfirmed: Number(data.amountConfirmed),
      status: "approved",
      approvedAt: nowIso(),
      approvedBy: request.auth?.uid ?? "system"
    },
    { merge: true }
  );

  await db.collection("charges").doc(data.chargeId).set(
    {
      status: "paid",
      paidAt: String(paymentData.reportedPaidAt ?? "").trim() || nowIso(),
      overdueDays: 0,
      lateFeeAmount: 0,
      total: Number(chargeData.subtotal ?? chargeData.total ?? 0),
      updatedAt: nowIso()
    },
    { merge: true }
  );

  let receiptResult: Record<string, unknown> | null = null;

  try {
    receiptResult = await generateAndSendPaymentReceiptInternal(data.paymentId, {
      sendEmail: true,
      actorUid: request.auth?.uid ?? "system",
      actorEmail: String(request.auth?.token.email ?? ""),
      actorName: String(request.auth?.token.email ?? "Administrador")
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el comprobante.";
    await db.collection("payments").doc(data.paymentId).set(
      {
        receiptStatus: "send_error",
        receiptError: message,
        updatedAt: nowIso()
      },
      { merge: true }
    );
    receiptResult = {
      ok: false,
      error: message
    };
  }

  return { ok: true, receipt: receiptResult };
});

export const createMercadoPagoCheckout = onCall(async (request) => {
  const data = request.data as {
    tenantId?: string;
    chargeId?: string;
  };

  if (!data.tenantId || !data.chargeId) {
    throw new HttpsError("invalid-argument", "tenantId y chargeId son obligatorios.");
  }

  await requireTenantOwner(request, data.tenantId);

  const chargeDoc = await db.collection("charges").doc(data.chargeId).get();
  if (!chargeDoc.exists) {
    throw new HttpsError("not-found", "No existe el cobro solicitado.");
  }

  const chargeData = chargeDoc.data() ?? {};
  if (String(chargeData.tenantId ?? "") !== data.tenantId) {
    throw new HttpsError("permission-denied", "El cobro no pertenece al inquilino indicado.");
  }

  if (["paid", "cancelled"].includes(String(chargeData.status ?? ""))) {
    throw new HttpsError("failed-precondition", "Este cobro ya no admite pagos.");
  }

  const checkoutAmount = Number(chargeData.total ?? 0);
  if (!Number.isFinite(checkoutAmount) || checkoutAmount <= 0) {
    throw new HttpsError("failed-precondition", "El cobro no tiene un importe válido.");
  }

  const accessToken = mercadoPagoAccessToken.value();
  const apiBaseUrl = backendBaseUrl.value();

  if (!accessToken) {
    throw new HttpsError(
      "failed-precondition",
      "Falta configurar MERCADO_PAGO_ACCESS_TOKEN."
    );
  }

  if (!apiBaseUrl) {
    throw new HttpsError(
      "failed-precondition",
      "Falta configurar BACKEND_BASE_URL."
    );
  }

  const existingPaymentsSnapshot = await db
    .collection("payments")
    .where("tenantId", "==", data.tenantId)
    .where("chargeId", "==", data.chargeId)
    .where("method", "==", "mercado_pago")
    .get();

  const reusablePaymentCandidates: Array<{
    ref: FirebaseFirestore.DocumentReference;
    id: string;
    status?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  }> = existingPaymentsSnapshot.docs
    .map((docSnap) => ({
      ref: docSnap.ref,
      id: docSnap.id,
      ...(docSnap.data() as Record<string, unknown>)
    }));

  const reusablePaymentDoc = reusablePaymentCandidates
    .sort((left, right) => Date.parse(String(right.updatedAt ?? right.createdAt ?? "")) - Date.parse(String(left.updatedAt ?? left.createdAt ?? "")))
    .find((payment) => !["approved", "provider_confirmed", "rejected"].includes(String(payment.status ?? "")));

  const paymentRef = reusablePaymentDoc?.ref ?? db.collection("payments").doc();
  const paymentId = reusablePaymentDoc?.id ?? paymentRef.id;

  if (!reusablePaymentDoc) {
    await paymentRef.set({
      tenantId: data.tenantId,
      chargeId: data.chargeId,
      method: "mercado_pago",
      amountReported: checkoutAmount,
      amountConfirmed: 0,
      status: "reported",
      createdAt: nowIso(),
      createdBy: request.auth?.uid ?? "system"
    });
  }

  const preferencePayload = {
    items: [
      {
        id: data.chargeId,
        title: `Alquiler ${chargeData.period ?? ""}`.trim(),
        quantity: 1,
        currency_id: "ARS",
        unit_price: checkoutAmount
      }
    ],
    external_reference: paymentId,
    notification_url: `${apiBaseUrl}/handleMercadoPagoWebhook`,
    back_urls: {
      success: `${webAppUrl.value()}/?mp_status=success`,
      failure: `${webAppUrl.value()}/?mp_status=failure`,
      pending: `${webAppUrl.value()}/?mp_status=pending`
    },
    auto_return: "approved",
    metadata: {
      paymentId,
      chargeId: data.chargeId,
      tenantId: data.tenantId
    }
  };

  const preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(preferencePayload)
  });

  if (!preferenceResponse.ok) {
    const errorBody = await preferenceResponse.text();
    throw new HttpsError(
      "internal",
      `Mercado Pago no pudo crear la preferencia: ${errorBody}`
    );
  }

  const preference = (await preferenceResponse.json()) as {
    id: string;
    init_point?: string;
    sandbox_init_point?: string;
  };

  await paymentRef.set(
    {
      mercadoPagoPreferenceId: preference.id,
      mercadoPagoStatus: "preference_created",
      checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? "",
      amountReported: checkoutAmount,
      amountConfirmed: 0,
      status: "reported",
      updatedAt: nowIso()
    },
    { merge: true }
  );

  return {
    ok: true,
    paymentId,
    checkoutMode: "checkout_pro",
    checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? "",
    providerConfigured: true
  };
});

export const handleMercadoPagoWebhook = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).send("Method Not Allowed");
    return;
  }

  const secret = mercadoPagoWebhookSecret.value();
  if (secret && !isValidMercadoPagoSignature(request, secret)) {
    response.status(401).json({ ok: false, error: "invalid_signature" });
    return;
  }

  const paymentId = String(request.body?.data?.id ?? request.body?.paymentId ?? "");
  if (!paymentId) {
    response.status(400).json({ ok: false, error: "missing_payment_id" });
    return;
  }

  const accessToken = mercadoPagoAccessToken.value();
  if (!accessToken) {
    response.status(500).json({ ok: false, error: "missing_access_token" });
    return;
  }

  const mpPaymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!mpPaymentResponse.ok) {
    response.status(502).json({ ok: false, error: "mercado_pago_lookup_failed" });
    return;
  }

  const mpPayment = (await mpPaymentResponse.json()) as {
    id: number;
    status?: string;
    status_detail?: string;
    external_reference?: string;
    transaction_amount?: number;
  };

  const internalPaymentId = String(mpPayment.external_reference ?? "");
  if (!internalPaymentId) {
    response.status(400).json({ ok: false, error: "missing_external_reference" });
    return;
  }

  const paymentDoc = await db.collection("payments").doc(internalPaymentId).get();
  if (!paymentDoc.exists) {
    response.status(404).json({ ok: false, error: "payment_not_found" });
    return;
  }

  const paymentData = paymentDoc.data() ?? {};
  const expectedAmount = Number(paymentData.amountReported ?? 0);
  const confirmedAmount = Number(mpPayment.transaction_amount ?? 0);
  const amountMatches = expectedAmount > 0 && Math.abs(confirmedAmount - expectedAmount) < 0.01;
  const isApproved = mpPayment.status === "approved" && amountMatches;

  await paymentDoc.ref.set(
    {
      status: isApproved ? "provider_confirmed" : "reported",
      amountConfirmed: isApproved
        ? Number(mpPayment.transaction_amount ?? paymentData.amountReported ?? 0)
        : 0,
      mercadoPagoPaymentId: String(mpPayment.id),
      mercadoPagoStatus: mpPayment.status ?? "unknown",
      mercadoPagoStatusDetail: mpPayment.status_detail ?? "",
      mercadoPagoAmountMatches: amountMatches,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  if (isApproved) {
    await db.collection("charges").doc(String(paymentData.chargeId)).set(
      {
        status: "paid",
        paidAt: nowIso(),
        overdueDays: 0,
        lateFeeAmount: 0,
        total: Number(paymentData.amountReported ?? paymentData.amountConfirmed ?? 0),
        updatedAt: nowIso()
      },
      { merge: true }
    );

    try {
      const receiptResult = await generateAndSendPaymentReceiptInternal(internalPaymentId, {
        sendEmail: true,
        actorUid: "mercado-pago-webhook",
        actorEmail: "",
        actorName: "Mercado Pago"
      });

      await paymentDoc.ref.set(
        {
          receiptStatus: String(receiptResult.status ?? "sent"),
          receiptError: "",
          updatedAt: nowIso()
        },
        { merge: true }
      );
    } catch (error) {
      await paymentDoc.ref.set(
        {
          receiptStatus: "send_error",
          receiptError: error instanceof Error ? error.message : "No se pudo generar el comprobante.",
          updatedAt: nowIso()
        },
        { merge: true }
      );
    }
  }

  response.json({ ok: true });
});

function isValidMercadoPagoSignature(
  request: {
    header(name: string): string | undefined;
    query: Record<string, unknown>;
    body?: { data?: { id?: unknown } };
  },
  secret: string
) {
  const signature = String(request.header("x-signature") ?? "");
  const requestId = String(request.header("x-request-id") ?? "");
  const dataId = String(request.query["data.id"] ?? request.body?.data?.id ?? "").toLowerCase();
  const signatureParts = new Map(
    signature
      .split(",")
      .map((part) => part.trim().split("=", 2))
      .filter((part) => part.length === 2)
      .map(([key, value]) => [key, value])
  );
  const timestamp = signatureParts.get("ts") ?? "";
  const receivedHash = signatureParts.get("v1") ?? "";

  if (!timestamp || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return false;
  }

  const manifest = [
    dataId ? `id:${dataId};` : "",
    requestId ? `request-id:${requestId};` : "",
    `ts:${timestamp};`
  ].join("");
  const expectedHash = createHmac("sha256", secret).update(manifest).digest("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const receivedBuffer = Buffer.from(receivedHash, "hex");

  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function resolveTransferAccounts(property: Record<string, unknown>) {
  const blockCode = String(property.transferBlock ?? inferTransferBlock(property.unitCode) ?? "block_1");
  const bankAccountsDoc = await db.collection("settings").doc("bankAccounts").get();
  const bankAccounts = bankAccountsDoc.data() ?? {};

  const block1 = buildTransferAccountProfile("block_1", bankAccounts.block_1, {
    holderName: "Enzo",
    alias: "ENZO.STEFANOFF",
    cbu: "3110001211000017138077"
  });
  const block2 = buildTransferAccountProfile("block_2", bankAccounts.block_2, {
    holderName: "Ivo",
    alias: "IVO.STEFANOFF2",
    cbu: "3110001211001029834072"
  });

  return {
    primary: blockCode === "block_2" ? block2 : block1,
    expenses: block1
  };
}

function buildTransferAccountProfile(
  blockCode: string,
  configured: Record<string, unknown> | undefined,
  fallback: { holderName: string; alias: string; cbu: string; }
) {
  return {
    blockCode,
    holderName: String(configured?.holderName ?? fallback.holderName).trim(),
    alias: String(configured?.alias ?? fallback.alias).trim(),
    cbu: String(configured?.cbu ?? fallback.cbu).trim()
  };
}

export async function processTransferPaymentSubmission(input: {
  tenantId: string;
  chargeId: string;
  amountReported: number;
  receiptIds: string[];
  createdBy: string;
}) {
  const chargeDoc = await db.collection("charges").doc(input.chargeId).get();
  if (!chargeDoc.exists) {
    throw new HttpsError("not-found", "No existe el cobro solicitado.");
  }

  const charge = chargeDoc.data() ?? {};
  if (String(charge.tenantId ?? "") !== input.tenantId) {
    throw new HttpsError("permission-denied", "Ese cobro no pertenece al inquilino actual.");
  }

  const tenantDoc = await db.collection("tenants").doc(input.tenantId).get();
  const tenant = tenantDoc.data() ?? {};
  const propertyId = String(tenant.propertyId ?? charge.propertyId ?? "");
  const propertyDoc = propertyId ? await db.collection("properties").doc(propertyId).get() : null;
  const property = propertyDoc?.data() ?? {};
  const accounts = await resolveTransferAccounts(property);
  const account = accounts.primary;
  const chargeTotal = Number(charge.total ?? 0);
  const chargeSubtotal = Number(charge.subtotal ?? chargeTotal);
  const amountReported = Number(input.amountReported);

  const receipts = await Promise.all(
    input.receiptIds.map(async (receiptId) => {
      const receiptDoc = await db.collection("paymentReceipts").doc(receiptId).get();
      if (!receiptDoc.exists) {
        throw new HttpsError("not-found", "Uno de los comprobantes no existe.");
      }

      const receipt = receiptDoc.data() ?? {};
      if (String(receipt.tenantId ?? "") !== input.tenantId) {
        throw new HttpsError("permission-denied", "Uno de los comprobantes no pertenece al inquilino.");
      }

      if (receipt.paymentId) {
        throw new HttpsError("failed-precondition", "Uno de los comprobantes ya fue usado en otro pago.");
      }

      const analyzed = await analyzeStoredReceipt(receiptId, receipt);
      await receiptDoc.ref.set(
        {
          ...analyzed.updates,
          expectedTransferBlock: account.blockCode,
          expectedAccountHolder: account.holderName,
          updatedAt: nowIso()
        },
        { merge: true }
      );

      return {
        id: receiptId,
        source: String(receipt.source ?? "").trim(),
        extracted: analyzed.result
      };
    })
  );

  const totalDetected = receipts.reduce(
    (sum, receipt) => sum + Number(receipt.extracted.amount ?? 0),
    0
  );
  const allHaveDate = receipts.every((receipt) =>
    Boolean(resolveReceiptPaidAtValue(receipt.extracted))
  );
  const detectedPaidAt = receipts
    .map((receipt) => resolveReceiptPaidAtValue(receipt.extracted))
    .filter(Boolean)
    .sort()[0] || null;
  const amountTolerance = receipts.reduce(
    (maxTolerance, receipt) => Math.max(maxTolerance, Number(receipt.extracted.amountTolerance ?? 1)),
    1
  );
  const chargeDueDate = String(charge.dueDate ?? "").trim();
  const clearsLateFee = wasPaymentMadeOnTime(detectedPaidAt, chargeDueDate);
  const validationExpectedAmount = clearsLateFee ? chargeSubtotal : chargeTotal;
  const isAdminManualUpload = receipts.every((receipt) => receipt.source === "admin_panel");
  const destinationMatches = validateTransferDestinations({
    receipts,
    property,
    charge,
    primaryAccount: account,
    expensesAccount: accounts.expenses,
    validationExpectedAmount,
    amountTolerance,
    clearsLateFee,
    allowEitherAccount: isAdminManualUpload
  });
  const amountMatches = Math.abs(totalDetected - validationExpectedAmount) <= amountTolerance;
  const reportedMatches = amountMatches
    || Math.abs(amountReported - totalDetected) <= Math.max(1, amountTolerance)
    || Math.abs(amountReported - validationExpectedAmount) <= Math.max(1, amountTolerance);

  if (!allHaveDate || !destinationMatches || !amountMatches || !reportedMatches) {
    return {
      ok: false,
      blocked: true,
      reason: buildTransferBlockReason({
        allHaveDate,
        destinationMatches,
        amountMatches,
        reportedMatches
      }),
      validation: {
        expectedAmount: validationExpectedAmount,
        totalDetected,
        amountTolerance,
        expectedAccountHolder: account.holderName,
        expectedAlias: account.alias,
        expectedCbu: account.cbu,
        allHaveDate,
        destinationMatches,
        amountMatches,
        reportedMatches
      }
    };
  }

  const paymentRef = await db.collection("payments").add({
    tenantId: input.tenantId,
    chargeId: input.chargeId,
    method: "transfer",
    amountReported,
    amountConfirmed: 0,
    status: "in_review",
    reportedPaidAt: detectedPaidAt,
    createdAt: nowIso(),
    createdBy: input.createdBy,
    validationStatus: "claude_passed",
    expectedTransferBlock: account.blockCode,
    expectedAccountHolder: account.holderName
  });

  await Promise.all(
    receipts.map((receipt, index) =>
      db.collection("paymentReceipts").doc(receipt.id).set(
        {
          paymentId: paymentRef.id,
          uploadOrder: index + 1,
          reviewSuggestion: "pending_manual_review",
          validationStatus: "claude_passed",
          updatedAt: nowIso()
        },
        { merge: true }
      )
    )
  );

  await db.collection("charges").doc(input.chargeId).set(
    clearsLateFee
      ? {
          status: "in_review",
          reportedPaidAt: detectedPaidAt,
          overdueDays: 0,
          lateFeeAmount: 0,
          total: chargeSubtotal,
          updatedAt: nowIso()
        }
      : {
          status: "in_review",
          reportedPaidAt: detectedPaidAt,
          updatedAt: nowIso()
        },
    { merge: true }
  );

  return { ok: true, paymentId: paymentRef.id };
}

function inferTransferBlock(unitCode: unknown) {
  const raw = String(unitCode ?? "").trim();
  const match = raw.match(/\d+/);
  const number = match ? Number(match[0]) : NaN;

  if (!Number.isNaN(number) && number >= 7) {
    return "block_2";
  }

  return "block_1";
}

function doesDestinationMatchAccount(destinationText: string, account: {
  holderName: string;
  alias: string;
  cbu: string;
}) {
  const normalizedDestination = normalize(destinationText);
  if (!normalizedDestination) {
    return false;
  }

  const candidates = [account.holderName, account.alias, account.cbu]
    .map((value) => normalize(value))
    .filter(Boolean);

  return candidates.some((candidate) => normalizedDestination.includes(candidate));
}

function validateTransferDestinations(input: {
  receipts: Array<{ extracted: Record<string, unknown> }>;
  property: Record<string, unknown>;
  charge: Record<string, unknown>;
  primaryAccount: { holderName: string; alias: string; cbu: string; };
  expensesAccount: { holderName: string; alias: string; cbu: string; };
  validationExpectedAmount: number;
  amountTolerance: number;
  clearsLateFee: boolean;
  allowEitherAccount: boolean;
}) {
  if (input.allowEitherAccount) {
    return input.receipts.every((receipt) => {
      const destinationText = String(receipt.extracted.destinationText ?? "");
      return (
        doesDestinationMatchAccount(destinationText, input.primaryAccount)
        || doesDestinationMatchAccount(destinationText, input.expensesAccount)
      );
    });
  }

  const allToPrimary = input.receipts.every((receipt) =>
    doesDestinationMatchAccount(String(receipt.extracted.destinationText ?? ""), input.primaryAccount)
  );

  if (allToPrimary) {
    return true;
  }

  if (
    !input.clearsLateFee
    || String(input.property.unitType ?? "").trim() !== "Departamento"
  ) {
    return false;
  }

  const rentAmount = resolveChargeItemAmount(input.charge, "rent");
  const expensesAmount = resolveChargeItemAmount(input.charge, "expenses");

  if (rentAmount <= 0 || expensesAmount <= 0) {
    return false;
  }

  const expectedBaseAmount = roundCurrency(rentAmount + expensesAmount);
  if (Math.abs(expectedBaseAmount - input.validationExpectedAmount) > input.amountTolerance) {
    return false;
  }

  let primaryDetected = 0;
  let expensesDetected = 0;

  for (const receipt of input.receipts) {
    const destinationText = String(receipt.extracted.destinationText ?? "");
    const detectedAmount = Number(receipt.extracted.amount ?? 0);

    if (!Number.isFinite(detectedAmount) || detectedAmount <= 0) {
      return false;
    }

    if (doesDestinationMatchAccount(destinationText, input.primaryAccount)) {
      primaryDetected += detectedAmount;
      continue;
    }

    if (doesDestinationMatchAccount(destinationText, input.expensesAccount)) {
      expensesDetected += detectedAmount;
      continue;
    }

    return false;
  }

  return (
    Math.abs(roundCurrency(primaryDetected) - rentAmount) <= input.amountTolerance
    && Math.abs(roundCurrency(expensesDetected) - expensesAmount) <= input.amountTolerance
    && Math.abs(roundCurrency(primaryDetected + expensesDetected) - input.validationExpectedAmount) <= input.amountTolerance
  );
}

function resolveChargeItemAmount(charge: Record<string, unknown>, key: string) {
  const items = Array.isArray(charge.items) ? charge.items : [];
  const item = items.find((entry) => String((entry as Record<string, unknown>).key ?? "") === key) as
    | Record<string, unknown>
    | undefined;
  const amount = Number(item?.amount ?? 0);
  return Number.isFinite(amount) && amount > 0 ? roundCurrency(amount) : 0;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildTransferBlockReason(checks: {
  allHaveDate: boolean;
  destinationMatches: boolean;
  amountMatches: boolean;
  reportedMatches: boolean;
}) {
  if (!checks.allHaveDate) {
    return "Claude no pudo leer la fecha del comprobante.";
  }

  if (!checks.destinationMatches) {
    return "El destino de la transferencia no coincide con la cuenta esperada para ese bloque.";
  }

  if (!checks.amountMatches || !checks.reportedMatches) {
    return "El monto detectado en los comprobantes no coincide con el total del cobro informado.";
  }

  return "No se pudo validar el comprobante.";
}

function resolveReceiptPaidAtValue(extracted: Record<string, unknown>) {
  const paidAt = String(extracted.paidAt ?? "").trim();
  if (paidAt) {
    return paidAt;
  }

  const date = String(extracted.date ?? "").trim();
  if (!date) {
    return "";
  }

  return `${date}T12:00:00`;
}

function wasPaymentMadeOnTime(paidAt: string | null, dueDate: string) {
  if (!paidAt || !dueDate) {
    return false;
  }

  const paidAtMs = new Date(paidAt).getTime();
  const dueAtMs = new Date(`${dueDate}T23:59:59`).getTime();

  if (Number.isNaN(paidAtMs) || Number.isNaN(dueAtMs)) {
    return false;
  }

  return paidAtMs <= dueAtMs;
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
