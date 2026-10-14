import { HttpsError, onCall } from "firebase-functions/https";
import { db, storage } from "../firebase.js";
import { assertOwnerScopeAccess, requireRole } from "../lib/auth.js";
import { nowIso } from "../lib/utils.js";
import type { AuthContext } from "../types.js";

type PaymentReceiptDeletionInput = {
  receiptId: string;
  receipt: Record<string, unknown>;
  actor: AuthContext;
};

type PaymentReceiptDeletionDependencies = {
  db: typeof db;
  storage: typeof storage;
};

export async function deletePaymentReceiptRecord(
  input: PaymentReceiptDeletionInput,
  dependencies: PaymentReceiptDeletionDependencies = { db, storage },
) {
  const storagePath = String(input.receipt.storagePath ?? "").trim();

  if (storagePath) {
    try {
      await dependencies.storage.bucket().file(storagePath).delete();
    } catch (error) {
      const code = Number((error as { code?: unknown })?.code);
      if (code !== 404) {
        throw new HttpsError(
          "internal",
          "No se pudo borrar el archivo del comprobante. Intenta nuevamente.",
        );
      }
    }
  }

  const batch = dependencies.db.batch();
  const receiptRef = dependencies.db
    .collection("paymentReceipts")
    .doc(input.receiptId);
  const auditRef = dependencies.db.collection("auditLogs").doc();
  const actorEmail = String(input.actor.profile.email ?? "");
  const actorName = String(
    input.actor.profile.displayName ?? actorEmail ?? "Administrador",
  );

  batch.delete(receiptRef);
  batch.set(auditRef, {
    action: "payment_receipt_deleted",
    entityType: "paymentReceipt",
    entityId: input.receiptId,
    summary: `Comprobante eliminado: ${String(input.receipt.fileName ?? input.receiptId)}`,
    metadata: {
      paymentId: String(input.receipt.paymentId ?? ""),
      tenantId: String(input.receipt.tenantId ?? ""),
      fileName: String(input.receipt.fileName ?? ""),
      storagePath,
    },
    actorUid: input.actor.uid,
    actorEmail,
    actorName: actorName || "Administrador",
    createdAt: nowIso(),
  });
  await batch.commit();

  return { ok: true, receiptId: input.receiptId };
}

export const deletePaymentReceipt = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const receiptId = String(
    (request.data as { receiptId?: unknown })?.receiptId ?? "",
  ).trim();
  if (!receiptId) {
    throw new HttpsError("invalid-argument", "receiptId es obligatorio.");
  }

  const receiptDoc = await db
    .collection("paymentReceipts")
    .doc(receiptId)
    .get();
  if (!receiptDoc.exists) {
    throw new HttpsError("not-found", "No existe el comprobante solicitado.");
  }

  const receipt = receiptDoc.data() ?? {};
  const propertyId = await resolveReceiptPropertyId(receipt);
  const actor = await assertOwnerScopeAccess(request, propertyId);

  return deletePaymentReceiptRecord({ receiptId, receipt, actor });
});

async function resolveReceiptPropertyId(receipt: Record<string, unknown>) {
  const paymentId = String(receipt.paymentId ?? "").trim();
  if (paymentId) {
    const paymentDoc = await db.collection("payments").doc(paymentId).get();
    const chargeId = String(paymentDoc.data()?.chargeId ?? "").trim();
    if (chargeId) {
      const chargeDoc = await db.collection("charges").doc(chargeId).get();
      const propertyId = String(chargeDoc.data()?.propertyId ?? "").trim();
      if (propertyId) {
        return propertyId;
      }
    }
  }

  const tenantId = String(receipt.tenantId ?? "").trim();
  if (tenantId) {
    const tenantDoc = await db.collection("tenants").doc(tenantId).get();
    const propertyId = String(tenantDoc.data()?.propertyId ?? "").trim();
    if (propertyId) {
      return propertyId;
    }
  }

  throw new HttpsError(
    "failed-precondition",
    "No se pudo determinar la unidad asociada al comprobante.",
  );
}
