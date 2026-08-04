import { createRequire } from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = requireFromFunctions("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-alquileres-la-casona";
const functionHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

assertLocalEmulatorsOnly();

admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const auth = admin.auth();
const db = admin.firestore();

const users = {
  superadmin: { uid: "auth-authority-superadmin", email: "auth-superadmin@example.test", password: "Local123!" },
  adminEnzo: { uid: "auth-authority-admin-enzo", email: "auth-admin-enzo@example.test", password: "Local123!" },
  adminIvo: { uid: "auth-authority-admin-ivo", email: "auth-admin-ivo@example.test", password: "Local123!" },
  adminAll: { uid: "auth-authority-admin-all", email: "auth-admin-all@example.test", password: "Local123!" },
  tenant: { uid: "auth-authority-tenant", email: "auth-tenant@example.test", password: "Local123!" },
  disabled: { uid: "auth-authority-disabled", email: "auth-disabled@example.test", password: "Local123!" },
  missingProfile: { uid: "auth-authority-missing", email: "auth-missing@example.test", password: "Local123!" },
  staleAdmin: { uid: "auth-authority-stale-admin", email: "auth-stale-admin@example.test", password: "Local123!" },
  staleTenant: { uid: "auth-authority-stale-tenant", email: "auth-stale-tenant@example.test", password: "Local123!" }
};

const checks = [];

await seedMatrix();
await verifyCallableMatrix();
await verifyFirestoreMatrix();
await verifyStorageProjectionMatrix();

console.table(checks);
const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  throw new Error(`Auth authority verification failed: ${failed.map((check) => check.name).join(", ")}`);
}

console.log("Auth authority emulator verification passed.");

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

async function seedMatrix() {
  await Promise.all(Object.values(users).map(async (user) => {
    await auth.deleteUser(user.uid).catch(() => null);
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password, emailVerified: true });
  }));

  await db.doc("properties/property-enzo").set({ ownerScope: "enzo", status: "active", unitType: "Casa", unitCode: "1" });
  await db.doc("properties/property-ivo").set({ ownerScope: "ivo", status: "active", unitType: "Departamento", unitCode: "8" });
  await db.doc("tenants/tenant-t1").set({ email: users.tenant.email, propertyId: "property-enzo", status: "active", fullName: "Tenant T1" });
  await db.doc("tenants/tenant-t2").set({ email: users.staleTenant.email, propertyId: "property-ivo", status: "active", fullName: "Tenant T2" });
  await db.doc("charges/charge-t2").set({ tenantId: "tenant-t2", propertyId: "property-ivo", status: "pending", amount: 100 });

  await setAuthority(users.superadmin.uid, { role: "superadmin", ownerScope: "all" });
  await setAuthority(users.adminEnzo.uid, { role: "admin", ownerScope: "enzo" });
  await setAuthority(users.adminIvo.uid, { role: "admin", ownerScope: "ivo" });
  await setAuthority(users.adminAll.uid, { role: "admin", ownerScope: "all" });
  await setAuthority(users.tenant.uid, { role: "tenant", tenantId: "tenant-t1" });
  await setAuthority(users.disabled.uid, { role: "admin", ownerScope: "all", status: "disabled" });

  await auth.setCustomUserClaims(users.missingProfile.uid, { role: "admin", ownerScope: "all" });

  await db.doc(`users/${users.staleAdmin.uid}`).set({ role: "tenant", tenantId: "tenant-t1", status: "active", email: users.staleAdmin.email });
  await auth.setCustomUserClaims(users.staleAdmin.uid, { role: "admin", ownerScope: "all" });

  await db.doc(`users/${users.staleTenant.uid}`).set({ role: "tenant", tenantId: "tenant-t2", status: "active", email: users.staleTenant.email });
  await auth.setCustomUserClaims(users.staleTenant.uid, { role: "tenant", tenantId: "tenant-t1" });
}

async function setAuthority(uid, profile) {
  await db.doc(`users/${uid}`).set({ ...profile, status: profile.status || "active", updatedAt: new Date().toISOString() });
  await auth.setCustomUserClaims(uid, profile.status === "disabled" ? null : profile);
}

async function verifyCallableMatrix() {
  await expectCallable("superadmin/all callable admin dataset", users.superadmin, "getScopedAdminDataset", {}, true);
  await expectCallable("admin/enzo callable admin dataset", users.adminEnzo, "getScopedAdminDataset", {}, true);
  await expectCallable("disabled profile denied", users.disabled, "getScopedAdminDataset", {}, false);
  await expectCallable("missing profile denied despite admin claim", users.missingProfile, "getScopedAdminDataset", {}, false);
  await expectCallable("stale admin claim denied by profile role", users.staleAdmin, "getScopedAdminDataset", {}, false);
  await expectCallable("stale tenant claim mismatch denied", users.staleTenant, "submitTransferPayment", {
    tenantId: "tenant-t1",
    chargeId: "charge-t2",
    amountReported: 100,
    receiptIds: ["receipt-test"]
  }, false);
}

async function verifyFirestoreMatrix() {
  await expectFirestoreGet("tenant reads own profile", users.tenant, `users/${users.tenant.uid}`, true);
  await expectFirestoreGet("missing profile cannot read users", users.missingProfile, `users/${users.tenant.uid}`, false);
  await expectFirestoreGet("disabled profile cannot read admin data", users.disabled, "properties/property-enzo", false);
  await expectFirestoreGet("stale admin follows tenant profile", users.staleAdmin, "properties/property-ivo", false);
}

async function verifyStorageProjectionMatrix() {
  record("storage limitation documented", true, "Storage rules use request.auth.token projection because Firestore profile reads are unavailable in Storage rules.");
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

async function expectFirestoreGet(name, user, documentPath, shouldAllow) {
  const token = await signIn(user);
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  record(name, shouldAllow ? response.ok : !response.ok, String(response.status));
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
