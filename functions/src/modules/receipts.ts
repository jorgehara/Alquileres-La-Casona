import { createHash } from "node:crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/https";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import nodemailer from "nodemailer";
import { db, storage } from "../firebase.js";
import {
  emailFrom,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpUser,
  webAppUrl
} from "../config.js";
import { assertOwnerScopeAccess, requireRole } from "../lib/auth.js";
import { nowIso, randomToken } from "../lib/utils.js";

type ReceiptStatus = "generated" | "sent" | "send_error" | "resent";
type ReceiptGenerationMode = {
  sendEmail?: boolean;
  regenerate?: boolean;
  actorUid?: string;
  actorEmail?: string;
  actorName?: string;
  actorRole?: string;
};

type ReceiptRecord = {
  receiptNumber: string;
  verificationCode: string;
  contentHash: string;
  paymentId: string;
  chargeId: string;
  tenantId: string;
  apartmentId: string;
  ownerId: string;
  ownerName: string;
  ownerDni: string;
  tenantName: string;
  tenantDni: string;
  apartmentLabel: string;
  amount: number;
  currency: string;
  period: string;
  paymentMethod: string;
  paymentStatus: string;
  effectivePaidAt: string;
  issuedAt: string;
  issuedBy: string;
  verificationUrl: string;
  pdfStoragePath: string;
  pdfUrl: string;
  emailStatus: "pending" | "sent" | "failed" | "not_requested";
  sentAt: string | null;
  resendCount: number;
  status: ReceiptStatus;
  lastError: string;
  emailHistory: Array<Record<string, unknown>>;
  regeneratedAt?: string;
  regeneratedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

type OwnerProfile = {
  id: string;
  fullName: string;
  dni: string;
  email: string;
  phone: string;
  transferBlock: string;
  alias: string;
  cbu: string;
};

const DEFAULT_OWNER_PROFILES = {
  block_1: {
    fullName: "Enzo",
    dni: "44086381"
  },
  block_2: {
    fullName: "Ivo",
    dni: "46147628"
  }
} as const;

export const sendPaymentReceipt = onCall(async (request) => {
  const claims = await requireRole(request, ["admin", "superadmin"]);
  const data = request.data as {
    paymentId?: string;
    regenerate?: boolean;
  };

  const paymentId = String(data.paymentId ?? "").trim();

  if (!paymentId) {
    throw new HttpsError("invalid-argument", "paymentId es obligatorio.");
  }

  const paymentDoc = await db.collection("payments").doc(paymentId).get();
  if (!paymentDoc.exists) {
    throw new HttpsError("not-found", "No existe el pago indicado.");
  }

  const payment = paymentDoc.data() ?? {};
  const chargeId = String(payment.chargeId ?? "").trim();
  if (!chargeId) {
    throw new HttpsError("failed-precondition", "El pago no tiene un cobro asociado.");
  }

  const chargeDoc = await db.collection("charges").doc(chargeId).get();
  if (!chargeDoc.exists) {
    throw new HttpsError("not-found", "No existe el cobro asociado al pago.");
  }

  const propertyId = String(chargeDoc.data()?.propertyId ?? "").trim();
  if (!propertyId) {
    throw new HttpsError("failed-precondition", "El cobro no tiene una unidad asociada.");
  }

  await assertOwnerScopeAccess(request, propertyId);

  return generateAndSendPaymentReceiptInternal(paymentId, {
    sendEmail: true,
    regenerate: Boolean(data.regenerate),
    actorUid: request.auth?.uid ?? "system",
    actorEmail: String(request.auth?.token.email ?? ""),
    actorName: String(request.auth?.token.email ?? "Administrador"),
    actorRole: claims.role
  });
});

export const verifyPaymentReceipt = onRequest(async (request, response) => {
  setPublicCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const code = String(request.query.code ?? "").trim().toUpperCase();

  if (!code) {
    response.status(400).json({ ok: false, error: "missing_code" });
    return;
  }

  const snapshot = await db
    .collection("rentReceipts")
    .where("verificationCode", "==", code)
    .limit(1)
    .get();

  if (snapshot.empty) {
    response.status(404).json({ ok: false, error: "not_found" });
    return;
  }

  const receipt = snapshot.docs[0].data() as Partial<ReceiptRecord>;

  response.json({
    ok: true,
    receipt: {
      receiptNumber: receipt.receiptNumber ?? "",
      ownerName: receipt.ownerName ?? "",
      tenantName: receipt.tenantName ?? "",
      apartmentLabel: receipt.apartmentLabel ?? "",
      amount: Number(receipt.amount ?? 0),
      currency: receipt.currency ?? "ARS",
      period: receipt.period ?? "",
      issuedAt: receipt.issuedAt ?? "",
      effectivePaidAt: receipt.effectivePaidAt ?? "",
      paymentId: receipt.paymentId ?? "",
      paymentMethod: receipt.paymentMethod ?? "",
      paymentStatus: receipt.paymentStatus ?? "",
      status: receipt.status ?? "generated",
      verificationCode: receipt.verificationCode ?? "",
      pdfUrl: receipt.pdfUrl ?? ""
    }
  });
});

export async function generateAndSendPaymentReceiptInternal(
  paymentId: string,
  mode: ReceiptGenerationMode = {}
) {
  const actorUid = mode.actorUid ?? "system";
  const actorEmail = mode.actorEmail ?? "";
  const actorName = mode.actorName ?? "Sistema";
  const receiptRef = db.collection("rentReceipts").doc(`payment_${paymentId}`);

  const paymentDoc = await db.collection("payments").doc(paymentId).get();
  if (!paymentDoc.exists) {
    throw new HttpsError("not-found", "No existe el pago indicado.");
  }

  const payment = paymentDoc.data() ?? {};
  const chargeId = String(payment.chargeId ?? "").trim();
  const tenantId = String(payment.tenantId ?? "").trim();

  if (!chargeId || !tenantId) {
    throw new HttpsError("failed-precondition", "El pago no tiene cobro o inquilino asociado.");
  }

  const normalizedPaymentStatus = String(payment.status ?? "");
  if (!["approved", "provider_confirmed"].includes(normalizedPaymentStatus)) {
    throw new HttpsError(
      "failed-precondition",
      "Solo se pueden emitir comprobantes para pagos confirmados."
    );
  }

  const [chargeDoc, tenantDoc, existingReceiptDoc] = await Promise.all([
    db.collection("charges").doc(chargeId).get(),
    db.collection("tenants").doc(tenantId).get(),
    receiptRef.get()
  ]);

  if (!chargeDoc.exists) {
    throw new HttpsError("not-found", "No existe el cobro asociado al pago.");
  }

  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino asociado al pago.");
  }

  const charge = chargeDoc.data() ?? {};
  const tenant = tenantDoc.data() ?? {};
  const propertyId = String(charge.propertyId ?? tenant.propertyId ?? "").trim();

  if (!propertyId) {
    throw new HttpsError("failed-precondition", "El pago no tiene una propiedad/unidad asociada.");
  }

  const propertyDoc = await db.collection("properties").doc(propertyId).get();
  if (!propertyDoc.exists) {
    throw new HttpsError("not-found", "No existe la propiedad asociada al pago.");
  }

  const property = propertyDoc.data() ?? {};
  const owner = await resolveOwnerForProperty(propertyDoc.id, property);
  const tenantName = String(tenant.fullName ?? "").trim();
  const tenantDni = String(tenant.dni ?? "").trim();
  const tenantEmail = String(tenant.email ?? "").trim().toLowerCase();
  const apartmentLabel = String(property.name ?? buildApartmentLabel(property)).trim();
  const amount = roundCurrency(
    Number(payment.amountConfirmed ?? 0) || Number(payment.amountReported ?? charge.total ?? 0)
  );
  const period = String(charge.period ?? "").trim();
  const currency = "ARS";
  const effectivePaidAt = resolveEffectivePaidAt(payment);

  const validationErrors = [
    owner.fullName ? null : "Falta el nombre del propietario/locador.",
    owner.dni ? null : "Falta el DNI del propietario/locador.",
    tenantName ? null : "Falta el nombre del inquilino.",
    tenantDni ? null : "Falta el DNI del inquilino.",
    apartmentLabel ? null : "Falta la unidad/departamento.",
    period ? null : "Falta el periodo del alquiler.",
    amount > 0 ? null : "El monto del pago es invalido.",
    mode.sendEmail !== false && tenantEmail ? null : "Falta el email del inquilino."
  ].filter(Boolean) as string[];

  if (validationErrors.length) {
    throw new HttpsError("failed-precondition", validationErrors.join(" "));
  }

  const existingReceipt = existingReceiptDoc.exists
    ? (existingReceiptDoc.data() as ReceiptRecord)
    : null;

  if (existingReceipt && !mode.regenerate) {
    if (mode.sendEmail === false) {
      return {
        ok: true,
        created: false,
        resent: false,
        receiptId: existingReceiptDoc.id,
        receiptNumber: existingReceipt.receiptNumber,
        verificationCode: existingReceipt.verificationCode,
        pdfUrl: existingReceipt.pdfUrl,
        status: existingReceipt.status
      };
    }

    const pdfBuffer = await downloadStoredPdf(existingReceipt.pdfStoragePath);
    const emailResult = await deliverReceiptEmail({
      tenantEmail,
      tenantName,
      receipt: existingReceipt,
      pdfBuffer
    });

    const resendCount = Number(existingReceipt.resendCount ?? 0) + 1;
    const nextStatus: ReceiptStatus = emailResult.ok ? "resent" : "send_error";

    await receiptRef.set(
      {
        resendCount,
        sentAt: emailResult.ok ? nowIso() : existingReceipt.sentAt ?? null,
        emailStatus: emailResult.ok ? "sent" : "failed",
        status: nextStatus,
        lastError: emailResult.ok ? "" : emailResult.errorMessage,
        updatedAt: nowIso(),
        emailHistory: [
          ...(Array.isArray(existingReceipt.emailHistory) ? existingReceipt.emailHistory : []),
          buildEmailHistoryEntry(emailResult.ok ? "resent" : "failed", actorUid, actorEmail, emailResult.errorMessage)
        ]
      },
      { merge: true }
    );

    await appendAuditLog({
      action: "receipt_resent",
      summary: `Reenvio el comprobante ${existingReceipt.receiptNumber}.`,
      entityId: receiptRef.id,
      actorUid,
      actorEmail,
      actorName,
      metadata: {
        paymentId,
        tenantId,
        receiptNumber: existingReceipt.receiptNumber
      }
    });

    return {
      ok: emailResult.ok,
      created: false,
      resent: true,
      receiptId: receiptRef.id,
      receiptNumber: existingReceipt.receiptNumber,
      verificationCode: existingReceipt.verificationCode,
      pdfUrl: existingReceipt.pdfUrl,
      status: nextStatus,
      error: emailResult.ok ? null : emailResult.errorMessage
    };
  }

  const receiptNumber = existingReceipt?.receiptNumber || await reserveReceiptNumber();
  const verificationCode = existingReceipt?.verificationCode || await reserveVerificationCode();
  const issuedAt = existingReceipt?.issuedAt || nowIso();
  const verificationUrl = `${webAppUrl.value()}/verificar-comprobante.html?code=${encodeURIComponent(verificationCode)}`;
  const contentHash = createReceiptHash({
    ownerId: owner.id,
    tenantId,
    apartmentId: propertyId,
    paymentId,
    amount,
    period,
    issuedAt
  });

  const qrBuffer = await QRCode.toBuffer(verificationUrl, {
    errorCorrectionLevel: "M",
    width: 220,
    margin: 1
  });

  const pdfBuffer = await buildReceiptPdf({
    receiptNumber,
    issuedAt,
    owner,
    tenant: {
      fullName: tenantName,
      dni: tenantDni
    },
    apartmentLabel,
    amount,
    currency,
    period,
    effectivePaidAt,
    paymentId,
    paymentMethod: String(payment.method ?? ""),
    verificationCode,
    verificationUrl,
    contentHash,
    qrBuffer
  });

  const fileName = `comprobante-${receiptNumber}.pdf`;
  const pdfStoragePath = `rent-receipts/${tenantId}/${receiptRef.id}/${fileName}`;
  const pdfUrl = await uploadReceiptPdf(pdfStoragePath, pdfBuffer);

  const receiptPayload: ReceiptRecord = {
    receiptNumber,
    verificationCode,
    contentHash,
    paymentId,
    chargeId,
    tenantId,
    apartmentId: propertyId,
    ownerId: owner.id,
    ownerName: owner.fullName,
    ownerDni: owner.dni,
    tenantName,
    tenantDni,
    apartmentLabel,
    amount,
    currency,
    period,
    paymentMethod: String(payment.method ?? ""),
    paymentStatus: normalizedPaymentStatus,
    effectivePaidAt,
    issuedAt,
    issuedBy: actorUid,
    verificationUrl,
    pdfStoragePath,
    pdfUrl,
    emailStatus: mode.sendEmail === false ? "not_requested" : "pending",
    sentAt: null,
    resendCount: Number(existingReceipt?.resendCount ?? 0),
    status: "generated",
    lastError: "",
    emailHistory: Array.isArray(existingReceipt?.emailHistory) ? existingReceipt.emailHistory : [],
    createdAt: existingReceipt?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };

  if (mode.regenerate && existingReceipt) {
    receiptPayload.regeneratedAt = nowIso();
    receiptPayload.regeneratedBy = actorUid;
  }

  let emailResult: { ok: boolean; errorMessage: string } = { ok: true, errorMessage: "" };

  if (mode.sendEmail !== false) {
    emailResult = await deliverReceiptEmail({
      tenantEmail,
      tenantName,
      receipt: receiptPayload,
      pdfBuffer
    });
    receiptPayload.emailStatus = emailResult.ok ? "sent" : "failed";
    receiptPayload.sentAt = emailResult.ok ? nowIso() : null;
    receiptPayload.status = emailResult.ok ? "sent" : "send_error";
    receiptPayload.lastError = emailResult.ok ? "" : emailResult.errorMessage;
    receiptPayload.emailHistory = [
      ...receiptPayload.emailHistory,
      buildEmailHistoryEntry(emailResult.ok ? "sent" : "failed", actorUid, actorEmail, emailResult.errorMessage)
    ];
  }

  await receiptRef.set(receiptPayload, { merge: true });

  await db.collection("payments").doc(paymentId).set(
    {
      receiptId: receiptRef.id,
      receiptNumber,
      receiptVerificationCode: verificationCode,
      receiptStatus: receiptPayload.status,
      receiptSentAt: receiptPayload.sentAt,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await appendAuditLog({
    action: mode.regenerate ? "receipt_regenerated" : "receipt_generated",
    summary: `${mode.regenerate ? "Regenero" : "Genero"} el comprobante ${receiptNumber}.`,
    entityId: receiptRef.id,
    actorUid,
    actorEmail,
    actorName,
    metadata: {
      paymentId,
      tenantId,
      ownerId: owner.id,
      verificationCode,
      emailed: mode.sendEmail !== false,
      emailStatus: receiptPayload.emailStatus
    }
  });

  return {
    ok: emailResult.ok,
    created: true,
    resent: false,
    receiptId: receiptRef.id,
    receiptNumber,
    verificationCode,
    pdfUrl,
    status: receiptPayload.status,
    error: emailResult.ok ? null : emailResult.errorMessage
  };
}

async function reserveReceiptNumber() {
  const now = new Date();
  const periodKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const counterRef = db.collection("counters").doc(`receipts_${periodKey}`);

  const nextValue = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = Number(snapshot.get("current") ?? 0);
    const next = current + 1;

    transaction.set(
      counterRef,
      {
        current: next,
        periodKey,
        updatedAt: nowIso()
      },
      { merge: true }
    );

    return next;
  });

  return `REC-${periodKey}-${String(nextValue).padStart(6, "0")}`;
}

async function reserveVerificationCode() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = `LC-${randomToken(8).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8)}`;
    const snapshot = await db
      .collection("rentReceipts")
      .where("verificationCode", "==", candidate)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return candidate;
    }
  }

  throw new HttpsError("internal", "No se pudo generar un codigo unico de verificacion.");
}

function createReceiptHash(input: {
  ownerId: string;
  tenantId: string;
  apartmentId: string;
  paymentId: string;
  amount: number;
  period: string;
  issuedAt: string;
}) {
  const payload = [
    input.ownerId,
    input.tenantId,
    input.apartmentId,
    input.paymentId,
    roundCurrency(input.amount).toFixed(2),
    input.period,
    input.issuedAt
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

async function resolveOwnerForProperty(propertyId: string, property: Record<string, unknown>) {
  const transferBlock = resolveTransferBlock(property);
  const ownerId = String(property.ownerId ?? "").trim() || inferOwnerId(transferBlock);
  const ownerRef = db.collection("owners").doc(ownerId);
  const ownerDoc = await ownerRef.get();
  const bankAccountsDoc = await db.collection("settings").doc("bankAccounts").get();
  const bankAccounts = bankAccountsDoc.data() ?? {};
  const bankProfile = transferBlock === "block_2"
    ? (bankAccounts.block_2 ?? {})
    : (bankAccounts.block_1 ?? {});
  const defaultOwner = transferBlock === "block_2"
    ? DEFAULT_OWNER_PROFILES.block_2
    : DEFAULT_OWNER_PROFILES.block_1;

  if (!ownerDoc.exists) {
    await ownerRef.set(
      {
        fullName: String(bankProfile.holderName ?? defaultOwner.fullName).trim(),
        dni: String(bankProfile.dni ?? defaultOwner.dni).trim(),
        email: String(bankProfile.email ?? "").trim().toLowerCase(),
        phone: String(bankProfile.phone ?? "").trim(),
        transferBlock,
        alias: String(bankProfile.alias ?? "").trim(),
        cbu: String(bankProfile.cbu ?? "").trim(),
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      { merge: true }
    );
  }

  if (!String(property.ownerId ?? "").trim()) {
    await db.collection("properties").doc(propertyId).set(
      {
        ownerId,
        updatedAt: nowIso()
      },
      { merge: true }
    );
  }

  const resolvedOwnerDoc = await ownerRef.get();
  const ownerData = resolvedOwnerDoc.data() ?? {};
  const resolvedDni = String(ownerData.dni ?? bankProfile.dni ?? defaultOwner.dni).trim();

  if (!String(ownerData.dni ?? "").trim() && resolvedDni) {
    await ownerRef.set(
      {
        dni: resolvedDni,
        updatedAt: nowIso()
      },
      { merge: true }
    );
  }

  return {
    id: ownerRef.id,
    fullName: String(ownerData.fullName ?? bankProfile.holderName ?? defaultOwner.fullName).trim(),
    dni: resolvedDni,
    email: String(ownerData.email ?? "").trim(),
    phone: String(ownerData.phone ?? "").trim(),
    transferBlock,
    alias: String(ownerData.alias ?? bankProfile.alias ?? "").trim(),
    cbu: String(ownerData.cbu ?? bankProfile.cbu ?? "").trim()
  } satisfies OwnerProfile;
}

function resolveTransferBlock(property: Record<string, unknown>) {
  const explicit = String(property.transferBlock ?? "").trim();
  if (explicit === "block_2") {
    return "block_2";
  }

  const unitCode = String(property.unitCode ?? "").trim();
  const match = unitCode.match(/\d+/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) && number >= 7 ? "block_2" : "block_1";
}

function inferOwnerId(transferBlock: string) {
  return transferBlock === "block_2" ? "owner_block_2" : "owner_block_1";
}

function buildApartmentLabel(property: Record<string, unknown>) {
  const unitType = String(property.unitType ?? "Unidad");
  const unitCode = String(property.unitCode ?? "");
  return `${unitType} ${unitCode}`.trim();
}

function resolveEffectivePaidAt(payment: Record<string, unknown>) {
  return String(
    payment.approvedAt
    ?? payment.providerConfirmedAt
    ?? payment.paidAt
    ?? payment.updatedAt
    ?? payment.createdAt
    ?? nowIso()
  );
}

async function buildReceiptPdf(input: {
  receiptNumber: string;
  issuedAt: string;
  owner: OwnerProfile;
  tenant: { fullName: string; dni: string };
  apartmentLabel: string;
  amount: number;
  currency: string;
  period: string;
  effectivePaidAt: string;
  paymentId: string;
  paymentMethod: string;
  verificationCode: string;
  verificationUrl: string;
  contentHash: string;
  qrBuffer: Buffer;
}) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: {
      Title: input.receiptNumber,
      Author: "La Casona Alquileres",
      Subject: "Comprobante de pago de alquiler"
    }
  });

  const chunks: Buffer[] = [];
  const streamPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const left = 56;
  const right = pageWidth - 56;
  const contentWidth = right - left;
  const green = "#173f2c";
  const greenSoft = "#edf4ef";
  const text = "#1f2933";
  const muted = "#697386";
  const line = "#e4e7ec";
  const shortVerificationUrl = "alquilereslacasona.com.ar/verificar";
  const cardGap = 20;
  const cardWidth = (contentWidth - cardGap) / 2;
  const cardsTop = 286;

  doc
    .fillColor(green)
    .font("Times-Italic")
    .fontSize(24)
    .text("La", left, 56, { width: 180, lineBreak: false });
  doc
    .font("Times-Roman")
    .fontSize(36)
    .text("Casona", left, 76, { width: 220 });
  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(10.5)
    .text("ALQUILERES", left + 2, 120, {
      width: 180,
      characterSpacing: 2.7
    });

  doc
    .fillColor(green)
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("Comprobante de pago", right - 240, 62, {
      width: 240,
      align: "right"
    });
  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(10.5)
    .text(`N.º ${input.receiptNumber}`, right - 240, 96, {
      width: 240,
      align: "right"
    })
    .text(`Emisión ${formatDateTimeCompact(input.issuedAt)}`, right - 240, 112, {
      width: 240,
      align: "right"
    });

  doc
    .moveTo(left, 148)
    .lineTo(right, 148)
    .lineWidth(1)
    .strokeColor(line)
    .stroke();

  doc
    .roundedRect(left, 172, contentWidth, 88, 18)
    .fillAndStroke(greenSoft, "#dce8df");

  const summaryWidth = contentWidth - 56;
  const summaryColumnWidth = summaryWidth / 3;
  const summaryX = left + 28;
  const summaryY = 194;

  drawSummaryMetric(doc, {
    x: summaryX,
    y: summaryY,
    width: summaryColumnWidth,
    label: "Monto recibido",
    value: formatCurrency(input.amount),
    emphasized: true
  });
  drawSummaryMetric(doc, {
    x: summaryX + summaryColumnWidth,
    y: summaryY,
    width: summaryColumnWidth,
    label: "Período",
    value: formatPeriod(input.period)
  });
  drawSummaryMetric(doc, {
    x: summaryX + summaryColumnWidth * 2,
    y: summaryY,
    width: summaryColumnWidth,
    label: "Medio de pago",
    value: humanizePaymentMethod(input.paymentMethod)
  });

  drawPartyCard(doc, {
    title: "Locador",
    x: left,
    y: cardsTop,
    width: cardWidth,
    rows: [
      ["Nombre", input.owner.fullName],
      ["DNI", formatDni(input.owner.dni)]
    ]
  });
  drawPartyCard(doc, {
    title: "Inquilino",
    x: left + cardWidth + cardGap,
    y: cardsTop,
    width: cardWidth,
    rows: [
      ["Nombre", input.tenant.fullName],
      ["DNI", formatDni(input.tenant.dni)],
      ["Unidad", input.apartmentLabel]
    ]
  });

  const statementTop = 444;
  const formalText = [
    "Por medio de la presente, yo,",
    `${input.owner.fullName}, DNI ${formatDni(input.owner.dni)},`,
    "en calidad de locador, dejo constancia de haber recibido de",
    `${input.tenant.fullName}, DNI ${formatDni(input.tenant.dni)},`,
    `la suma de ${formatCurrency(input.amount)},`,
    `en concepto de pago de alquiler correspondiente al período ${formatPeriod(input.period)},`,
    `respecto de la unidad ${input.apartmentLabel}.`
  ].join(" ");

  doc
    .roundedRect(left, statementTop + 4, 4, 104, 2)
    .fill(green);
  doc
    .fillColor(green)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Constancia", left + 20, statementTop, { width: contentWidth - 20 });
  doc
    .fillColor(text)
    .font("Helvetica")
    .fontSize(11.6)
    .text(formalText, left + 20, statementTop + 24, {
      width: contentWidth - 20,
      align: "justify",
      lineGap: 4
    });

  const verificationTop = 596;
  doc
    .moveTo(left, verificationTop)
    .lineTo(right, verificationTop)
    .lineWidth(1)
    .strokeColor(line)
    .stroke();
  doc
    .moveTo(left, verificationTop + 142)
    .lineTo(right, verificationTop + 142)
    .lineWidth(1)
    .strokeColor(line)
    .stroke();

  doc.image(input.qrBuffer, left, verificationTop + 22, { width: 104, height: 104 });
  doc
    .fillColor(green)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("Verificación digital", left + 128, verificationTop + 24, {
      width: contentWidth - 128
    });

  const badgeX = left + 128;
  const badgeY = verificationTop + 56;
  const badgeWidth = Math.min(150, Math.max(112, input.verificationCode.length * 8.6 + 22));
  doc
    .roundedRect(badgeX, badgeY, badgeWidth, 24, 12)
    .fill(greenSoft);
  doc
    .fillColor(green)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(input.verificationCode, badgeX, badgeY + 7, {
      width: badgeWidth,
      align: "center"
    });
  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(10.5)
    .text(
      "Este comprobante puede validarse escaneando el código QR o ingresando el código de verificación en el sitio oficial.",
      left + 128,
      verificationTop + 88,
      {
        width: contentWidth - 128,
        lineGap: 3
      }
    )
    .fillColor(green)
    .font("Helvetica-Bold")
    .text(shortVerificationUrl, left + 128, verificationTop + 122, {
      width: contentWidth - 128
    });

  doc
    .fillColor("#8a94a6")
    .font("Helvetica")
    .fontSize(8.4)
    .text(`ID interno del pago: ${input.paymentId}`, left, 758, {
      width: contentWidth
    })
    .text(`Hash de contenido: ${input.contentHash}`, left, 772, {
      width: contentWidth
    });

  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(10)
    .text(
      "La Casona Alquileres emite este comprobante como constancia digital verificable de pago.",
      left,
      805,
      { width: contentWidth, align: "center" }
    );

  doc.end();
  return streamPromise;
}

function drawSummaryMetric(doc: PDFKit.PDFDocument, input: {
  x: number;
  y: number;
  width: number;
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  doc
    .fillColor("#697386")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(input.label.toUpperCase(), input.x, input.y, {
      width: input.width,
      characterSpacing: 1
    });
  doc
    .fillColor("#173f2c")
    .font(input.emphasized ? "Helvetica-Bold" : "Helvetica-Bold")
    .fontSize(input.emphasized ? 22 : 13.5)
    .text(input.value, input.x, input.y + (input.emphasized ? 16 : 18), {
      width: input.width - 12
    });
}

function drawPartyCard(doc: PDFKit.PDFDocument, input: {
  title: string;
  x: number;
  y: number;
  width: number;
  rows: Array<[string, string]>;
}) {
  const headerHeight = 22;
  const rowHeight = 30;
  const height = 24 + headerHeight + (input.rows.length * rowHeight) + 8;

  doc
    .roundedRect(input.x, input.y, input.width, height, 16)
    .fillAndStroke("#ffffff", "#e4e7ec");
  doc
    .fillColor("#173f2c")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(input.title, input.x + 18, input.y + 18, { width: input.width - 36 });

  let rowY = input.y + 50;
  input.rows.forEach(([label, value], index) => {
    if (index > 0) {
      doc
        .moveTo(input.x + 18, rowY - 8)
        .lineTo(input.x + input.width - 18, rowY - 8)
        .lineWidth(1)
        .strokeColor("#f0f2f4")
        .stroke();
    }

    doc
      .fillColor("#697386")
      .font("Helvetica")
      .fontSize(10.2)
      .text(label, input.x + 18, rowY, {
        width: 82
      });
    doc
      .fillColor("#1f2933")
      .font("Helvetica-Bold")
      .fontSize(11.2)
      .text(value, input.x + 100, rowY, {
        width: input.width - 118
      });
    rowY += rowHeight;
  });
}

async function uploadReceiptPdf(storagePath: string, buffer: Buffer) {
  const downloadToken = randomToken(32);
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-cache",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    }
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
}

async function downloadStoredPdf(storagePath: string) {
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  const [buffer] = await file.download();
  return buffer;
}

async function deliverReceiptEmail(input: {
  tenantEmail: string;
  tenantName: string;
  receipt: ReceiptRecord;
  pdfBuffer: Buffer;
}) {
  const host = smtpHost.value();
  const user = smtpUser.value();
  const pass = smtpPass.value();
  const from = emailFrom.value();
  const port = Number(smtpPort.value() || 465);

  if (!host || !user || !pass || !from) {
    return { ok: false, errorMessage: "Falta configurar SMTP para el envio de comprobantes." };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from,
      to: input.tenantEmail,
      subject: `Comprobante de pago de alquiler - ${formatPeriod(input.receipt.period)}`,
      text: buildReceiptEmailText(input.tenantName, input.receipt),
      html: buildReceiptEmailHtml(input.tenantName, input.receipt),
      attachments: [
        {
          filename: `comprobante-${input.receipt.receiptNumber}.pdf`,
          content: input.pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });

    return { ok: true, errorMessage: "" };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "No se pudo enviar el comprobante por email."
    };
  }
}

function buildReceiptEmailText(tenantName: string, receipt: ReceiptRecord) {
  return [
    `Hola ${tenantName}:`,
    "",
    `Te enviamos el comprobante correspondiente al pago de alquiler del periodo ${formatPeriod(receipt.period)}.`,
    "",
    "Detalle:",
    `- Departamento/Unidad: ${receipt.apartmentLabel}`,
    `- Monto recibido: ${formatCurrency(receipt.amount)}`,
    `- Fecha de pago: ${formatDate(receipt.effectivePaidAt)}`,
    `- Numero de comprobante: ${receipt.receiptNumber}`,
    "",
    "Adjuntamos el recibo en formato PDF.",
    "",
    `Codigo de verificacion: ${receipt.verificationCode}`,
    `Verificacion online: ${receipt.verificationUrl}`,
    "",
    "Saludos,",
    "La Casona Alquileres"
  ].join("\n");
}

function buildReceiptEmailHtml(tenantName: string, receipt: ReceiptRecord) {
  return `
    <div style="margin:0;padding:24px;background:#f4f5f1;font-family:Arial,sans-serif;color:#17382f;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e9e4;">
        <div style="padding:24px 28px;background:#17382f;color:#f4f5f1;">
          <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.82;">La Casona Alquileres</div>
          <div style="font-size:28px;font-weight:700;margin-top:10px;">Comprobante de pago emitido</div>
        </div>
        <div style="padding:26px 28px;">
          <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;">Hola ${escapeHtml(tenantName)}, te enviamos el comprobante correspondiente al pago de alquiler del periodo <strong>${formatPeriod(receipt.period)}</strong>.</p>
          <div style="background:#f8f7f3;border:1px solid #e5e9e4;border-radius:18px;padding:18px 20px;margin-bottom:20px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#5f776c;">Detalle del comprobante</div>
            <div style="font-size:28px;font-weight:700;color:#17382f;margin-top:8px;">${formatCurrency(receipt.amount)}</div>
            <div style="margin-top:14px;font-size:14px;line-height:1.7;color:#37574b;">
              <div><strong>Unidad:</strong> ${escapeHtml(receipt.apartmentLabel)}</div>
              <div><strong>Fecha de pago:</strong> ${formatDate(receipt.effectivePaidAt)}</div>
              <div><strong>Numero:</strong> ${escapeHtml(receipt.receiptNumber)}</div>
              <div><strong>Codigo de verificacion:</strong> ${escapeHtml(receipt.verificationCode)}</div>
            </div>
          </div>
          <a href="${receipt.verificationUrl}" style="display:inline-block;background:#17382f;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:700;">Verificar comprobante</a>
          <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:#5f776c;">Adjuntamos el recibo en formato PDF. Tambien podes verificarlo online con el codigo o escaneando el QR incluido en el comprobante.</p>
        </div>
      </div>
    </div>
  `;
}

function buildEmailHistoryEntry(
  status: "sent" | "resent" | "failed",
  actorUid: string,
  actorEmail: string,
  errorMessage: string
) {
  return {
    status,
    actorUid,
    actorEmail,
    errorMessage,
    happenedAt: nowIso()
  };
}

async function appendAuditLog(input: {
  action: string;
  summary: string;
  entityId: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  metadata: Record<string, unknown>;
}) {
  await db.collection("auditLogs").add({
    action: input.action,
    entityType: "receipt",
    entityId: input.entityId,
    summary: input.summary,
    metadata: input.metadata,
    actorUid: input.actorUid,
    actorEmail: input.actorEmail,
    actorName: input.actorName,
    createdAt: nowIso()
  });
}

function setPublicCors(response: { set: (key: string, value: string) => unknown }) {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
}

function humanizePaymentMethod(method: string) {
  if (method === "mercado_pago") {
    return "Tarjeta / Mercado Pago";
  }

  if (method === "transfer") {
    return "Transferencia bancaria";
  }

  return "Medio no informado";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatDateTimeLong(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTimeCompact(value: string) {
  const date = new Date(value);
  const formatted = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return formatted.replace(",", " ·");
}

function formatPeriod(period: string) {
  if (!period || !period.includes("-")) {
    return period;
  }

  const [year, month] = period.split("-");
  const date = new Date(`${year}-${month}-01T00:00:00`);
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatDni(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  return new Intl.NumberFormat("es-AR").format(Number(digits));
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
