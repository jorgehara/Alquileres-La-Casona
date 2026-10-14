import { HttpsError, onCall } from "firebase-functions/https";
import type { CallableRequest } from "firebase-functions/https";
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

type StoredRecord = {
  id: string;
  data: Record<string, unknown>;
};

type PaymentSubmissionDeletionInput = {
  paymentId: string;
  payment: Record<string, unknown>;
  charge: Record<string, unknown>;
  paymentReceipts: StoredRecord[];
  rentReceipts: StoredRecord[];
  remainingPayments: StoredRecord[];
  actor: AuthContext;
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
  const linkedPaymentId = String(receipt.paymentId ?? "").trim();
  if (linkedPaymentId) {
    return deletePaymentSubmissionForRequest(request, linkedPaymentId);
  }

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

export async function deletePaymentSubmissionRecord(
  input: PaymentSubmissionDeletionInput,
  dependencies: PaymentReceiptDeletionDependencies = { db, storage },
) {
  const storagePaths = [
    ...input.paymentReceipts.map((receipt) =>
      String(receipt.data.storagePath ?? "").trim(),
    ),
    ...input.rentReceipts.map((receipt) =>
      String(receipt.data.pdfStoragePath ?? "").trim(),
    ),
  ].filter((path, index, paths) => path && paths.indexOf(path) === index);

  for (const storagePath of storagePaths) {
    try {
      await dependencies.storage.bucket().file(storagePath).delete();
    } catch (error) {
      const code = Number((error as { code?: unknown })?.code);
      if (code !== 404) {
        throw new HttpsError(
          "internal",
          "No se pudieron borrar los archivos del pago. Intenta nuevamente.",
        );
      }
    }
  }

  const activePayments = input.remainingPayments.filter(
    (payment) => String(payment.data.status ?? "") !== "rejected",
  );
  const confirmedPayment = activePayments.find((payment) =>
    ["approved", "provider_confirmed"].includes(
      String(payment.data.status ?? ""),
    ),
  );
  const reviewPayment = activePayments.find((payment) =>
    ["reported", "in_review"].includes(String(payment.data.status ?? "")),
  );
  const chargeStatus = confirmedPayment
    ? "paid"
    : reviewPayment
      ? "in_review"
      : "pending";
  const effectivePaidAt = confirmedPayment
    ? String(
        confirmedPayment.data.reportedPaidAt ??
          confirmedPayment.data.providerConfirmedAt ??
          confirmedPayment.data.approvedAt ??
          "",
      ).trim() || null
    : null;
  const reportedPaidAt = reviewPayment
    ? String(reviewPayment.data.reportedPaidAt ?? "").trim() || null
    : effectivePaidAt;
  const chargeId = String(input.payment.chargeId ?? "").trim();
  const batch = dependencies.db.batch();

  for (const receipt of input.paymentReceipts) {
    batch.delete(
      dependencies.db.collection("paymentReceipts").doc(receipt.id),
    );
  }
  for (const receipt of input.rentReceipts) {
    batch.delete(dependencies.db.collection("rentReceipts").doc(receipt.id));
  }
  batch.delete(dependencies.db.collection("payments").doc(input.paymentId));
  batch.set(
    dependencies.db.collection("charges").doc(chargeId),
    {
      status: chargeStatus,
      paidAt: effectivePaidAt,
      reportedPaidAt,
      updatedAt: nowIso(),
    },
    { merge: true },
  );

  const auditRef = dependencies.db.collection("auditLogs").doc();
  const actorEmail = String(input.actor.profile.email ?? "");
  const actorName = String(
    input.actor.profile.displayName ?? actorEmail ?? "Administrador",
  );
  batch.set(auditRef, {
    action: "payment_deleted",
    entityType: "payment",
    entityId: input.paymentId,
    summary: `Pago duplicado o erróneo eliminado: ${input.paymentId}`,
    metadata: {
      chargeId,
      tenantId: String(input.payment.tenantId ?? ""),
      paymentStatus: String(input.payment.status ?? ""),
      previousChargeStatus: String(input.charge.status ?? ""),
      paymentReceiptIds: input.paymentReceipts.map((receipt) => receipt.id),
      rentReceiptIds: input.rentReceipts.map((receipt) => receipt.id),
      financialSyncStatus: String(input.payment.financialSyncStatus ?? ""),
      financialTransactionId: String(
        input.payment.financialTransactionId ?? "",
      ),
      resultingChargeStatus: chargeStatus,
    },
    actorUid: input.actor.uid,
    actorEmail,
    actorName: actorName || "Administrador",
    createdAt: nowIso(),
  });
  await batch.commit();

  return {
    ok: true,
    paymentId: input.paymentId,
    chargeId,
    chargeStatus,
    deletedPaymentReceipts: input.paymentReceipts.length,
    deletedRentReceipts: input.rentReceipts.length,
    financeReversalRequired:
      String(input.payment.financialSyncStatus ?? "") === "synced",
  };
}

export const deletePaymentSubmission = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const paymentId = String(
    (request.data as { paymentId?: unknown })?.paymentId ?? "",
  ).trim();
  if (!paymentId) {
    throw new HttpsError("invalid-argument", "paymentId es obligatorio.");
  }

  return deletePaymentSubmissionForRequest(request, paymentId);
});

async function deletePaymentSubmissionForRequest(
  request: CallableRequest,
  paymentId: string,
) {
  const paymentDoc = await db.collection("payments").doc(paymentId).get();
  if (!paymentDoc.exists) {
    throw new HttpsError("not-found", "No existe el pago solicitado.");
  }

  const payment = paymentDoc.data() ?? {};
  const chargeId = String(payment.chargeId ?? "").trim();
  if (!chargeId) {
    throw new HttpsError(
      "failed-precondition",
      "El pago no tiene un cobro mensual asociado.",
    );
  }

  const chargeDoc = await db.collection("charges").doc(chargeId).get();
  if (!chargeDoc.exists) {
    throw new HttpsError("not-found", "No existe el cobro mensual asociado.");
  }

  const charge = chargeDoc.data() ?? {};
  const propertyId = String(charge.propertyId ?? "").trim();
  if (!propertyId) {
    throw new HttpsError(
      "failed-precondition",
      "El cobro mensual no tiene una unidad asociada.",
    );
  }
  const actor = await assertOwnerScopeAccess(request, propertyId);

  const [paymentReceiptsSnapshot, rentReceiptsSnapshot, paymentsSnapshot] =
    await Promise.all([
      db
        .collection("paymentReceipts")
        .where("paymentId", "==", paymentId)
        .get(),
      db.collection("rentReceipts").where("paymentId", "==", paymentId).get(),
      db.collection("payments").where("chargeId", "==", chargeId).get(),
    ]);

  return deletePaymentSubmissionRecord({
    paymentId,
    payment,
    charge,
    paymentReceipts: paymentReceiptsSnapshot.docs.map((receipt) => ({
      id: receipt.id,
      data: receipt.data(),
    })),
    rentReceipts: rentReceiptsSnapshot.docs.map((receipt) => ({
      id: receipt.id,
      data: receipt.data(),
    })),
    remainingPayments: paymentsSnapshot.docs
      .filter((otherPayment) => otherPayment.id !== paymentId)
      .map((otherPayment) => ({
        id: otherPayment.id,
        data: otherPayment.data(),
      })),
    actor,
  });
}
