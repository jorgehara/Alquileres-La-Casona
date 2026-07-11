import {onCall, HttpsError} from "firebase-functions/https";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {financialBotApiSecret, financialBotApiUrl} from "./config.js";
import {db} from "./firebase.js";
import {requireRole, normalizeOwnerScope, transferBlockToOwnerScope} from "./lib/auth.js";
import {nowIso} from "./lib/utils.js";

const SYNCABLE_STATUSES = new Set(["approved", "provider_confirmed"]);

export const syncApprovedPaymentToFinance = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);
  const paymentId = String(request.data?.paymentId ?? "").trim();
  if (!paymentId) {
    throw new HttpsError("invalid-argument", "paymentId es obligatorio.");
  }

  return syncPayment(paymentId);
});

export const syncApprovedPaymentToFinanceOnUpdate = onDocumentUpdated(
  "payments/{paymentId}",
  async (event) => {
    const before = event.data?.before.data() ?? {};
    const after = event.data?.after.data() ?? {};
    const beforeStatus = String(before.status ?? "");
    const afterStatus = String(after.status ?? "");
    if (!SYNCABLE_STATUSES.has(afterStatus) || SYNCABLE_STATUSES.has(beforeStatus)) {
      return;
    }

    try {
      await syncPayment(event.params.paymentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo sincronizar con finanzas.";
      await event.data?.after.ref.set({
        financialSyncStatus: "error",
        financialSyncError: message,
        financialSyncUpdatedAt: nowIso()
      }, {merge: true});
      console.error("Financial sync failed", {paymentId: event.params.paymentId, error});
    }
  }
);

async function syncPayment(paymentId: string) {
  const paymentReference = db.collection("payments").doc(paymentId);
  const paymentDocument = await paymentReference.get();
  if (!paymentDocument.exists) {
    throw new HttpsError("not-found", "No existe el pago indicado.");
  }

  const payment = paymentDocument.data() ?? {};
  if (!SYNCABLE_STATUSES.has(String(payment.status ?? ""))) {
    throw new HttpsError("failed-precondition", "El pago todavía no está aprobado.");
  }

  const chargeId = String(payment.chargeId ?? "");
  const chargeDocument = chargeId ? await db.collection("charges").doc(chargeId).get() : null;
  const charge = chargeDocument?.data() ?? {};
  const propertyId = String(charge.propertyId ?? "");
  const tenantId = String(payment.tenantId ?? charge.tenantId ?? "");
  const [propertyDocument, tenantDocument] = await Promise.all([
    propertyId ? db.collection("properties").doc(propertyId).get() : null,
    tenantId ? db.collection("tenants").doc(tenantId).get() : null
  ]);
  const property = propertyDocument?.data() ?? {};
  const tenant = tenantDocument?.data() ?? {};
  const ownerScope = resolvePropertyOwnerScope(property);
  const amount = Number(payment.amountConfirmed ?? payment.amountReported ?? charge.total ?? 0);
  const date = resolvePaymentDate(payment);
  const apiUrl = financialBotApiUrl.value().replace(/\/$/, "");
  const secret = financialBotApiSecret.value();
  if (!apiUrl || !secret) {
    throw new Error("FINANCIAL_BOT_API_URL o FINANCIAL_BOT_API_SECRET no están configurados.");
  }

  const response = await fetch(`${apiUrl}/syncRentalPayment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-n8n-secret": secret
    },
    body: JSON.stringify({
      paymentId,
      ownerScope,
      amount,
      date,
      propertyId,
      propertyName: String(property.name ?? property.displayName ?? property.unitCode ?? "Propiedad"),
      tenantId,
      tenantName: String(tenant.name ?? tenant.fullName ?? tenant.email ?? "Inquilino"),
      method: String(payment.method ?? ""),
      period: String(charge.period ?? "")
    })
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || result.ok !== true) {
    throw new Error(String(result.error ?? `Finanzas respondió HTTP ${response.status}.`));
  }

  await paymentReference.set({
    financialSyncStatus: "synced",
    financialTransactionId: String(result.transactionId ?? ""),
    financialSyncError: "",
    financialSyncUpdatedAt: nowIso()
  }, {merge: true});

  return {
    ok: true,
    paymentId,
    transactionId: String(result.transactionId ?? ""),
    alreadySynced: result.alreadySynced === true
  };
}

function resolvePropertyOwnerScope(property: Record<string, unknown>): "enzo" | "ivo" {
  const scope = normalizeOwnerScope(property.ownerScope);
  if (scope === "enzo" || scope === "ivo") {
    return scope;
  }
  const ownerId = String(property.ownerId ?? "").toLowerCase();
  if (ownerId === "ivo" || ownerId === "owner_block_2") {
    return "ivo";
  }
  return transferBlockToOwnerScope(property.transferBlock) === "ivo" ? "ivo" : "enzo";
}

function resolvePaymentDate(payment: Record<string, unknown>): string {
  const value = String(payment.approvedAt ?? payment.updatedAt ?? nowIso());
  const parsed = new Date(value);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
