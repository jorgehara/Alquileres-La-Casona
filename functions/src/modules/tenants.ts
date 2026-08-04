import { onCall, HttpsError, type CallableRequest } from "firebase-functions/https";
import { getAuth } from "firebase-admin/auth";
import { db } from "../firebase.js";
import { assertOwnerScopeAccess, claimsFromProfile, normalizeOwnerScope, requireRole } from "../lib/auth.js";
import { nowIso, randomToken } from "../lib/utils.js";
import type { AppRole, OwnerScope, TenantInvitationRecord, TenantInvitationStatus, UserAuthProfile } from "../types.js";
import { sendTenantNotification } from "./notifications.js";

type ResolvedTenantInvitation = {
  tenantId: string;
  email: string;
  displayName: string;
  status: TenantInvitationStatus;
  source: "canonical" | "legacyInvitation" | "legacyTenantEmail";
  sourceId?: string;
  legacyInvitationToken?: string;
};

type ServerAuditInput = {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "El correo del inquilino no es valido.");
  }
  return email;
}

function canonicalInvitationId(email: string) {
  return normalizeEmail(email);
}

function isClaimableInvitationStatus(status: string) {
  return !status || status === "pending" || status === "claimed" || status === "accepted";
}

function withoutUndefined<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as Partial<T>;
}

function normalizeUserStatus(value: unknown): UserAuthProfile["status"] {
  const status = String(value ?? "active").trim().toLowerCase();
  return status === "active" ? "active" : status === "disabled" ? "disabled" : "inactive";
}

function buildServerAudit(actor: Awaited<ReturnType<typeof requireRole>>, input: ServerAuditInput) {
  return {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    metadata: input.metadata ?? {},
    actorUid: actor.uid,
    actorEmail: actor.profile.email ?? "",
    actorName: actor.profile.displayName ?? actor.profile.email ?? "Administrador",
    createdAt: nowIso()
  };
}

async function writeServerAudit(actor: Awaited<ReturnType<typeof requireRole>>, input: ServerAuditInput) {
  const logRef = await db.collection("auditLogs").add(buildServerAudit(actor, input));
  return logRef.id;
}

async function clearAuthClaimsIfPresent(uid: string) {
  try {
    await getAuth().setCustomUserClaims(uid, null);
  } catch {
    // Firestore authority is canonical. Missing Auth accounts should not block cleanup of app access.
  }
}

function buildCanonicalAuthProfile({
  role,
  tenantId,
  ownerScope,
  status = "active",
  email,
  displayName,
  createdAt,
  updatedBy
}: {
  role: AppRole;
  tenantId?: string;
  ownerScope?: OwnerScope | string;
  status?: UserAuthProfile["status"];
  email?: string;
  displayName?: string;
  createdAt?: unknown;
  updatedBy?: string;
}) {
  const profile = withoutUndefined({
    role,
    tenantId: role === "tenant" ? tenantId : undefined,
    ownerScope: role === "tenant" ? undefined : role === "superadmin" ? "all" : normalizeOwnerScope(ownerScope),
    email,
    displayName,
    status,
    createdAt,
    updatedAt: nowIso(),
    updatedBy
  });

  return profile as UserAuthProfile & { createdAt?: unknown };
}

async function assertNoDuplicateActiveTenantEmail(email: string, expectedTenantId = "") {
  const tenantSnapshot = await db
    .collection("tenants")
    .where("email", "==", email)
    .where("status", "==", "active")
    .limit(3)
    .get();

  const conflictingTenants = tenantSnapshot.docs.filter((tenantDoc) => tenantDoc.id !== expectedTenantId);
  if (conflictingTenants.length > 0) {
    throw new HttpsError(
      "failed-precondition",
      "Ya existe un inquilino activo con este correo. Un administrador debe revisar el dato."
    );
  }
}

async function assertInvitationAvailable(email: string, tenantId: string) {
  const invitationDoc = await db.collection("tenantInvitations").doc(canonicalInvitationId(email)).get();
  if (!invitationDoc.exists) {
    return;
  }

  const existingTenantId = String(invitationDoc.get("tenantId") ?? "");
  const status = String(invitationDoc.get("status") ?? "pending");
  if (existingTenantId && existingTenantId !== tenantId && ["pending", "claimed", "accepted"].includes(status)) {
    throw new HttpsError(
      "already-exists",
      "Ese correo ya tiene una invitacion activa para otro inquilino. Un administrador debe revisarlo."
    );
  }
}

async function upsertTenantInvitation({
  tenantId,
  email,
  displayName,
  status,
  actorUid,
  userId,
  legacyInvitationToken
}: {
  tenantId: string;
  email: string;
  displayName?: string;
  status: TenantInvitationStatus;
  actorUid: string;
  userId?: string;
  legacyInvitationToken?: string;
}) {
  const normalizedEmail = canonicalInvitationId(email);
  await assertInvitationAvailable(normalizedEmail, tenantId);

  const ref = db.collection("tenantInvitations").doc(normalizedEmail);
  const existingDoc = await ref.get();
  const existingData = existingDoc.data() ?? {};
  const record: TenantInvitationRecord = {
    tenantId,
    email: normalizedEmail,
    displayName,
    status,
    userId,
    createdAt: (existingData.createdAt as TenantInvitationRecord["createdAt"]) ?? nowIso(),
    createdBy: String(existingData.createdBy ?? actorUid),
    updatedAt: nowIso(),
    legacyInvitationToken
  };

  await ref.set(withoutUndefined(record), { merge: true });
  return { id: ref.id, record };
}

async function linkTenantUser({
  uid,
  email,
  tenantId,
  displayName
}: {
  uid: string;
  email: string;
  tenantId: string;
  displayName: string;
}) {
  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const profile = buildCanonicalAuthProfile({
    role: "tenant",
    tenantId,
    displayName,
    email,
    createdAt: userDoc.exists ? userDoc.get("createdAt") ?? nowIso() : nowIso()
  });
  await userRef.set(
    profile,
    { merge: true }
  );
  await getAuth().setCustomUserClaims(uid, claimsFromProfile(profile));
}

async function resolveTenantInvitationForClaim(email: string): Promise<ResolvedTenantInvitation> {
  const normalizedEmail = canonicalInvitationId(email);
  const activeTenantEmailSnapshot = await db
    .collection("tenants")
    .where("email", "==", normalizedEmail)
    .where("status", "==", "active")
    .limit(3)
    .get();

  if (activeTenantEmailSnapshot.size > 1) {
    throw new HttpsError(
      "failed-precondition",
      "Hay mas de un inquilino activo con este correo. Un administrador debe revisar el dato."
    );
  }

  const canonicalDoc = await db.collection("tenantInvitations").doc(normalizedEmail).get();
  if (canonicalDoc.exists) {
    const tenantId = String(canonicalDoc.get("tenantId") ?? "");
    if (!activeTenantEmailSnapshot.empty && activeTenantEmailSnapshot.docs[0].id !== tenantId) {
      throw new HttpsError(
        "failed-precondition",
        "La invitacion y el inquilino activo no coinciden. Un administrador debe revisar el dato."
      );
    }
    const status = String(canonicalDoc.get("status") ?? "pending");
    if (status === "revoked") {
      throw new HttpsError("permission-denied", "La invitacion de este correo fue revocada por administracion.");
    }
    if (!isClaimableInvitationStatus(status)) {
      throw new HttpsError("failed-precondition", "La invitacion no esta disponible para reclamar.");
    }

    return {
      tenantId,
      email: normalizedEmail,
      displayName: String(canonicalDoc.get("displayName") ?? ""),
      status: status === "accepted" ? "claimed" : (status as TenantInvitationStatus),
      source: "canonical",
      sourceId: canonicalDoc.id,
      legacyInvitationToken: String(canonicalDoc.get("legacyInvitationToken") ?? "") || undefined
    };
  }

  const legacyInvitationSnapshot = await db
    .collection("tenantInvitations")
    .where("email", "==", normalizedEmail)
    .limit(3)
    .get();
  const legacyCandidates = legacyInvitationSnapshot.docs.filter((docSnap) => docSnap.id !== normalizedEmail);
  if (legacyCandidates.length > 1) {
    throw new HttpsError(
      "failed-precondition",
      "Hay mas de una invitacion historica para este correo. Un administrador debe revisar el dato."
    );
  }
  if (legacyCandidates.length === 1) {
    const legacyDoc = legacyCandidates[0];
    const tenantId = String(legacyDoc.get("tenantId") ?? "");
    if (!activeTenantEmailSnapshot.empty && activeTenantEmailSnapshot.docs[0].id !== tenantId) {
      throw new HttpsError(
        "failed-precondition",
        "La invitacion historica y el inquilino activo no coinciden. Un administrador debe revisar el dato."
      );
    }
    const status = String(legacyDoc.get("status") ?? "pending");
    if (!isClaimableInvitationStatus(status)) {
      throw new HttpsError("permission-denied", "La invitacion historica no esta disponible para reclamar.");
    }
    return {
      tenantId,
      email: normalizedEmail,
      displayName: String(legacyDoc.get("displayName") ?? ""),
      status: status === "accepted" ? "claimed" : (status as TenantInvitationStatus),
      source: "legacyInvitation",
      sourceId: legacyDoc.id,
      legacyInvitationToken: legacyDoc.id
    };
  }

  if (activeTenantEmailSnapshot.empty) {
    throw new HttpsError(
      "permission-denied",
      "No encontramos una invitacion activa para este correo. Pedile a administracion que prepare tu acceso."
    );
  }

  const tenantDoc = activeTenantEmailSnapshot.docs[0];
  return {
    tenantId: tenantDoc.id,
    email: normalizedEmail,
    displayName: String(tenantDoc.get("fullName") ?? ""),
    status: "pending",
    source: "legacyTenantEmail",
    sourceId: tenantDoc.id
  };
}

export const inviteTenantUser = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    tenantId?: string;
    email?: string;
    displayName?: string;
  };

  if (!data.tenantId || !data.email) {
    throw new HttpsError("invalid-argument", "tenantId y email son obligatorios.");
  }

  const email = normalizeEmail(data.email);

  const tenantDoc = await db.collection("tenants").doc(data.tenantId).get();
  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino indicado.");
  }

  const invitationToken = randomToken(32);
  await assertNoDuplicateActiveTenantEmail(email, data.tenantId);
  await assertInvitationAvailable(email, data.tenantId);

  let userRecord;
  try {
    userRecord = await getAuth().getUserByEmail(email);
  } catch {
    userRecord = null;
  }

  if (userRecord) {
    const existingUserDoc = await db.collection("users").doc(userRecord.uid).get();
    const existingTenantId = String(existingUserDoc.get("tenantId") ?? "");
    const existingRole = String(existingUserDoc.get("role") ?? "");
    if (existingUserDoc.exists && existingRole && (existingRole !== "tenant" || (existingTenantId && existingTenantId !== data.tenantId))) {
      throw new HttpsError(
        "already-exists",
        "Ese correo ya pertenece a otro perfil. Un administrador debe revisar el acceso."
      );
    }

    await linkTenantUser({
      uid: userRecord.uid,
      email,
      tenantId: data.tenantId,
      displayName: data.displayName ?? tenantDoc.get("fullName") ?? email.split("@")[0]
    });
  }

  await upsertTenantInvitation({
    tenantId: data.tenantId,
    email,
    displayName: data.displayName ?? tenantDoc.get("fullName") ?? "",
    status: userRecord ? "claimed" : "pending",
    actorUid: request.auth?.uid ?? "system",
    userId: userRecord?.uid,
    legacyInvitationToken: invitationToken
  });

  await tenantDoc.ref.set(
      {
        invitationStatus: userRecord ? "claimed" : "pending",
        invitationToken,
        email,
        updatedAt: nowIso()
      },
    { merge: true }
  );

  return {
    ok: true,
    invitationToken,
    invitationId: email,
    status: userRecord ? "claimed" : "pending"
  };
});

export const listAvailableUnits = onCall(async (request) => {
  const data = request.data as { propertyType?: string };
  const propertyType = String(data.propertyType ?? "").trim();

  if (!propertyType) {
    throw new HttpsError("invalid-argument", "propertyType es obligatorio.");
  }

  const catalog = buildPropertyCatalog(propertyType);
  const propertiesSnapshot = await db.collection("properties").get();
  const tenantsSnapshot = await db.collection("tenants").where("status", "==", "active").get();

  const occupiedPropertyIds = new Set(
    tenantsSnapshot.docs
      .map((tenantDoc) => String(tenantDoc.get("propertyId") ?? ""))
      .filter(Boolean)
  );

  const propertyByKey = new Map(
    propertiesSnapshot.docs.map((propertyDoc) => [
      `${propertyDoc.get("unitType")}:${propertyDoc.get("unitCode")}`,
      { id: propertyDoc.id, ...propertyDoc.data() }
    ])
  );

  const options = catalog
    .map((unit) => {
      const existingProperty = propertyByKey.get(`${unit.unitType}:${unit.unitCode}`);
      const occupied = existingProperty ? occupiedPropertyIds.has(existingProperty.id) : false;
      return {
        ...unit,
        propertyId: existingProperty?.id ?? null,
        occupied
      };
    })
    .filter((unit) => !unit.occupied);

  return { ok: true, options };
});

export const createTenantProfile = onCall(async (request) => {
  if (!request.auth?.uid || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "Necesitas una cuenta autenticada.");
  }

  return claimTenantAccessForRequest(request);
});

export const claimTenantAccess = onCall(async (request) => claimTenantAccessForRequest(request));

async function claimTenantAccessForRequest(request: CallableRequest) {
  if (!request.auth?.uid || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "Necesitas iniciar sesiÃ³n para vincular tu perfil.");
  }

  const email = normalizeEmail(request.auth.token.email);
  const userRef = db.collection("users").doc(request.auth.uid);
  const userDoc = await userRef.get();

  if (userDoc.exists) {
    const role = String(userDoc.get("role") ?? "");
    if (role) {
      if (role === "tenant") {
        const linkedTenantId = String(userDoc.get("tenantId") ?? "");
        const userStatus = String(userDoc.get("status") ?? "active");
        const linkedTenantDoc = linkedTenantId ? await db.collection("tenants").doc(linkedTenantId).get() : null;
        const tenantStatus = linkedTenantDoc?.exists ? String(linkedTenantDoc.get("status") ?? "active") : "inactive";
        const invitationStatus = linkedTenantDoc?.exists ? String(linkedTenantDoc.get("invitationStatus") ?? "") : "";
        if (userStatus !== "active" || tenantStatus !== "active" || invitationStatus === "revoked") {
          throw new HttpsError("permission-denied", "El acceso de este inquilino no esta activo.");
        }
      }
      return {
        ok: true,
        alreadyLinked: true,
        role,
        tenantId: String(userDoc.get("tenantId") ?? "")
      };
    }
  }

  const resolvedInvitation = await resolveTenantInvitationForClaim(email);
  const tenantId = resolvedInvitation.tenantId;
  let displayName = resolvedInvitation.displayName;

  if (!tenantId) {
    throw new HttpsError("permission-denied", "No se pudo identificar el perfil del inquilino.");
  }

  const tenantDoc = await db.collection("tenants").doc(tenantId).get();
  if (!tenantDoc.exists || String(tenantDoc.get("status") ?? "active") !== "active") {
    throw new HttpsError("permission-denied", "El perfil del inquilino no estÃ¡ activo.");
  }

  displayName = displayName || String(tenantDoc.get("fullName") ?? email.split("@")[0]);

  const userProfile = buildCanonicalAuthProfile({
    role: "tenant",
    tenantId,
    displayName,
    email,
    createdAt: userDoc.exists ? userDoc.get("createdAt") ?? nowIso() : nowIso()
  });
  const batch = db.batch();
  batch.set(
    userRef,
    userProfile,
    { merge: true }
  );
  batch.set(
    db.collection("tenantInvitations").doc(email),
    withoutUndefined({
      tenantId,
      email,
      displayName,
      status: "claimed",
      claimedAt: nowIso(),
      claimedBy: request.auth.uid,
      updatedAt: nowIso(),
      migratedFromLegacyId: resolvedInvitation.source === "legacyInvitation" ? resolvedInvitation.sourceId : undefined,
      legacyInvitationToken: resolvedInvitation.legacyInvitationToken
    }),
    { merge: true }
  );
  if (resolvedInvitation.source === "legacyInvitation" && resolvedInvitation.sourceId && resolvedInvitation.sourceId !== email) {
    batch.set(
      db.collection("tenantInvitations").doc(resolvedInvitation.sourceId),
      {
        status: "claimed",
        migratedToInvitationId: email,
        claimedAt: nowIso(),
        claimedBy: request.auth.uid,
        updatedAt: nowIso()
      },
      { merge: true }
    );
  }
  batch.set(
    db.collection("tenants").doc(tenantId),
    {
      invitationStatus: "claimed",
      updatedAt: nowIso()
    },
    { merge: true }
  );
  await batch.commit();
  await getAuth().setCustomUserClaims(request.auth.uid, claimsFromProfile(userProfile));

  return {
    ok: true,
    tenantId,
    role: "tenant"
  };
}

export const updateTenantContactSettings = onCall(async (request) => {
  const claims = await requireRole(request, ["tenant"]);
  const tenantId = String(claims.tenantId ?? "");
  const data = request.data as { email?: string; phone?: string };

  await db.collection("users").doc(claims.uid).set(
    {
      email: String(data.email ?? request.auth?.token.email ?? ""),
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await db.collection("tenants").doc(tenantId).set(
    {
      email: String(data.email ?? request.auth?.token.email ?? ""),
      phone: String(data.phone ?? ""),
      updatedAt: nowIso()
    },
    { merge: true }
  );

  return { ok: true };
});

export const updateTenantContract = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    tenantId?: string;
    action?: "renew" | "finalize";
    effectiveDate?: string;
  };

  if (!data.tenantId || !data.action || !data.effectiveDate) {
    throw new HttpsError("invalid-argument", "tenantId, action y effectiveDate son obligatorios.");
  }

  const tenantRef = db.collection("tenants").doc(data.tenantId);
  const tenantDoc = await tenantRef.get();

  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino indicado.");
  }

  const tenant = tenantDoc.data() ?? {};
  const isRenew = data.action === "renew";

  await tenantRef.set(
    {
      contractEndDate: data.effectiveDate,
      status: isRenew ? "active" : "finishing",
      contractStatus: isRenew ? "renewed" : "ending",
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await sendTenantNotification({
    tenantId: data.tenantId,
    type: isRenew ? "contract_renewed" : "contract_finalized",
    body: isRenew
      ? `Hola ${tenant.fullName ?? ""}, tu contrato fue renovado hasta ${data.effectiveDate}.`
      : `Hola ${tenant.fullName ?? ""}, tu contrato quedo configurado para finalizar el ${data.effectiveDate}.`,
    channel: "email",
    createdBy: request.auth?.uid ?? "system"
  });

  return { ok: true };
});

export const createTenantAdminProfile = onCall(async (request) => {
  const actor = await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    fullName?: string;
    dni?: string;
    phone?: string;
    email?: string;
    propertyId?: string;
    baseRent?: number;
    dueDayOfMonth?: number | null;
    rentUpdateFrequency?: string | null;
    nextAdjustmentPeriod?: string | null;
    contractStartDate?: string | null;
    contractEndDate?: string | null;
  };

  const fullName = String(data.fullName ?? "").trim();
  const dni = String(data.dni ?? "").trim();
  const phone = String(data.phone ?? "").trim();
  const rawEmail = String(data.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : "";
  const propertyId = String(data.propertyId ?? "").trim();
  const baseRent = Number(data.baseRent ?? 0);
  const dueDayOfMonth = normalizeDueDayOfMonth(data.dueDayOfMonth);
  const rentUpdateFrequency = normalizeRentScheduleFrequency(data.rentUpdateFrequency);
  const nextAdjustmentPeriod = normalizePeriodValue(data.nextAdjustmentPeriod);

  if (!fullName || !phone || !propertyId || !Number.isFinite(baseRent) || baseRent < 0) {
    throw new HttpsError("invalid-argument", "Faltan datos obligatorios para crear el inquilino.");
  }

  const targetPropertyRef = db.collection("properties").doc(propertyId);
  const targetPropertyDoc = await targetPropertyRef.get();
  if (!targetPropertyDoc.exists) {
    throw new HttpsError("not-found", "No existe la propiedad seleccionada.");
  }
  await assertOwnerScopeAccess(request, propertyId);

  const propertyTenants = await db.collection("tenants").where("propertyId", "==", propertyId).get();
  const occupiedByActiveTenant = propertyTenants.docs.some((docSnap) => {
    const status = String(docSnap.get("status") ?? "active");
    return !["inactive", "deleted"].includes(status);
  });
  if (occupiedByActiveTenant) {
    throw new HttpsError("already-exists", "La propiedad seleccionada ya esta ocupada.");
  }

  const tenantRef = db.collection("tenants").doc();
  if (email) {
    await assertNoDuplicateActiveTenantEmail(email, tenantRef.id);
    await assertInvitationAvailable(email, tenantRef.id);
  }

  await tenantRef.set({
    fullName,
    dni,
    phone,
    email,
    propertyId,
    baseRent,
    dueDayOfMonth,
    rentSchedule: {
      frequency: rentUpdateFrequency,
      nextAdjustmentPeriod
    },
    rentUpdateConfig: {
      frequency: rentUpdateFrequency,
      nextAdjustmentPeriod
    },
    contractStartDate: data.contractStartDate || null,
    contractEndDate: data.contractEndDate || null,
    invitationStatus: email ? "pending" : "not_sent",
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await targetPropertyRef.set(
    {
      currentTenantId: tenantRef.id,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  if (email) {
    await upsertTenantInvitation({
      tenantId: tenantRef.id,
      email,
      displayName: fullName,
      status: "pending",
      actorUid: request.auth?.uid ?? "system"
    });
  }

  await writeServerAudit(actor, {
    action: "tenant_created",
    entityType: "tenant",
    entityId: tenantRef.id,
    summary: `Creo la ficha de ${fullName}.`,
    metadata: {
      tenantName: fullName,
      propertyId,
      email,
      invitationStatus: email ? "pending" : "not_sent"
    }
  });

  return { ok: true, tenantId: tenantRef.id, invitationStatus: email ? "pending" : "not_sent" };
});

export const updateTenantAdminProfile = onCall(async (request) => {
  const actor = await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    tenantId?: string;
    fullName?: string;
    dni?: string;
    phone?: string;
    email?: string;
    propertyId?: string;
    baseRent?: number;
    dueDayOfMonth?: number | null;
    rentUpdateFrequency?: string | null;
    nextAdjustmentPeriod?: string | null;
    contractStartDate?: string | null;
    contractEndDate?: string | null;
  };

  const tenantId = String(data.tenantId ?? "");
  const fullName = String(data.fullName ?? "").trim();
  const dni = String(data.dni ?? "").trim();
  const phone = String(data.phone ?? "").trim();
  const rawEmail = String(data.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : "";
  const propertyId = String(data.propertyId ?? "").trim();
  const baseRent = Number(data.baseRent ?? 0);
  const dueDayOfMonth = normalizeDueDayOfMonth(data.dueDayOfMonth);
  const rentUpdateFrequency = normalizeRentScheduleFrequency(data.rentUpdateFrequency);
  const nextAdjustmentPeriod = normalizePeriodValue(data.nextAdjustmentPeriod);

  if (!tenantId || !fullName || !phone || !propertyId || !Number.isFinite(baseRent) || baseRent < 0) {
    throw new HttpsError("invalid-argument", "Faltan datos obligatorios para actualizar el inquilino.");
  }

  const tenantRef = db.collection("tenants").doc(tenantId);
  const tenantDoc = await tenantRef.get();

  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino indicado.");
  }

  const tenant = tenantDoc.data() ?? {};
  const previousPropertyId = String(tenant.propertyId ?? "");
  const previousEmail = String(tenant.email ?? "").trim().toLowerCase();
  const targetPropertyRef = db.collection("properties").doc(propertyId);
  const targetPropertyDoc = await targetPropertyRef.get();

  if (!targetPropertyDoc.exists) {
    throw new HttpsError("not-found", "No existe la propiedad seleccionada.");
  }
  if (previousPropertyId) {
    await assertOwnerScopeAccess(request, previousPropertyId);
  }
  await assertOwnerScopeAccess(request, propertyId);

  const propertyTenants = await db.collection("tenants").where("propertyId", "==", propertyId).get();
  const occupiedByOtherTenant = propertyTenants.docs.some((docSnap) => {
    if (docSnap.id === tenantId) {
      return false;
    }

    const status = String(docSnap.get("status") ?? "active");
    return !["inactive", "deleted"].includes(status);
  });

  if (occupiedByOtherTenant) {
    throw new HttpsError("already-exists", "La propiedad seleccionada ya esta ocupada.");
  }

  if (email) {
    await assertNoDuplicateActiveTenantEmail(email, tenantId);
    await assertInvitationAvailable(email, tenantId);
  }

  await tenantRef.set(
    {
      fullName,
      dni,
      phone,
      email,
      propertyId,
      baseRent,
      dueDayOfMonth,
      rentSchedule: {
        frequency: rentUpdateFrequency,
        nextAdjustmentPeriod
      },
      rentUpdateConfig: {
        ...(tenant.rentUpdateConfig ?? {}),
        frequency: rentUpdateFrequency,
        nextAdjustmentPeriod
      },
      contractStartDate: data.contractStartDate || null,
      contractEndDate: data.contractEndDate || null,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  if (previousPropertyId && previousPropertyId !== propertyId) {
    await db.collection("properties").doc(previousPropertyId).set(
      {
        currentTenantId: null,
        updatedAt: nowIso()
      },
      { merge: true }
    );
  }

  await targetPropertyRef.set(
    {
      currentTenantId: tenantId,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  const linkedUserSnapshot = await db.collection("users").where("tenantId", "==", tenantId).limit(1).get();
  const linkedUserDoc = linkedUserSnapshot.docs[0];

  if (linkedUserDoc) {
    const linkedUserProfile = buildCanonicalAuthProfile({
      role: "tenant",
      tenantId,
      displayName: fullName,
      email,
      createdAt: linkedUserDoc.get("createdAt") ?? nowIso()
    });
    await linkedUserDoc.ref.set(
      linkedUserProfile,
      { merge: true }
    );

    const authUpdates: { displayName?: string; email?: string } = { displayName: fullName };
    if (email) {
      authUpdates.email = email;
    }
    await getAuth().updateUser(linkedUserDoc.id, authUpdates);
    await getAuth().setCustomUserClaims(linkedUserDoc.id, claimsFromProfile(linkedUserProfile));
  }

  if (previousEmail && previousEmail !== email) {
    await db.collection("tenantInvitations").doc(previousEmail).delete().catch(() => null);
  }

  if (email) {
    await upsertTenantInvitation({
      tenantId,
      email,
      displayName: fullName,
      status: linkedUserDoc ? "claimed" : "pending",
      actorUid: request.auth?.uid ?? "system",
      userId: linkedUserDoc?.id
    });
  }

  await updateOpenChargesForTenantOpenChargeConfig(
    tenantId,
    {
      baseRent,
      dueDayOfMonth
    },
    request.auth?.uid ?? "system"
  );

  await writeServerAudit(actor, {
    action: "tenant_updated",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Actualizo la ficha de ${fullName || tenant.fullName || "un inquilino"}.`,
    metadata: {
      tenantName: fullName,
      previousBaseRent: Number(tenant.baseRent ?? 0),
      newBaseRent: baseRent,
      previousPropertyId,
      newPropertyId: propertyId,
      previousEmail,
      newEmail: email
    }
  });

  return { ok: true };
});

export const createAdministrativeUser = onCall(async (request) => {
  const claims = await requireRole(request, ["superadmin"]);

  if (claims.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo un superadmin puede crear usuarios administrativos.");
  }

  const data = request.data as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: string;
    ownerScope?: string;
  };

  const email = String(data.email ?? "").trim().toLowerCase();
  const password = String(data.password ?? "");
  const displayName = String(data.displayName ?? "").trim() || email.split("@")[0] || "Administrador";
  const role = String(data.role ?? "admin").trim();
  const ownerScope = normalizeOwnerScope(data.ownerScope);

  if (!email || !password) {
    throw new HttpsError("invalid-argument", "Correo y contrasena son obligatorios.");
  }

  if (!["admin", "superadmin"].includes(role)) {
    throw new HttpsError("invalid-argument", "Solo puedes crear usuarios con rol admin o superadmin.");
  }

  if (role === "superadmin" && ownerScope !== "all") {
    throw new HttpsError("invalid-argument", "Un superadmin debe tener alcance all.");
  }

  if (role === "admin" && !["enzo", "ivo", "all"].includes(ownerScope)) {
    throw new HttpsError("invalid-argument", "El alcance del admin debe ser enzo, ivo o all.");
  }

  let userRecord;
  let mode: "created" | "updated" = "created";

  try {
    userRecord = await getAuth().getUserByEmail(email);
    mode = "updated";
  } catch {
    userRecord = await getAuth().createUser({
      email,
      password,
      displayName
    });
  }

  const existingUserDoc = await db.collection("users").doc(userRecord.uid).get();
  const existingUserData = existingUserDoc.data() ?? {};

  if (existingUserDoc.exists && String(existingUserData.role ?? "") === "tenant") {
    throw new HttpsError("already-exists", "Ese correo ya esta vinculado a un inquilino y no puede convertirse automaticamente en admin.");
  }

  await getAuth().updateUser(userRecord.uid, {
    email,
    password,
    displayName
  });

  const profile = buildCanonicalAuthProfile({
    role: role as AppRole,
    ownerScope: role === "superadmin" ? "all" : ownerScope,
    email,
    displayName,
    createdAt: existingUserData.createdAt ?? nowIso(),
    updatedBy: request.auth?.uid ?? "system"
  });
  await db.collection("users").doc(userRecord.uid).set(
    profile,
    { merge: true }
  );
  await getAuth().setCustomUserClaims(userRecord.uid, claimsFromProfile(profile));

  await writeServerAudit(claims, {
    action: mode === "created" ? "user_created" : "user_permissions_updated",
    entityType: "user",
    entityId: userRecord.uid,
    summary:
      mode === "created"
        ? `Creo el usuario ${role} ${displayName}.`
        : `Actualizo la cuenta existente ${displayName} como ${role}.`,
    metadata: {
      email,
      role,
      ownerScope: profile.ownerScope ?? "all",
      mode
    }
  });

  return {
    ok: true,
    mode,
    message:
      mode === "created"
        ? `Usuario ${role} creado correctamente.`
        : `La cuenta ya existia y fue actualizada como ${role}.`
  };
});

async function resolveBootstrapEligibility() {
  const bootstrapDoc = await db.collection("settings").doc("bootstrap").get();
  if (bootstrapDoc.exists) {
    return { canBootstrap: false, reason: "bootstrap_already_configured" };
  }

  const adminSnapshot = await db
    .collection("users")
    .where("role", "in", ["admin", "superadmin"])
    .limit(1)
    .get();

  if (!adminSnapshot.empty) {
    return { canBootstrap: false, reason: "admin_already_exists" };
  }

  return { canBootstrap: true, reason: "eligible" };
}

export const checkBootstrapEligibility = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión para consultar el acceso inicial.");
  }

  return resolveBootstrapEligibility();
});
export const bootstrapInitialAdmin = onCall(async (request) => {
  if (!request.auth?.uid || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesiÃ³n para activar el administrador inicial.");
  }

  const bootstrapEligibility = await resolveBootstrapEligibility();
  if (!bootstrapEligibility.canBootstrap) {
    if (bootstrapEligibility.reason === "bootstrap_already_configured") {
      throw new HttpsError("failed-precondition", "El administrador inicial ya fue configurado.");
    }

    if (bootstrapEligibility.reason === "admin_already_exists") {
      throw new HttpsError("permission-denied", "Ya existe un administrador activo en este proyecto.");
    }
  }

  const bootstrapRef = db.collection("settings").doc("bootstrap");

  const userRef = db.collection("users").doc(request.auth.uid);
  const existingUserDoc = await userRef.get();
  const existingUserData = existingUserDoc.data() ?? {};

  if (existingUserDoc.exists && existingUserData.role && existingUserData.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Tu cuenta ya tiene un rol asignado y no puede bootstrapearse.");
  }

  const displayName =
    String(existingUserData.displayName ?? "").trim() ||
    String(request.auth.token.email).split("@")[0] ||
    "Administrador inicial";

  const bootstrapProfile = buildCanonicalAuthProfile({
    role: "superadmin",
    ownerScope: "all",
    displayName,
    email: request.auth.token.email,
    createdAt: existingUserData.createdAt ?? nowIso(),
    updatedBy: request.auth.uid
  });
  await userRef.set(
    bootstrapProfile,
    { merge: true }
  );
  await getAuth().setCustomUserClaims(request.auth.uid, claimsFromProfile(bootstrapProfile));

  await bootstrapRef.set({
    initialized: true,
    initialAdminUid: request.auth.uid,
    initialAdminEmail: request.auth.token.email,
    createdAt: nowIso()
  });

  await db.collection("auditLogs").add({
    actorUid: request.auth.uid,
    actorRole: "superadmin",
    actorEmail: request.auth.token.email,
    type: "initial_admin_bootstrap",
    entityType: "settings",
    entityId: "bootstrap",
    summary: `Se configurÃ³ el administrador inicial (${request.auth.token.email}).`,
    createdAt: nowIso()
  });

  return {
    ok: true,
    role: "superadmin",
    message: "Administrador inicial activado correctamente."
  };
});

export const deleteUserAccess = onCall(async (request) => {
  const actor = await requireRole(request, ["admin", "superadmin"]);
  const userId = String(request.data?.userId ?? "").trim();

  if (!userId) {
    throw new HttpsError("invalid-argument", "userId es obligatorio.");
  }

  if (userId === request.auth?.uid) {
    throw new HttpsError("permission-denied", "No podes eliminar tu propio usuario desde esta pantalla.");
  }

  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "No existe el usuario indicado.");
  }

  const targetUser = userDoc.data() ?? {};
  const targetRole = String(targetUser.role ?? "");
  if (["admin", "superadmin"].includes(targetRole) && actor.role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo un superadmin puede eliminar usuarios administrativos.");
  }

  const tenantId = String(targetUser.tenantId ?? "");
  const email = String(targetUser.email ?? "").trim().toLowerCase();
  let tenantName = "";
  let tenantPropertyId = "";
  if (tenantId) {
    const tenantDoc = await db.collection("tenants").doc(tenantId).get();
    if (tenantDoc.exists) {
      tenantName = String(tenantDoc.get("fullName") ?? "");
      tenantPropertyId = String(tenantDoc.get("propertyId") ?? "");
      if (tenantPropertyId) {
        await assertOwnerScopeAccess(request, tenantPropertyId);
      }
    }
  }

  const batch = db.batch();
  if (tenantId) {
    batch.set(
      db.collection("tenants").doc(tenantId),
      {
        status: "inactive",
        invitationStatus: "revoked",
        updatedAt: nowIso()
      },
      { merge: true }
    );
  }

  if (email) {
    batch.delete(db.collection("tenantInvitations").doc(canonicalInvitationId(email)));
  }

  batch.delete(userRef);

  const auditRef = db.collection("auditLogs").doc();
  batch.set(auditRef, buildServerAudit(actor, {
    action: "user_deleted",
    entityType: "user",
    entityId: userId,
    summary: `Elimino definitivamente el acceso de ${String(targetUser.displayName ?? "") || email || userId}.`,
    metadata: {
      email,
      role: targetRole,
      tenantId,
      tenantName,
      propertyId: tenantPropertyId
    }
  }));

  await batch.commit();
  await clearAuthClaimsIfPresent(userId);

  return { ok: true, auditLogId: auditRef.id };
});

export const deactivateTenant = onCall(async (request) => {
  const actor = await requireRole(request, ["admin", "superadmin"]);
  const tenantId = String(request.data?.tenantId ?? "").trim();
  if (!tenantId) {
    throw new HttpsError("invalid-argument", "tenantId es obligatorio.");
  }

  const tenantRef = db.collection("tenants").doc(tenantId);
  const tenantDoc = await tenantRef.get();
  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino indicado.");
  }

  const tenant = tenantDoc.data() ?? {};
  const propertyId = String(tenant.propertyId ?? "");
  if (propertyId) {
    await assertOwnerScopeAccess(request, propertyId);
  }

  const email = String(tenant.email ?? "").trim().toLowerCase();
  const linkedUsers = await db.collection("users").where("tenantId", "==", tenantId).get();
  const batch = db.batch();
  batch.set(tenantRef, {
    status: "inactive",
    contractStatus: "terminated",
    invitationStatus: "revoked",
    updatedAt: nowIso()
  }, { merge: true });

  if (propertyId) {
    batch.set(db.collection("properties").doc(propertyId), {
      currentTenantId: null,
      updatedAt: nowIso()
    }, { merge: true });
  }

  if (email) {
    batch.set(db.collection("tenantInvitations").doc(canonicalInvitationId(email)), {
      status: "revoked",
      updatedAt: nowIso()
    }, { merge: true });
  }

  linkedUsers.docs.forEach((linkedUserDoc) => {
    batch.set(linkedUserDoc.ref, {
      status: "inactive",
      updatedAt: nowIso(),
      updatedBy: actor.uid
    }, { merge: true });
  });

  const auditRef = db.collection("auditLogs").doc();
  batch.set(auditRef, buildServerAudit(actor, {
    action: "tenant_deactivated",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Dio de baja al inquilino ${String(tenant.fullName ?? "") || tenantId}.`,
    metadata: {
      tenantName: String(tenant.fullName ?? ""),
      propertyId,
      email,
      linkedUsers: linkedUsers.size
    }
  }));

  await batch.commit();
  await Promise.all(linkedUsers.docs.map((linkedUserDoc) => clearAuthClaimsIfPresent(linkedUserDoc.id)));

  return { ok: true, auditLogId: auditRef.id, linkedUsers: linkedUsers.size };
});

export const deleteTenantProfile = onCall(async (request) => {
  const actor = await requireRole(request, ["admin", "superadmin"]);
  const tenantId = String(request.data?.tenantId ?? "").trim();
  if (!tenantId) {
    throw new HttpsError("invalid-argument", "tenantId es obligatorio.");
  }

  const tenantRef = db.collection("tenants").doc(tenantId);
  const tenantDoc = await tenantRef.get();
  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino indicado.");
  }

  const tenant = tenantDoc.data() ?? {};
  const propertyId = String(tenant.propertyId ?? "");
  if (propertyId) {
    await assertOwnerScopeAccess(request, propertyId);
  }

  const email = String(tenant.email ?? "").trim().toLowerCase();
  const linkedUsers = await db.collection("users").where("tenantId", "==", tenantId).get();
  const batch = db.batch();

  if (propertyId) {
    batch.set(db.collection("properties").doc(propertyId), {
      currentTenantId: null,
      updatedAt: nowIso()
    }, { merge: true });
  }

  if (email) {
    batch.delete(db.collection("tenantInvitations").doc(canonicalInvitationId(email)));
  }

  linkedUsers.docs.forEach((linkedUserDoc) => batch.delete(linkedUserDoc.ref));
  batch.delete(tenantRef);

  const auditRef = db.collection("auditLogs").doc();
  batch.set(auditRef, buildServerAudit(actor, {
    action: "tenant_deleted",
    entityType: "tenant",
    entityId: tenantId,
    summary: `Elimino definitivamente el perfil de ${String(tenant.fullName ?? "") || tenantId}.`,
    metadata: {
      tenantName: String(tenant.fullName ?? ""),
      propertyId,
      email,
      linkedUsers: linkedUsers.size
    }
  }));

  await batch.commit();
  await Promise.all(linkedUsers.docs.map((linkedUserDoc) => clearAuthClaimsIfPresent(linkedUserDoc.id)));

  return { ok: true, auditLogId: auditRef.id, linkedUsers: linkedUsers.size };
});

export const updateUserAuthority = onCall(async (request) => {
  const actor = await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    userId?: string;
    role?: string;
    status?: string;
    ownerScope?: string;
  };
  const userId = String(data.userId ?? "").trim();
  const role = String(data.role ?? "").trim() as AppRole;
  const status = normalizeUserStatus(data.status);
  const ownerScope = role === "superadmin" ? "all" : normalizeOwnerScope(data.ownerScope);

  if (!userId) {
    throw new HttpsError("invalid-argument", "userId es obligatorio.");
  }

  if (userId === request.auth?.uid) {
    throw new HttpsError("permission-denied", "No podes modificar tu propio rol o estado desde esta pantalla.");
  }

  if (!["superadmin", "admin", "tenant"].includes(role)) {
    throw new HttpsError("invalid-argument", "Rol invalido.");
  }

  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "No existe el usuario indicado.");
  }

  const currentData = userDoc.data() ?? {};
  const currentRole = String(currentData.role ?? "") as AppRole;
  if (actor.role !== "superadmin" && currentRole !== "tenant") {
    throw new HttpsError("permission-denied", "Solo un superadmin puede modificar usuarios administrativos.");
  }

  if (actor.role !== "superadmin" && role !== "tenant") {
    throw new HttpsError("permission-denied", "Solo un superadmin puede asignar permisos administrativos.");
  }

  if (role === "tenant" && !currentData.tenantId) {
    throw new HttpsError("failed-precondition", "El usuario inquilino no tiene tenantId canonico.");
  }

  if (role === "tenant") {
    const tenantDoc = await db.collection("tenants").doc(String(currentData.tenantId ?? "")).get();
    const propertyId = String(tenantDoc.get("propertyId") ?? "");
    if (!tenantDoc.exists || !propertyId) {
      throw new HttpsError("failed-precondition", "No se pudo validar la unidad del inquilino.");
    }
    await assertOwnerScopeAccess(request, propertyId);
  }

  const profile = buildCanonicalAuthProfile({
    role,
    status,
    tenantId: role === "tenant" ? String(currentData.tenantId ?? "") : undefined,
    ownerScope: role === "tenant" ? undefined : ownerScope,
    email: String(currentData.email ?? "") || undefined,
    displayName: String(currentData.displayName ?? "") || undefined,
    createdAt: currentData.createdAt ?? nowIso(),
    updatedBy: request.auth?.uid ?? "system"
  });

  await userRef.set(profile, { merge: true });
  await getAuth().setCustomUserClaims(userId, status === "active" ? claimsFromProfile(profile) : null);

  await writeServerAudit(actor, {
    action: "user_permissions_updated",
    entityType: "user",
    entityId: userId,
    summary: `Actualizo permisos de ${profile.displayName || profile.email || "un usuario"}.`,
    metadata: {
      previousRole: currentRole,
      nextRole: role,
      previousOwnerScope: String(currentData.ownerScope ?? "all"),
      nextOwnerScope: profile.ownerScope ?? "",
      previousStatus: String(currentData.status ?? "active"),
      nextStatus: status,
      email: profile.email ?? "",
      tenantId: profile.tenantId ?? ""
    }
  });

  return { ok: true, role: profile.role, status: profile.status, ownerScope: profile.ownerScope ?? null };
});

function buildPropertyCatalog(propertyType: string) {
  if (propertyType === "Casa" || propertyType === "casa") {
    return [
      {
        name: "Casa 1",
        unitType: "Casa",
        unitCode: "1",
        transferBlock: "block_1"
      }
    ];
  }

  if (propertyType === "Local" || propertyType === "local") {
    return Array.from({ length: 4 }, (_, index) => ({
      name: `Local ${index + 1}`,
      unitType: "Local",
      unitCode: String(index + 1),
      transferBlock: "block_1"
    }));
  }

  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return {
      name: `Departamento ${number}`,
      unitType: "Departamento",
      unitCode: String(number),
      transferBlock: number <= 6 ? "block_1" : "block_2"
    };
  });
}

async function findOrCreateProperty(unit: {
  name: string;
  unitType: string;
  unitCode: string;
  transferBlock: string;
}) {
  const propertySnapshot = await db
    .collection("properties")
    .where("unitType", "==", unit.unitType)
    .where("unitCode", "==", unit.unitCode)
    .limit(1)
    .get();

  if (!propertySnapshot.empty) {
    return propertySnapshot.docs[0].ref;
  }

  const propertyRef = db.collection("properties").doc();
  await propertyRef.set({
    name: unit.name,
    unitType: unit.unitType,
    unitCode: unit.unitCode,
    transferBlock: unit.transferBlock,
    status: "active",
    notes: "",
    currentTenantId: null,
    sortOrder: Number(unit.unitCode) || 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  return propertyRef;
}

async function updateOpenChargesForTenantOpenChargeConfig(
  tenantId: string,
  {
    baseRent,
    dueDayOfMonth
  }: {
    baseRent: number;
    dueDayOfMonth: number | null;
  },
  actorUserId: string
) {
  const chargesSnapshot = await db.collection("charges").where("tenantId", "==", tenantId).get();

  for (const chargeDoc of chargesSnapshot.docs) {
    const charge = chargeDoc.data() as {
      status?: string;
      period?: string;
      dueDate?: string;
      items?: Array<{ key?: string; label?: string; amount?: number }>;
      lateFeeAmount?: number;
    };

    if (["paid", "cancelled"].includes(String(charge.status ?? ""))) {
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

    const subtotal = roundCurrency(
      items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    );
    const lateFeeAmount = Number(charge.lateFeeAmount ?? 0);
    const dueDate = buildChargeDueDate(String(charge.period ?? ""), dueDayOfMonth ?? null, String(charge.dueDate ?? ""));

    await chargeDoc.ref.set(
      {
        items,
        subtotal,
        dueDate,
        total: roundCurrency(subtotal + lateFeeAmount),
        updatedAt: nowIso(),
        updatedBy: actorUserId
      },
      { merge: true }
    );
  }
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeDueDayOfMonth(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.trunc(numeric);
  if (rounded < 1 || rounded > 28) {
    return null;
  }

  return rounded;
}

function normalizeRentScheduleFrequency(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "quarterly" || normalized === "semiannual") {
    return normalized;
  }

  return "quarterly";
}

function normalizePeriodValue(value: unknown) {
  const period = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

function buildChargeDueDate(period: string, dueDayOfMonth: number | null, fallback: string) {
  if (/^\d{4}-\d{2}$/.test(period) && dueDayOfMonth) {
    const duePeriod = addMonthsToPeriod(period, 1);
    if (duePeriod) {
      return `${duePeriod}-${String(dueDayOfMonth).padStart(2, "0")}`;
    }
  }

  return fallback;
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

async function resolveDefaultBaseRent(unitType: string) {
  if (String(unitType ?? "").trim() === "Departamento") {
    return 321680;
  }

  const generalSettingsDoc = await db.collection("settings").doc("general").get();
  const defaultRents = (generalSettingsDoc.get("defaultRents") ?? {}) as Record<string, unknown>;
  const configuredValue = Number(defaultRents[String(unitType)] ?? 0);
  return Number.isFinite(configuredValue) && configuredValue > 0 ? configuredValue : 0;
}
