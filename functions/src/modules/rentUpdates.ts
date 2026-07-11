import { onCall, HttpsError } from "firebase-functions/https";
import { db } from "../firebase.js";
import { normalizeOwnerScope, requireRole, transferBlockToOwnerScope } from "../lib/auth.js";
import { monthPeriod, nowIso, randomToken } from "../lib/utils.js";

type ScopedOwner = "all" | "enzo" | "ivo";
type AdjustmentTargetMode = "category" | "property";
type AdjustmentValueMode = "percent" | "set_value";
type RentUpdateSource = "manual" | "indexed";
type RentUpdateFrequency = "monthly" | "quarterly" | "semiannual";
type RentUpdateIndex = "ICL" | "IPC" | "CUSTOM";

type PropertyRecord = {
  id: string;
  name?: string;
  unitType?: string;
  unitCode?: string;
  ownerScope?: string;
  ownerId?: string;
  transferBlock?: string;
  billingBlock?: string;
  blockId?: string;
};

type TenantRecord = {
  id: string;
  fullName?: string;
  propertyId?: string;
  baseRent?: number;
  status?: string;
  dueDayOfMonth?: number;
  rentSchedule?: {
    frequency?: string;
    nextAdjustmentPeriod?: string | null;
  };
  rentUpdateConfig?: {
    frequency?: string;
    nextAdjustmentPeriod?: string | null;
  };
};

type AdjustmentPreviewItem = {
  propertyId: string;
  propertyName: string;
  unitType: string;
  tenantId: string;
  tenantName: string;
  ownerScope: ScopedOwner;
  currentBaseRent: number;
  nextBaseRent: number;
};

type CategoryPolicyConfig = {
  policyId: string | null;
  updateSource: RentUpdateSource;
  indexName: RentUpdateIndex | null;
  frequency: RentUpdateFrequency;
  nextAdjustmentPeriod: string;
  requiresOwnerApproval: boolean;
};

export const previewRentUpdate = onCall(async (request) => {
  const claims = await requireRole(request, ["admin", "superadmin"]);
  const preview = await buildRentUpdatePreview(
    request.data ?? {},
    claims.role === "superadmin" ? "all" : normalizeOwnerScope(claims.ownerScope)
  );

  return {
    ok: true,
    preview
  };
});

export const saveRentUpdatePolicy = onCall(async (request) => {
  const claims = await requireRole(request, ["admin", "superadmin"]);
  const actorUid = request.auth?.uid ?? "system";
  const actorScope = claims.role === "superadmin" ? "all" : normalizeOwnerScope(claims.ownerScope);
  const unitType = normalizeUnitType(request.data?.unitType);

  if (!unitType) {
    throw new HttpsError("invalid-argument", "Debes elegir una categoría válida para guardar la política.");
  }

  const policyConfig = resolveCategoryPolicyConfig(request.data ?? {}, null);
  const policyId = buildCategoryPolicyId(actorScope, unitType);
  const updatedAt = nowIso();

  await db.collection("rentAdjustmentPolicies").doc(policyId).set(
    {
      policyType: "category",
      scopeType: "category",
      scopeKey: unitType,
      ownerScope: actorScope,
      unitType,
      propertyId: null,
      updateSource: policyConfig.updateSource,
      indexName: policyConfig.indexName,
      frequency: policyConfig.frequency,
      nextAdjustmentPeriod: policyConfig.nextAdjustmentPeriod,
      requiresOwnerApproval: policyConfig.requiresOwnerApproval,
      automationStatus: policyConfig.updateSource === "indexed" ? "indexed_assisted" : "manual_only",
      active: true,
      updatedAt,
      updatedBy: actorUid
    },
    { merge: true }
  );

  await db.collection("auditLogs").add({
    actorUid,
    actorRole: claims.role,
    actorScope,
    action: "rent_update_policy_saved",
    entityType: "settings",
    entityId: policyId,
    summary: `Actualizó la política de ${unitType} para ${actorScope === "all" ? "toda La Casona" : actorScope}.`,
    metadata: {
      unitType,
      ownerScope: actorScope,
      updateSource: policyConfig.updateSource,
      indexName: policyConfig.indexName,
      frequency: policyConfig.frequency,
      nextAdjustmentPeriod: policyConfig.nextAdjustmentPeriod,
      requiresOwnerApproval: policyConfig.requiresOwnerApproval
    },
    createdAt: updatedAt
  });

  return {
    ok: true,
    policyId,
    policy: {
      ownerScope: actorScope,
      unitType,
      ...policyConfig
    },
    summary: `Política de ${unitType} guardada correctamente.`
  };
});

export const applyRentUpdatePlan = onCall(async (request) => {
  const claims = await requireRole(request, ["admin", "superadmin"]);
  const actorUid = request.auth?.uid ?? "system";
  const actorScope = claims.role === "superadmin" ? "all" : normalizeOwnerScope(claims.ownerScope);
  const preview = await buildRentUpdatePreview(request.data ?? {}, actorScope);
  const currentPeriod = monthPeriod();

  if (!preview.items.length) {
    throw new HttpsError("failed-precondition", "No encontramos alquileres activos para actualizar con ese criterio.");
  }

  const policyId = buildPolicyId(preview);
  const appliedAt = nowIso();

  await db.collection("rentAdjustmentPolicies").doc(policyId).set(
    {
      scopeType: preview.targetMode,
      scopeKey: preview.targetMode === "category" ? preview.unitType : preview.propertyId,
      ownerScope: preview.ownerScope,
      unitType: preview.unitType ?? null,
      propertyId: preview.propertyId ?? null,
      updateSource: preview.policy.updateSource,
      indexName: preview.policy.indexName,
      frequency: preview.policy.frequency,
      valueMode: preview.adjustmentMode,
      value: preview.value,
      effectivePeriod: preview.effectivePeriod,
      billingEffectivePeriod: preview.billingEffectivePeriod,
      nextAdjustmentPeriod: preview.policy.nextAdjustmentPeriod,
      requiresOwnerApproval: preview.policy.requiresOwnerApproval,
      automationStatus: preview.policy.updateSource === "indexed" ? "indexed_assisted" : "manual_only",
      lastAppliedAt: appliedAt,
      updatedAt: appliedAt,
      updatedBy: actorUid
    },
    { merge: true }
  );

  for (const item of preview.items) {
    const appliesImmediately = preview.billingEffectivePeriod <= currentPeriod;
    await db.collection("tenants").doc(item.tenantId).set(
      {
        ...(appliesImmediately ? { baseRent: item.nextBaseRent } : {}),
        rentUpdateConfig: {
          policyId,
          effectivePeriod: preview.effectivePeriod,
          billingEffectivePeriod: preview.billingEffectivePeriod,
          valueMode: preview.adjustmentMode,
          value: preview.value,
          currentBaseRent: item.currentBaseRent,
          pendingBaseRent: item.nextBaseRent,
          source: preview.policy.updateSource,
          indexName: preview.policy.indexName,
          frequency: preview.policy.frequency,
          nextAdjustmentPeriod: preview.policy.nextAdjustmentPeriod,
          requiresOwnerApproval: preview.policy.requiresOwnerApproval,
          ownerScope: item.ownerScope,
          updatedAt: appliedAt,
          updatedBy: actorUid
        },
        updatedAt: appliedAt,
        updatedBy: actorUid
      },
      { merge: true }
    );

    await updateFutureChargesForTenant(item.tenantId, item.nextBaseRent, preview.billingEffectivePeriod, actorUid);
  }

  const adjustmentId = `rent-adjustment-${randomToken(10)}`;
  await db.collection("rentAdjustments").doc(adjustmentId).set({
    targetMode: preview.targetMode,
    ownerScope: preview.ownerScope,
    unitType: preview.unitType ?? null,
    propertyId: preview.propertyId ?? null,
    propertyName: preview.propertyName ?? null,
    adjustmentMode: preview.adjustmentMode,
    value: preview.value,
    effectivePeriod: preview.effectivePeriod,
    billingEffectivePeriod: preview.billingEffectivePeriod,
    updateSource: preview.policy.updateSource,
    indexName: preview.policy.indexName,
    frequency: preview.policy.frequency,
    nextAdjustmentPeriod: preview.policy.nextAdjustmentPeriod,
    requiresOwnerApproval: preview.policy.requiresOwnerApproval,
    affectedCount: preview.items.length,
    summary: buildAdjustmentSummary(preview),
    items: preview.items,
    policyId,
    createdAt: appliedAt,
    createdBy: actorUid,
    status: "applied"
  });

  await db.collection("auditLogs").add({
    actorUid,
    actorRole: claims.role,
    actorScope,
    action: "rent_update_applied",
    entityType: "settings",
    entityId: policyId,
    summary: buildAdjustmentSummary(preview),
    metadata: {
      targetMode: preview.targetMode,
      ownerScope: preview.ownerScope,
      unitType: preview.unitType ?? null,
      propertyId: preview.propertyId ?? null,
      adjustmentMode: preview.adjustmentMode,
      value: preview.value,
      effectivePeriod: preview.effectivePeriod,
      billingEffectivePeriod: preview.billingEffectivePeriod,
      updateSource: preview.policy.updateSource,
      indexName: preview.policy.indexName,
      frequency: preview.policy.frequency,
      nextAdjustmentPeriod: preview.policy.nextAdjustmentPeriod,
      requiresOwnerApproval: preview.policy.requiresOwnerApproval,
      affectedCount: preview.items.length
    },
    createdAt: appliedAt
  });

  return {
    ok: true,
    applied: preview.items.length,
    effectivePeriod: preview.effectivePeriod,
    billingEffectivePeriod: preview.billingEffectivePeriod,
    policyId,
    summary: buildAdjustmentSummary(preview)
  };
});

async function buildRentUpdatePreview(rawData: Record<string, unknown>, actorScope: ScopedOwner) {
  const targetMode = normalizeTargetMode(rawData.targetMode);
  const adjustmentMode = normalizeAdjustmentMode(rawData.adjustmentMode);
  const value = Number(rawData.value ?? 0);
  const effectivePeriod = normalizeEffectivePeriod(rawData.effectivePeriod);
  const unitType = normalizeUnitType(rawData.unitType);
  const propertyId = String(rawData.propertyId ?? "").trim();

  if (!Number.isFinite(value) || value === 0) {
    throw new HttpsError("invalid-argument", "Debes indicar un valor distinto de cero para el ajuste.");
  }

  if (targetMode === "category" && !unitType) {
    throw new HttpsError("invalid-argument", "Debes elegir una categoría de unidad.");
  }

  if (targetMode === "property" && !propertyId) {
    throw new HttpsError("invalid-argument", "Debes elegir una unidad específica.");
  }

  const [propertiesSnapshot, tenantsSnapshot] = await Promise.all([
    db.collection("properties").get(),
    db.collection("tenants").where("status", "==", "active").get()
  ]);

  const properties = propertiesSnapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) })) as PropertyRecord[];
  const tenants = tenantsSnapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) })) as TenantRecord[];
  const scopedProperties = properties.filter((property) => actorScope === "all" || resolvePropertyScope(property) === actorScope);
  const propertyMap = new Map(scopedProperties.map((property) => [property.id, property]));

  const items = tenants
    .map((tenant) => {
      const property = propertyMap.get(String(tenant.propertyId ?? ""));
      if (!property) {
        return null;
      }

      if (targetMode === "category" && normalizeUnitType(property.unitType) !== unitType) {
        return null;
      }

      if (targetMode === "property" && property.id !== propertyId) {
        return null;
      }

      const currentBaseRent = roundCurrency(Number(tenant.baseRent ?? 0));
      const nextBaseRent = adjustmentMode === "percent"
        ? roundCurrency(currentBaseRent * (1 + value / 100))
        : roundCurrency(value);

      if (!Number.isFinite(nextBaseRent) || nextBaseRent < 0) {
        throw new HttpsError("invalid-argument", "El ajuste produciría un valor de alquiler inválido.");
      }

      return {
        propertyId: property.id,
        propertyName: String(property.name ?? "Unidad"),
        unitType: normalizeUnitType(property.unitType),
        tenantId: tenant.id,
        tenantName: String(tenant.fullName ?? "Inquilino"),
        ownerScope: resolvePropertyScope(property),
        currentBaseRent,
        nextBaseRent
      } satisfies AdjustmentPreviewItem;
    })
    .filter((item): item is AdjustmentPreviewItem => Boolean(item));

  const firstProperty = targetMode === "property"
    ? scopedProperties.find((property) => property.id === propertyId)
    : null;

  const targetTenant = targetMode === "property"
    ? tenants.find((tenant) => String(tenant.propertyId ?? "") === propertyId) ?? null
    : null;
  const storedPolicySnapshot = targetMode === "category" && unitType
    ? await db.collection("rentAdjustmentPolicies").doc(buildCategoryPolicyId(actorScope, unitType)).get()
    : targetMode === "property" && propertyId
      ? await db.collection("rentAdjustmentPolicies").doc(`property__${propertyId}`).get()
      : null;
  const tenantScheduleFallback = targetTenant
    ? {
        frequency: targetTenant.rentSchedule?.frequency || targetTenant.rentUpdateConfig?.frequency || null,
        nextAdjustmentPeriod: targetTenant.rentSchedule?.nextAdjustmentPeriod || targetTenant.rentUpdateConfig?.nextAdjustmentPeriod || null
      }
    : null;
  const policy = resolveCategoryPolicyConfig(
    {
      ...tenantScheduleFallback,
      ...rawData
    },
    storedPolicySnapshot?.exists ? ((storedPolicySnapshot.data() ?? {}) as Record<string, unknown>) : tenantScheduleFallback
  );

  return {
    targetMode,
    ownerScope: targetMode === "property" && firstProperty
      ? resolvePropertyScope(firstProperty)
      : actorScope,
    unitType: targetMode === "category" ? unitType : null,
    propertyId: targetMode === "property" ? propertyId : null,
    propertyName: targetMode === "property" ? String(firstProperty?.name ?? "Unidad") : null,
    adjustmentMode,
    value,
    effectivePeriod,
    billingEffectivePeriod: addMonthsToPeriod(effectivePeriod, 1),
    policy,
    affectedCount: items.length,
    items
  };
}

async function updateFutureChargesForTenant(
  tenantId: string,
  baseRent: number,
  effectivePeriod: string,
  actorUserId: string
) {
  const chargesSnapshot = await db.collection("charges").where("tenantId", "==", tenantId).get();

  for (const chargeDoc of chargesSnapshot.docs) {
    const charge = chargeDoc.data() as {
      period?: string;
      status?: string;
      items?: Array<{ key?: string; label?: string; amount?: number }>;
      lateFeeAmount?: number;
    };

    if (["paid", "cancelled"].includes(String(charge.status ?? ""))) {
      continue;
    }

    if (String(charge.period ?? "") < effectivePeriod) {
      continue;
    }

    const items = Array.isArray(charge.items) ? charge.items.map((item) => ({ ...item })) : [];
    const rentItemIndex = items.findIndex((item) => item.key === "rent");

    if (rentItemIndex >= 0) {
      items[rentItemIndex].amount = baseRent;
      items[rentItemIndex].label = "Alquiler";
      items[rentItemIndex].key = "rent";
    } else {
      items.unshift({
        key: "rent",
        label: "Alquiler",
        amount: baseRent
      });
    }

    const subtotal = roundCurrency(items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
    const lateFeeAmount = Number(charge.lateFeeAmount ?? 0);

    await chargeDoc.ref.set(
      {
        items,
        subtotal,
        total: roundCurrency(subtotal + lateFeeAmount),
        updatedAt: nowIso(),
        updatedBy: actorUserId
      },
      { merge: true }
    );
  }
}

function normalizeTargetMode(value: unknown): AdjustmentTargetMode {
  return String(value ?? "").trim() === "property" ? "property" : "category";
}

function normalizeAdjustmentMode(value: unknown): AdjustmentValueMode {
  return String(value ?? "").trim() === "set_value" ? "set_value" : "percent";
}

function normalizeUnitType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "departamento") {
    return "Departamento";
  }
  if (normalized === "local") {
    return "Local";
  }
  if (normalized === "casa") {
    return "Casa";
  }
  return "";
}

function normalizeUpdateSource(value: unknown): RentUpdateSource {
  return String(value ?? "").trim().toLowerCase() === "indexed" ? "indexed" : "manual";
}

function normalizeFrequency(value: unknown): RentUpdateFrequency {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "quarterly" || normalized === "semiannual") {
    return normalized;
  }
  return "quarterly";
}

function normalizeIndexName(value: unknown): RentUpdateIndex | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ICL" || normalized === "IPC" || normalized === "CUSTOM") {
    return normalized;
  }
  return null;
}

function normalizeTransferBlock(value: unknown): "block_1" | "block_2" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "block_1" || normalized === "block_2") {
    return normalized;
  }
  return null;
}

function resolvePropertyScope(property: Record<string, unknown>): ScopedOwner {
  const ownerScope = normalizeOwnerScope(property.ownerScope);
  if (ownerScope === "enzo" || ownerScope === "ivo") {
    return ownerScope;
  }

  const ownerId = String(property.ownerId ?? "").trim().toLowerCase();
  if (ownerId === "enzo" || ownerId === "owner_block_1") {
    return "enzo";
  }
  if (ownerId === "ivo" || ownerId === "owner_block_2") {
    return "ivo";
  }

  return transferBlockToOwnerScope(
    normalizeTransferBlock(property.transferBlock ?? property.billingBlock ?? property.blockId) ?? "block_1"
  );
}

function normalizeEffectivePeriod(value: unknown) {
  const explicit = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(explicit)) {
    return explicit;
  }

  const today = new Date();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildCategoryPolicyId(ownerScope: ScopedOwner, unitType: string) {
  return `category__${String(unitType ?? "").toLowerCase()}__${ownerScope}`;
}

function resolveCategoryPolicyConfig(
  rawData: Record<string, unknown>,
  storedPolicy: Record<string, unknown> | null
): CategoryPolicyConfig {
  const updateSource = normalizeUpdateSource(rawData.updateSource ?? storedPolicy?.updateSource);
  const indexName = updateSource === "indexed"
    ? normalizeIndexName(rawData.indexName ?? storedPolicy?.indexName) ?? "ICL"
    : null;

  return {
    policyId: String(storedPolicy?.policyId ?? storedPolicy?.id ?? "").trim() || null,
    updateSource,
    indexName,
    frequency: normalizeFrequency(rawData.frequency ?? storedPolicy?.frequency),
    nextAdjustmentPeriod: normalizeEffectivePeriod(rawData.nextAdjustmentPeriod ?? storedPolicy?.nextAdjustmentPeriod),
    requiresOwnerApproval: Boolean(rawData.requiresOwnerApproval ?? storedPolicy?.requiresOwnerApproval ?? false)
  };
}

function buildPolicyId(preview: {
  targetMode: AdjustmentTargetMode;
  ownerScope: ScopedOwner;
  unitType?: string | null;
  propertyId?: string | null;
}) {
  if (preview.targetMode === "property") {
    return `property__${String(preview.propertyId ?? "").trim()}`;
  }

  return buildCategoryPolicyId(preview.ownerScope, String(preview.unitType ?? ""));
}

function buildAdjustmentSummary(preview: {
  targetMode: AdjustmentTargetMode;
  ownerScope: ScopedOwner;
  unitType?: string | null;
  propertyName?: string | null;
  adjustmentMode: AdjustmentValueMode;
  value: number;
  effectivePeriod: string;
  billingEffectivePeriod?: string;
  policy: CategoryPolicyConfig;
  affectedCount: number;
}) {
  const scopeLabel = preview.ownerScope === "all"
    ? "toda La Casona"
    : preview.ownerScope === "enzo"
      ? "Enzo"
      : "Ivo";
  const targetLabel = preview.targetMode === "category"
    ? `${preview.unitType}s`
    : preview.propertyName || "unidad";
  const valueLabel = preview.adjustmentMode === "percent"
    ? `${preview.value > 0 ? "+" : ""}${preview.value}%`
    : `$${roundCurrency(preview.value).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const policyLabel = preview.policy.updateSource === "indexed"
    ? `${preview.policy.indexName || "Índice"} · ${humanizeFrequency(preview.policy.frequency)}`
    : "ajuste manual";

  return `Actualizó ${targetLabel} de ${scopeLabel} con ${valueLabel} para ${preview.effectivePeriod}. Impacta en cobros desde ${preview.billingEffectivePeriod || addMonthsToPeriod(preview.effectivePeriod, 1)}. ${policyLabel}. (${preview.affectedCount} alquileres)`;
}

function addMonthsToPeriod(period: string, months: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? "").trim());
  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const shifted = new Date(year, monthIndex + months, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function humanizeFrequency(value: RentUpdateFrequency) {
  if (value === "monthly") {
    return "mensual";
  }
  if (value === "semiannual") {
    return "semestral";
  }
  return "trimestral";
}
