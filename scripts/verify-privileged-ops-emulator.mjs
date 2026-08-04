import { createRequire } from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = requireFromFunctions("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-alquileres-la-casona";
const functionHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

assertLocalEmulatorsOnly();

admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const auth = admin.auth();
const db = admin.firestore();
const checks = [];

const users = {
  superadmin: { uid: "privileged-ops-superadmin", email: "privileged-superadmin@example.test", password: "Local123!" },
  adminEnzo: { uid: "privileged-ops-admin-enzo", email: "privileged-admin-enzo@example.test", password: "Local123!" },
  tenantA: { uid: "privileged-ops-tenant-a", email: "privileged-tenant-a@example.test", password: "Local123!" },
  tenantB: { uid: "privileged-ops-tenant-b", email: "privileged-tenant-b@example.test", password: "Local123!" },
  disabled: { uid: "privileged-ops-disabled", email: "privileged-disabled@example.test", password: "Local123!" }
};

await seed();
await verifyDirectWritesDenied();
await verifyCallableDeactivateTenant();
await verifyCallableDeleteTenant();
await verifyCallableDeleteUserAccess();

console.table(checks);
const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  throw new Error(`Privileged ops verification failed: ${failed.map((check) => check.name).join(", ")}`);
}

console.log("Privileged tenant/user ops emulator verification passed.");

function assertLocalEmulatorsOnly() {
  const required = [
    ["FIRESTORE_EMULATOR_HOST", process.env.FIRESTORE_EMULATOR_HOST],
    ["FIREBASE_AUTH_EMULATOR_HOST", process.env.FIREBASE_AUTH_EMULATOR_HOST],
    ["FUNCTIONS_EMULATOR_HOST", process.env.FUNCTIONS_EMULATOR_HOST]
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Run through Firebase emulators only. Missing: ${missing.join(", ")}`);
  }
}

async function seed() {
  await Promise.all(Object.values(users).map(async (user) => {
    await auth.deleteUser(user.uid).catch(() => null);
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password, emailVerified: true });
  }));

  await db.recursiveDelete(db.collection("auditLogs"));
  await db.doc("properties/privileged-property-a").set({ ownerScope: "enzo", status: "active", unitType: "Casa", unitCode: "1", currentTenantId: "privileged-tenant-a" });
  await db.doc("properties/privileged-property-b").set({ ownerScope: "enzo", status: "active", unitType: "Local", unitCode: "1", currentTenantId: "privileged-tenant-b" });
  await db.doc("properties/privileged-property-c").set({ ownerScope: "enzo", status: "active", unitType: "Departamento", unitCode: "1", currentTenantId: "privileged-tenant-c" });

  await setAuthority(users.superadmin.uid, { role: "superadmin", ownerScope: "all", email: users.superadmin.email, displayName: "Super Admin" });
  await setAuthority(users.adminEnzo.uid, { role: "admin", ownerScope: "enzo", email: users.adminEnzo.email, displayName: "Admin Enzo" });
  await setAuthority(users.disabled.uid, { role: "admin", ownerScope: "enzo", status: "disabled", email: users.disabled.email, displayName: "Disabled Admin" });
  await setTenant("privileged-tenant-a", users.tenantA, "privileged-property-a", "Tenant A");
  await setTenant("privileged-tenant-b", users.tenantB, "privileged-property-b", "Tenant B");
  await db.doc("tenants/privileged-tenant-c").set({ email: "privileged-tenant-c@example.test", propertyId: "privileged-property-c", status: "active", invitationStatus: "pending", fullName: "Tenant C" });
  await db.doc("tenantInvitations/privileged-tenant-c@example.test").set({ tenantId: "privileged-tenant-c", email: "privileged-tenant-c@example.test", status: "pending" });
}

async function setTenant(tenantId, user, propertyId, displayName) {
  await db.doc(`tenants/${tenantId}`).set({ email: user.email, propertyId, status: "active", invitationStatus: "claimed", fullName: displayName });
  await db.doc(`tenantInvitations/${user.email}`).set({ tenantId, email: user.email, status: "claimed", userId: user.uid });
  await setAuthority(user.uid, { role: "tenant", tenantId, email: user.email, displayName });
}

async function setAuthority(uid, profile) {
  const storedProfile = { ...profile, status: profile.status || "active", updatedAt: new Date().toISOString() };
  await db.doc(`users/${uid}`).set(storedProfile);
  await auth.setCustomUserClaims(uid, storedProfile.status === "disabled" ? null : storedProfile);
}

async function verifyDirectWritesDenied() {
  await expectFirestorePatch("admin direct users authority update denied", users.adminEnzo, `users/${users.tenantA.uid}`, { status: "inactive" }, false);
  await expectFirestoreDelete("admin direct users delete denied", users.adminEnzo, `users/${users.tenantA.uid}`, false);
  await expectFirestorePatch("admin direct tenant lifecycle update denied", users.adminEnzo, "tenants/privileged-tenant-a", { status: "inactive" }, false);
  await expectFirestoreDelete("admin direct tenant delete denied", users.adminEnzo, "tenants/privileged-tenant-a", false);
  await expectFirestorePatch("admin direct invitation revoke denied", users.adminEnzo, `tenantInvitations/${users.tenantA.email}`, { status: "revoked" }, false);
  await expectFirestoreDelete("admin direct invitation delete denied", users.adminEnzo, `tenantInvitations/${users.tenantA.email}`, false);
  await expectFirestorePatch("admin direct property occupancy change denied", users.adminEnzo, "properties/privileged-property-a", { currentTenantId: null }, false);
}

async function verifyCallableDeactivateTenant() {
  await expectCallable("disabled admin cannot deactivate tenant", users.disabled, "deactivateTenant", { tenantId: "privileged-tenant-a" }, false);
  await expectCallable("admin can deactivate tenant", users.adminEnzo, "deactivateTenant", { tenantId: "privileged-tenant-a" }, true);

  const tenantDoc = await db.doc("tenants/privileged-tenant-a").get();
  const propertyDoc = await db.doc("properties/privileged-property-a").get();
  const userDoc = await db.doc(`users/${users.tenantA.uid}`).get();
  const invitationDoc = await db.doc(`tenantInvitations/${users.tenantA.email}`).get();
  record("deactivate tenant side effects consistent", tenantDoc.get("status") === "inactive"
    && propertyDoc.get("currentTenantId") === null
    && userDoc.get("status") === "inactive"
    && invitationDoc.get("status") === "revoked");
}

async function verifyCallableDeleteTenant() {
  await expectCallable("admin can delete tenant profile", users.adminEnzo, "deleteTenantProfile", { tenantId: "privileged-tenant-b" }, true);
  const tenantDoc = await db.doc("tenants/privileged-tenant-b").get();
  const userDoc = await db.doc(`users/${users.tenantB.uid}`).get();
  const invitationDoc = await db.doc(`tenantInvitations/${users.tenantB.email}`).get();
  const propertyDoc = await db.doc("properties/privileged-property-b").get();
  record("delete tenant side effects consistent", !tenantDoc.exists && !userDoc.exists && !invitationDoc.exists && propertyDoc.get("currentTenantId") === null);
}

async function verifyCallableDeleteUserAccess() {
  await expectCallable("admin can delete tenant user access", users.adminEnzo, "deleteUserAccess", { userId: users.tenantA.uid }, true);
  await expectCallable("admin cannot delete administrative user", users.adminEnzo, "deleteUserAccess", { userId: users.superadmin.uid }, false);
  const userDoc = await db.doc(`users/${users.tenantA.uid}`).get();
  record("delete user access removes authority profile", !userDoc.exists);
}

async function expectCallable(name, user, functionName, data, shouldAllow) {
  const token = await signIn(user);
  const response = await fetch(`http://${functionHost}/${projectId}/us-central1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data })
  });
  const payload = await response.json().catch(() => ({}));
  record(name, shouldAllow ? response.ok && !payload.error : !response.ok || Boolean(payload.error), JSON.stringify(payload.error || payload.result || {}));
}

async function expectFirestorePatch(name, user, documentPath, fields, shouldAllow) {
  const token = await signIn(user);
  const response = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: encodeFields(fields) })
  });
  record(name, shouldAllow ? response.ok : !response.ok, String(response.status));
}

async function expectFirestoreDelete(name, user, documentPath, shouldAllow) {
  const token = await signIn(user);
  const response = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  record(name, shouldAllow ? response.ok : !response.ok, String(response.status));
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

function encodeValue(value) {
  if (value === null) {
    return { nullValue: null };
  }
  if (typeof value === "number") {
    return { integerValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  return { stringValue: String(value) };
}

async function signIn(user) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password, returnSecureToken: true })
  });
  const payload = await response.json();
  if (!response.ok || !payload.idToken) {
    throw new Error(`Could not sign in ${user.email}: ${JSON.stringify(payload)}`);
  }
  return payload.idToken;
}

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}
