import { onCall } from "firebase-functions/https";
import { db } from "../firebase.js";
import {
  normalizeOwnerScope,
  requireRole,
  transferBlockToOwnerScope,
} from "../lib/auth.js";
import { deriveChargeState } from "../lib/chargeState.js";

type ScopedOwner = "all" | "enzo" | "ivo";

function normalizeTransferBlock(value: unknown): "block_1" | "block_2" | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "block_1" || normalized === "block_2") {
    return normalized;
  }

  return null;
}

function inferTransferBlockFromNumeric(
  value: unknown,
): "block_1" | "block_2" | null {
  const match = String(value ?? "").match(/\d+/);
  const number = match ? Number(match[0]) : Number.NaN;
  if (!Number.isFinite(number)) {
    return null;
  }

  return number >= 7 ? "block_2" : "block_1";
}

function inferTransferBlockFromProperty(property: Record<string, unknown>) {
  const explicitTransferBlock = normalizeTransferBlock(property.transferBlock);
  if (explicitTransferBlock) {
    return {
      transferBlock: explicitTransferBlock,
      reason: "transferBlock",
    } as const;
  }

  const billingBlock = normalizeTransferBlock(
    property.billingBlock ?? property.blockId,
  );
  if (billingBlock) {
    return {
      transferBlock: billingBlock,
      reason: "billingBlock",
    } as const;
  }

  const ownerId = String(property.ownerId ?? "")
    .trim()
    .toLowerCase();
  if (ownerId === "owner_block_1") {
    return {
      transferBlock: "block_1",
      reason: "ownerId",
    } as const;
  }
  if (ownerId === "owner_block_2") {
    return {
      transferBlock: "block_2",
      reason: "ownerId",
    } as const;
  }

  const ownerScope = normalizeOwnerScope(property.ownerScope);
  if (ownerScope === "enzo" || ownerScope === "ivo") {
    return {
      transferBlock: ownerScope === "ivo" ? "block_2" : "block_1",
      reason: "ownerScope",
    } as const;
  }

  const unitCodeBlock = inferTransferBlockFromNumeric(property.unitCode);
  if (unitCodeBlock) {
    return {
      transferBlock: unitCodeBlock,
      reason: "unitCode",
    } as const;
  }

  const sortOrderBlock = inferTransferBlockFromNumeric(property.sortOrder);
  if (sortOrderBlock) {
    return {
      transferBlock: sortOrderBlock,
      reason: "sortOrder",
    } as const;
  }

  const fallbackFields = [
    property.name,
    property.displayName,
    property.label,
    property.title,
  ];
  for (const value of fallbackFields) {
    const inferred = inferTransferBlockFromNumeric(value);
    if (inferred) {
      return {
        transferBlock: inferred,
        reason: "name",
      } as const;
    }
  }

  return {
    transferBlock: "block_1",
    reason: "default",
  } as const;
}

function resolvePropertyScope(property: Record<string, unknown>): ScopedOwner {
  const ownerScope = normalizeOwnerScope(property.ownerScope);
  if (ownerScope === "enzo" || ownerScope === "ivo") {
    return ownerScope;
  }

  const ownerId = String(property.ownerId ?? "")
    .trim()
    .toLowerCase();
  if (ownerId === "enzo" || ownerId === "owner_block_1") {
    return "enzo";
  }
  if (ownerId === "ivo" || ownerId === "owner_block_2") {
    return "ivo";
  }

  return transferBlockToOwnerScope(
    inferTransferBlockFromProperty(property).transferBlock,
  );
}

function mapSnapshotDoc<T extends Record<string, unknown>>(
  doc:
    | FirebaseFirestore.QueryDocumentSnapshot
    | FirebaseFirestore.DocumentSnapshot,
) {
  return {
    id: doc.id,
    ...(doc.data() ?? {}),
  } as T & { id: string };
}

export const getScopedAdminDataset = onCall(async (request) => {
  const claims = await requireRole(request, ["admin", "superadmin"]);
  const currentScope =
    claims.role === "superadmin"
      ? "all"
      : normalizeOwnerScope(claims.ownerScope);

  const [
    propertiesSnapshot,
    tenantsSnapshot,
    chargesSnapshot,
    paymentsSnapshot,
    paymentReceiptsSnapshot,
    rentReceiptsSnapshot,
    messagesSnapshot,
    rentAdjustmentsSnapshot,
    rentAdjustmentPoliciesSnapshot,
    generalSettingsSnapshot,
  ] = await Promise.all([
    db.collection("properties").get(),
    db.collection("tenants").get(),
    db.collection("charges").get(),
    db.collection("payments").get(),
    db.collection("paymentReceipts").get(),
    db.collection("rentReceipts").get(),
    db.collection("messages").get(),
    db
      .collection("rentAdjustments")
      .orderBy("createdAt", "desc")
      .limit(40)
      .get(),
    db.collection("rentAdjustmentPolicies").get(),
    db.collection("settings").doc("general").get(),
  ]);

  const allProperties = propertiesSnapshot.docs.map((doc) =>
    mapSnapshotDoc<Record<string, unknown>>(doc),
  );
  const propertyDiagnostics = allProperties.map((property) => {
    const inferred = inferTransferBlockFromProperty(property);
    return {
      id: property.id,
      name: String(
        property.name ??
          property.displayName ??
          property.label ??
          property.unitCode ??
          property.id,
      ),
      unitType: String(property.unitType ?? ""),
      unitCode: String(property.unitCode ?? ""),
      ownerId: String(property.ownerId ?? ""),
      ownerScope: String(property.ownerScope ?? ""),
      transferBlock: String(
        property.transferBlock ??
          property.billingBlock ??
          property.blockId ??
          "",
      ),
      sortOrder: String(property.sortOrder ?? ""),
      resolvedScope: resolvePropertyScope(property),
      inferenceReason: inferred.reason,
    };
  });

  const properties = allProperties.filter(
    (property) =>
      currentScope === "all" || resolvePropertyScope(property) === currentScope,
  );

  const propertyIds = new Set(properties.map((property) => property.id));

  const tenants = tenantsSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter((tenant) => propertyIds.has(String(tenant.propertyId ?? "")));

  const tenantIds = new Set(tenants.map((tenant) => tenant.id));
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const morosoAfterDays = Math.max(
    1,
    Number(generalSettingsSnapshot.get("morosoAfterDays") ?? 15),
  );

  const charges = chargesSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter((charge) => propertyIds.has(String(charge.propertyId ?? "")))
    .map((charge) => ({
      ...charge,
      derivedChargeState: deriveChargeState({
        status: charge.status,
        dueDate: charge.dueDate,
        overdueDays: charge.overdueDays,
        morosoAfterDays,
        contractStartDate: tenantsById.get(String(charge.tenantId ?? ""))
          ?.contractStartDate,
        period: charge.period,
      }),
    }));

  const chargeIds = new Set(charges.map((charge) => charge.id));

  const payments = paymentsSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter(
      (payment) =>
        chargeIds.has(String(payment.chargeId ?? "")) ||
        tenantIds.has(String(payment.tenantId ?? "")),
    );

  const paymentIds = new Set(payments.map((payment) => payment.id));

  const paymentReceipts = paymentReceiptsSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter(
      (receipt) =>
        paymentIds.has(String(receipt.paymentId ?? "")) ||
        tenantIds.has(String(receipt.tenantId ?? "")),
    );

  const rentReceipts = rentReceiptsSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter((receipt) => {
      if (
        paymentIds.has(String(receipt.paymentId ?? "")) ||
        tenantIds.has(String(receipt.tenantId ?? ""))
      ) {
        return true;
      }

      if (currentScope === "all") {
        return true;
      }

      const ownerScope = normalizeOwnerScope(
        receipt.ownerScope ??
          receipt.ownerId ??
          transferBlockToOwnerScope(receipt.transferBlock),
      );
      return ownerScope === currentScope;
    });

  const messages = messagesSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter((message) => tenantIds.has(String(message.tenantId ?? "")));

  const rentAdjustments = rentAdjustmentsSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter((adjustment) => {
      if (currentScope === "all") {
        return true;
      }

      const ownerScope = normalizeOwnerScope(adjustment.ownerScope);
      return ownerScope === currentScope;
    });

  const rentAdjustmentPolicies = rentAdjustmentPoliciesSnapshot.docs
    .map((doc) => mapSnapshotDoc<Record<string, unknown>>(doc))
    .filter((policy) => {
      if (currentScope === "all") {
        return true;
      }

      const ownerScope = normalizeOwnerScope(policy.ownerScope);
      return ownerScope === currentScope || ownerScope === "all";
    });

  const diagnosticSummary = propertyDiagnostics.reduce(
    (summary, property) => {
      summary.total += 1;
      if (property.resolvedScope === "enzo") {
        summary.enzo += 1;
      } else if (property.resolvedScope === "ivo") {
        summary.ivo += 1;
      } else {
        summary.all += 1;
      }

      summary.byReason[property.inferenceReason] =
        (summary.byReason[property.inferenceReason] ?? 0) + 1;
      return summary;
    },
    {
      total: 0,
      enzo: 0,
      ivo: 0,
      all: 0,
      byReason: {} as Record<string, number>,
    },
  );

  return {
    ok: true,
    scope: currentScope,
    diagnostics: {
      propertySummary: diagnosticSummary,
      propertySamples: propertyDiagnostics.slice(0, 8),
    },
    properties,
    tenants,
    charges,
    payments,
    paymentReceipts,
    rentReceipts,
    messages,
    rentAdjustments,
    rentAdjustmentPolicies,
  };
});
