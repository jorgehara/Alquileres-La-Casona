import { onCall, HttpsError } from "firebase-functions/https";
import { getAuth } from "firebase-admin/auth";
import { db } from "../firebase.js";
import { normalizeOwnerScope, requireRole } from "../lib/auth.js";
import { nowIso, randomToken } from "../lib/utils.js";
import { ensureCurrentChargeForTenant } from "./charges.js";
import { sendTenantNotification } from "./notifications.js";

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

  const tenantDoc = await db.collection("tenants").doc(data.tenantId).get();
  if (!tenantDoc.exists) {
    throw new HttpsError("not-found", "No existe el inquilino indicado.");
  }

  let userRecord;

  try {
    userRecord = await getAuth().getUserByEmail(data.email);
  } catch {
    userRecord = await getAuth().createUser({
      email: data.email,
      displayName: data.displayName
    });
  }

  await getAuth().setCustomUserClaims(userRecord.uid, {
    role: "tenant",
    tenantId: data.tenantId
  });

  const invitationToken = randomToken(32);

  await db.collection("tenantInvitations").doc(invitationToken).set({
    tenantId: data.tenantId,
    userId: userRecord.uid,
    email: data.email,
    createdAt: nowIso(),
    createdBy: request.auth?.uid ?? "system",
    status: "pending"
  });

  await db.collection("users").doc(userRecord.uid).set(
    {
      role: "tenant",
      tenantId: data.tenantId,
      email: data.email,
      displayName: data.displayName ?? tenantDoc.get("fullName") ?? "",
      status: "active",
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await tenantDoc.ref.set(
    {
      invitationStatus: "pending",
      invitationToken,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  return {
    ok: true,
    invitationToken
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

  const userRef = db.collection("users").doc(request.auth.uid);
  const existingUser = await userRef.get();
  if (existingUser.exists) {
    throw new HttpsError("already-exists", "Esa cuenta ya tiene un perfil configurado.");
  }

  const data = request.data as {
    propertyType?: string;
    propertyCode?: string;
    fullName?: string;
    dni?: string;
    phone?: string;
    contractEndDate?: string;
  };

  const propertyType = String(data.propertyType ?? "").trim();
  const propertyCode = String(data.propertyCode ?? "").trim();
  const fullName = String(data.fullName ?? "").trim();
  const dni = String(data.dni ?? "").trim();
  const phone = String(data.phone ?? "").trim();
  const contractEndDate = String(data.contractEndDate ?? "").trim();

  if (!propertyType || !fullName || !dni || !phone || !contractEndDate) {
    throw new HttpsError("invalid-argument", "Faltan datos obligatorios para crear el perfil.");
  }

  const catalog = buildPropertyCatalog(propertyType);
  const selectedUnit = catalog.find((unit) => unit.unitCode === (propertyCode || catalog[0]?.unitCode));

  if (!selectedUnit) {
    throw new HttpsError("invalid-argument", "La propiedad elegida no es valida.");
  }

  let propertyRef = await findOrCreateProperty(selectedUnit);
  const defaultBaseRent = await resolveDefaultBaseRent(selectedUnit.unitType);

  const activeTenantSnapshot = await db
    .collection("tenants")
    .where("propertyId", "==", propertyRef.id)
    .where("status", "==", "active")
    .limit(1)
    .get();

  if (!activeTenantSnapshot.empty) {
    throw new HttpsError("already-exists", "Esa propiedad ya fue tomada por otro perfil.");
  }

  const tenantRef = db.collection("tenants").doc();
  await tenantRef.set({
    fullName,
    dni,
    phone,
    email: request.auth.token.email,
    propertyId: propertyRef.id,
    baseRent: defaultBaseRent,
    dueDayOfMonth: null,
    rentSchedule: {
      frequency: "quarterly",
      nextAdjustmentPeriod: null
    },
    contractStartDate: nowIso().slice(0, 10),
    contractEndDate,
    invitationStatus: "self_registered",
    profileSetupCompleted: true,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await propertyRef.set(
    {
      currentTenantId: tenantRef.id,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await userRef.set({
    role: "tenant",
    tenantId: tenantRef.id,
    displayName: fullName,
    email: request.auth.token.email,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await ensureCurrentChargeForTenant(tenantRef.id, request.auth.uid);

  await sendTenantNotification({
    tenantId: tenantRef.id,
    type: "profile_created",
    body: `Hola ${fullName}, tu perfil de inquilino en La Casona ya quedo configurado.`,
    channel: "email",
    createdBy: request.auth.uid
  });

  return { ok: true, tenantId: tenantRef.id };
});

export const claimTenantAccess = onCall(async (request) => {
  if (!request.auth?.uid || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "Necesitas iniciar sesiÃ³n para vincular tu perfil.");
  }

  const email = String(request.auth.token.email).trim().toLowerCase();
  const userRef = db.collection("users").doc(request.auth.uid);
  const userDoc = await userRef.get();

  if (userDoc.exists) {
    const role = String(userDoc.get("role") ?? "");
    if (role) {
      return {
        ok: true,
        alreadyLinked: true,
        role,
        tenantId: String(userDoc.get("tenantId") ?? "")
      };
    }
  }

  let tenantId = "";
  let displayName = "";

  const invitationDoc = await db.collection("tenantInvitations").doc(email).get();
  if (invitationDoc.exists) {
    tenantId = String(invitationDoc.get("tenantId") ?? "");
    displayName = String(invitationDoc.get("displayName") ?? "");
  }

  if (!tenantId) {
    const tenantSnapshot = await db
      .collection("tenants")
      .where("email", "==", email)
      .where("status", "==", "active")
      .limit(2)
      .get();

    if (tenantSnapshot.size > 1) {
      throw new HttpsError(
        "failed-precondition",
        "Hay mÃ¡s de un inquilino activo con este correo. Un administrador debe revisar el dato."
      );
    }

    if (tenantSnapshot.empty) {
      throw new HttpsError(
        "permission-denied",
        "No encontramos un perfil de inquilino activo asociado a este correo."
      );
    }

    const tenantDoc = tenantSnapshot.docs[0];
    tenantId = tenantDoc.id;
    displayName = String(tenantDoc.get("fullName") ?? "");
  }

  if (!tenantId) {
    throw new HttpsError("permission-denied", "No se pudo identificar el perfil del inquilino.");
  }

  const tenantDoc = await db.collection("tenants").doc(tenantId).get();
  if (!tenantDoc.exists || String(tenantDoc.get("status") ?? "active") !== "active") {
    throw new HttpsError("permission-denied", "El perfil del inquilino no estÃ¡ activo.");
  }

  await getAuth().setCustomUserClaims(request.auth.uid, {
    role: "tenant",
    tenantId
  });

  await userRef.set(
    {
      role: "tenant",
      tenantId,
      displayName: displayName || String(tenantDoc.get("fullName") ?? email.split("@")[0]),
      email,
      status: "active",
      createdAt: userDoc.exists ? userDoc.get("createdAt") ?? nowIso() : nowIso(),
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await db.collection("tenantInvitations").doc(email).set(
    {
      tenantId,
      email,
      displayName: displayName || String(tenantDoc.get("fullName") ?? ""),
      status: "claimed",
      claimedAt: nowIso(),
      claimedBy: request.auth.uid,
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await db.collection("tenants").doc(tenantId).set(
    {
      invitationStatus: "claimed",
      updatedAt: nowIso()
    },
    { merge: true }
  );

  return {
    ok: true,
    tenantId,
    role: "tenant"
  };
});

export const updateTenantContactSettings = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Necesitas iniciar sesion.");
  }

  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!userDoc.exists || userDoc.get("role") !== "tenant") {
    throw new HttpsError("permission-denied", "Solo un inquilino puede editar estos datos.");
  }

  const tenantId = String(userDoc.get("tenantId") ?? "");
  const data = request.data as { email?: string; phone?: string };

  await db.collection("users").doc(request.auth.uid).set(
    {
      email: String(data.email ?? request.auth.token.email ?? ""),
      updatedAt: nowIso()
    },
    { merge: true }
  );

  await db.collection("tenants").doc(tenantId).set(
    {
      email: String(data.email ?? request.auth.token.email ?? ""),
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

export const updateTenantAdminProfile = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

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
  const email = String(data.email ?? "").trim().toLowerCase();
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
    await linkedUserDoc.ref.set(
      {
        displayName: fullName,
        email,
        updatedAt: nowIso()
      },
      { merge: true }
    );

    const authUpdates: { displayName?: string; email?: string } = { displayName: fullName };
    if (email) {
      authUpdates.email = email;
    }
    await getAuth().updateUser(linkedUserDoc.id, authUpdates);
  }

  if (previousEmail && previousEmail !== email) {
    await db.collection("tenantInvitations").doc(previousEmail).delete().catch(() => null);
  }

  if (email) {
    await db.collection("tenantInvitations").doc(email).set(
      {
        tenantId,
        email,
        displayName: fullName,
        status: linkedUserDoc ? "accepted" : "pending",
        updatedAt: nowIso(),
        createdBy: request.auth?.uid ?? "system"
      },
      { merge: true }
    );
  }

  await updateOpenChargesForTenantOpenChargeConfig(
    tenantId,
    {
      baseRent,
      dueDayOfMonth
    },
    request.auth?.uid ?? "system"
  );

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

  await getAuth().setCustomUserClaims(userRecord.uid, {
    role,
    ownerScope
  });

  await db.collection("users").doc(userRecord.uid).set(
    {
      role,
      ownerScope,
      email,
      displayName,
      status: "active",
      updatedAt: nowIso(),
      updatedBy: request.auth?.uid ?? "system"
    },
    { merge: true }
  );

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

  await getAuth().setCustomUserClaims(request.auth.uid, {
    role: "superadmin"
  });

  await userRef.set(
    {
      role: "superadmin",
      displayName,
      email: request.auth.token.email,
      status: "active",
      createdAt: existingUserData.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      updatedBy: request.auth.uid
    },
    { merge: true }
  );

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


