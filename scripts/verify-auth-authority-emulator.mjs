import { createRequire } from "node:module";

const requireFromFunctions = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = requireFromFunctions("firebase-admin");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-alquileres-la-casona";
const functionHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";
const storageBucket = `${projectId}.appspot.com`;

assertLocalEmulatorsOnly();

initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const auth = getAuth();
const db = getFirestore();

const users = {
  superadmin: { uid: "auth-authority-superadmin", email: "auth-superadmin@example.test", password: "Local123!" },
  adminEnzo: { uid: "auth-authority-admin-enzo", email: "auth-admin-enzo@example.test", password: "Local123!" },
  adminIvo: { uid: "auth-authority-admin-ivo", email: "auth-admin-ivo@example.test", password: "Local123!" },
  adminAll: { uid: "auth-authority-admin-all", email: "auth-admin-all@example.test", password: "Local123!" },
  tenant: { uid: "auth-authority-tenant", email: "auth-tenant@example.test", password: "Local123!" },
  claimant: { uid: "auth-authority-claimant", email: "auth-claimant@example.test", password: "Local123!" },
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
    ["FIREBASE_STORAGE_EMULATOR_HOST", process.env.FIREBASE_STORAGE_EMULATOR_HOST]
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Run through Firebase emulators only. Missing: ${missing.join(", ")}`);
  }
  if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(functionHost)) {
    throw new Error(`Refusing to call non-local Functions host: ${functionHost}`);
  }
  if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/.test(storageHost)) {
    throw new Error(`Refusing to call non-local Storage host: ${storageHost}`);
  }
}

async function seedMatrix() {
  await resetCollections();

  await Promise.all(Object.values(users).map(async (user) => {
    await auth.deleteUser(user.uid).catch(() => null);
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password, emailVerified: true });
  }));

  await db.doc("properties/property-enzo").set({ ownerScope: "enzo", status: "active", unitType: "Casa", unitCode: "1" });
  await db.doc("properties/property-ivo").set({ ownerScope: "ivo", status: "active", unitType: "Departamento", unitCode: "8" });
  await db.doc("tenants/tenant-t1").set({ email: users.tenant.email, propertyId: "property-enzo", status: "active", fullName: "Tenant T1" });
  await db.doc("tenants/tenant-t2").set({ email: users.staleTenant.email, propertyId: "property-ivo", status: "active", fullName: "Tenant T2" });
  await db.doc("tenants/tenant-claim").set({ email: users.claimant.email, propertyId: "property-enzo", status: "active", fullName: "Claimant Tenant" });
  await db.doc("charges/charge-t1").set({ tenantId: "tenant-t1", propertyId: "property-enzo", status: "pending", amount: 100, subtotal: 100, total: 100, dueDate: "2026-08-10" });
  await db.doc("charges/charge-t2").set({ tenantId: "tenant-t2", propertyId: "property-ivo", status: "pending", amount: 100, subtotal: 100, total: 100, dueDate: "2026-08-10" });
  await db.doc("payments/payment-t1").set({ tenantId: "tenant-t1", chargeId: "charge-t1", status: "reported", method: "transfer" });
  await db.doc("payments/payment-t2").set({ tenantId: "tenant-t2", chargeId: "charge-t2", status: "reported", method: "transfer" });
  await db.doc("paymentReceipts/receipt-t1").set({ tenantId: "tenant-t1", paymentId: "payment-t1", storagePath: "payment-receipts/tenant-t1/receipt-t1.jpg" });
  await db.doc("paymentReceipts/receipt-t2").set({ tenantId: "tenant-t2", paymentId: "payment-t2", storagePath: "payment-receipts/tenant-t2/receipt-t2.jpg" });
  await db.doc("rentReceipts/rent-t1").set({ tenantId: "tenant-t1", ownerScope: "enzo", period: "2026-08" });
  await db.doc("rentReceipts/rent-t2").set({ tenantId: "tenant-t2", ownerScope: "ivo", period: "2026-08" });
  await db.doc("messages/message-t1").set({ tenantId: "tenant-t1", body: "Tenant T1 message" });
  await db.doc("messages/message-t2").set({ tenantId: "tenant-t2", body: "Tenant T2 message" });
  await db.doc(`tenantInvitations/${users.tenant.email}`).set({ tenantId: "tenant-t1", email: users.tenant.email, status: "claimed" });
  await db.doc(`tenantInvitations/${users.claimant.email}`).set({ tenantId: "tenant-claim", email: users.claimant.email, status: "pending" });

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

async function resetCollections() {
  const collections = [
    "properties",
    "tenants",
    "charges",
    "payments",
    "paymentReceipts",
    "rentReceipts",
    "messages",
    "rentAdjustments",
    "rentAdjustmentPolicies",
    "tenantInvitations",
    "auditLogs",
    "users"
  ];

  for (const collectionName of collections) {
    await db.recursiveDelete(db.collection(collectionName)).catch(() => null);
  }
}

async function setAuthority(uid, profile) {
  await db.doc(`users/${uid}`).set({ ...profile, status: profile.status || "active", updatedAt: new Date().toISOString() });
  await auth.setCustomUserClaims(uid, profile.status === "disabled" ? null : profile);
}

async function verifyCallableMatrix() {
  await expectCallable("superadmin/all callable admin dataset", users.superadmin, "getScopedAdminDataset", {}, true, (payload) =>
    resultArray(payload, "properties").some((property) => property.id === "property-enzo")
    && resultArray(payload, "properties").some((property) => property.id === "property-ivo"));
  await expectCallable("admin/enzo callable admin dataset is owner-scoped", users.adminEnzo, "getScopedAdminDataset", {}, true, (payload) => {
    const properties = resultArray(payload, "properties");
    return properties.some((property) => property.id === "property-enzo")
      && !properties.some((property) => property.id === "property-ivo");
  });
  await expectCallable("tenant onboarding claim creates canonical tenant authority", users.claimant, "claimTenantAccess", {}, true, async (payload) => {
    const profile = await db.doc(`users/${users.claimant.uid}`).get();
    return Boolean(payload.result?.ok) && profile.get("role") === "tenant" && profile.get("tenantId") === "tenant-claim";
  });
  await expectCallable("tenant-only payment callable reaches business validation for own tenant", users.tenant, "submitTransferPayment", {
    tenantId: "tenant-t1",
    chargeId: "charge-t1",
    amountReported: 100,
    receiptIds: ["receipt-t1-callable"]
  }, true, (payload, response) => authReachedBusinessValidation(payload, response));
  await expectCallable("disabled profile denied", users.disabled, "getScopedAdminDataset", {}, false);
  await expectCallable("missing profile denied despite admin claim", users.missingProfile, "getScopedAdminDataset", {}, false);
  await expectCallable("stale admin claim denied by profile role", users.staleAdmin, "getScopedAdminDataset", {}, false);
  await expectCallable("stale tenant claim mismatch denied", users.staleTenant, "submitTransferPayment", {
    tenantId: "tenant-t1",
    chargeId: "charge-t2",
    amountReported: 100,
    receiptIds: ["receipt-test"]
  }, false);
  await expectCallable("superadmin-only settings callable allows superadmin", users.superadmin, "upsertGeneralSettings", { reminderDaysBeforeDue: 5 }, true);
  await expectCallable("superadmin-only settings callable denies scoped admin", users.adminEnzo, "upsertGeneralSettings", { reminderDaysBeforeDue: 6 }, false);
  await expectCallable("audit-sensitive callable allows admin", users.adminAll, "writeAuditLog", {
    action: "auth_authority_verification",
    entityType: "verification",
    entityId: "callable-matrix",
    summary: "Auth authority matrix verifier audit entry"
  }, true, (payload) => Boolean(payload.result?.auditLogId));
  await expectCallable("audit-sensitive callable denies tenant", users.tenant, "writeAuditLog", {
    action: "auth_authority_verification",
    entityType: "verification",
    summary: "Tenant should not write audit logs"
  }, false);
  await expectCallable("unauthenticated callable denied", null, "getScopedAdminDataset", {}, false);
}

async function verifyFirestoreMatrix() {
  await expectFirestoreGet("tenant reads own profile", users.tenant, `users/${users.tenant.uid}`, true);
  await expectFirestoreGet("admin reads users collection", users.adminEnzo, `users/${users.tenant.uid}`, true);
  await expectFirestoreGet("missing profile cannot read users", users.missingProfile, `users/${users.tenant.uid}`, false);
  await expectFirestoreGet("disabled profile cannot read admin data", users.disabled, "properties/property-enzo", false);
  await expectFirestoreGet("stale admin follows tenant profile", users.staleAdmin, "properties/property-ivo", false);
  await expectFirestoreGet("admin/enzo reads enzo property", users.adminEnzo, "properties/property-enzo", true);
  await expectFirestoreGet("admin/enzo denied ivo property", users.adminEnzo, "properties/property-ivo", false);
  await expectFirestoreGet("admin/all reads ivo property", users.adminAll, "properties/property-ivo", true);
  await expectFirestoreGet("tenant reads own property", users.tenant, "properties/property-enzo", true);
  await expectFirestoreGet("tenant denied other property", users.tenant, "properties/property-ivo", false);
  await expectFirestoreGet("tenant reads own tenant doc", users.tenant, "tenants/tenant-t1", true);
  await expectFirestoreGet("tenant denied other tenant doc", users.tenant, "tenants/tenant-t2", false);
  await expectFirestoreGet("admin/ivo reads ivo tenant", users.adminIvo, "tenants/tenant-t2", true);
  await expectFirestoreGet("admin/ivo denied enzo tenant", users.adminIvo, "tenants/tenant-t1", false);
  await expectFirestoreGet("tenant reads own charge", users.tenant, "charges/charge-t1", true);
  await expectFirestoreGet("tenant denied other charge", users.tenant, "charges/charge-t2", false);
  await expectFirestoreGet("admin/enzo denied ivo charge", users.adminEnzo, "charges/charge-t2", false);
  await expectFirestoreGet("tenant reads own payment", users.tenant, "payments/payment-t1", true);
  await expectFirestoreGet("tenant denied other payment", users.tenant, "payments/payment-t2", false);
  await expectFirestoreGet("tenant reads own payment receipt", users.tenant, "paymentReceipts/receipt-t1", true);
  await expectFirestoreGet("tenant denied other payment receipt", users.tenant, "paymentReceipts/receipt-t2", false);
  await expectFirestoreGet("tenant reads own rent receipt", users.tenant, "rentReceipts/rent-t1", true);
  await expectFirestoreGet("tenant denied other rent receipt", users.tenant, "rentReceipts/rent-t2", false);
  await expectFirestoreGet("admin/ivo reads ivo rent receipt", users.adminIvo, "rentReceipts/rent-t2", true);
  await expectFirestoreGet("admin/enzo denied ivo rent receipt", users.adminEnzo, "rentReceipts/rent-t2", false);
  await expectFirestoreGet("tenant reads own message", users.tenant, "messages/message-t1", true);
  await expectFirestoreGet("tenant denied other message", users.tenant, "messages/message-t2", false);
  await expectFirestoreGet("admin/enzo reads tenant invitation", users.adminEnzo, `tenantInvitations/${users.claimant.email}`, true);
  await expectFirestoreGet("invited claimant reads own tenant invitation", users.claimant, `tenantInvitations/${users.claimant.email}`, true);
  await expectFirestoreGet("missing profile denied other tenant invitation", users.missingProfile, `tenantInvitations/${users.claimant.email}`, false);
  await expectFirestoreGet("unauthenticated Firestore read denied", null, "properties/property-enzo", false);
}

async function verifyStorageProjectionMatrix() {
  const utilityBill = "utility-bills/enzo/bill-aug/auth-authority.txt";
  const tenantPaymentReceipt = `payment-receipts/${users.tenant.uid}/payment-aug/auth-authority.txt`;
  const staleTenantPaymentReceipt = `payment-receipts/${users.staleTenant.uid}/payment-aug/auth-authority.txt`;
  const contract = "contracts/lease-enzo/auth-authority.txt";
  const messageAttachment = "message-attachments/message-t1/auth-authority.txt";
  const tenantRentReceipt = "rent-receipts/tenant-t1/receipt-aug/auth-authority.txt";
  const otherTenantRentReceipt = "rent-receipts/tenant-t2/receipt-aug/auth-authority.txt";

  await expectStorageWrite("storage utility-bills admin/all write allowed", users.adminAll, utilityBill, true);
  await expectStorageRead("storage utility-bills admin/enzo read allowed by admin claim", users.adminEnzo, utilityBill, true);
  await expectStorageRead("storage utility-bills tenant read denied", users.tenant, utilityBill, false);
  await expectStorageWrite("storage utility-bills tenant write denied", users.tenant, utilityBill, false);
  await expectStorageRead("storage utility-bills unauthenticated read denied", null, utilityBill, false);

  await expectStorageWrite("storage payment-receipts tenant writes own uid path", users.tenant, tenantPaymentReceipt, true);
  await expectStorageRead("storage payment-receipts tenant reads own uid path", users.tenant, tenantPaymentReceipt, true);
  await expectStorageRead("storage payment-receipts admin reads tenant receipt", users.adminAll, tenantPaymentReceipt, true);
  await expectStorageWrite("storage payment-receipts admin cannot write another uid path", users.adminAll, tenantPaymentReceipt, false);
  await expectStorageRead("storage payment-receipts tenant denied other uid path", users.tenant, staleTenantPaymentReceipt, false);
  await expectStorageWrite("storage payment-receipts stale tenant writes own uid path", users.staleTenant, staleTenantPaymentReceipt, true);
  await expectStorageRead("storage payment-receipts missing-profile admin claim reads tenant receipt", users.missingProfile, tenantPaymentReceipt, true, "WARNING: allowed from token projection despite missing Firestore profile.");

  await expectStorageWrite("storage contracts admin/all write allowed", users.adminAll, contract, true);
  await expectStorageRead("storage contracts admin/enzo read allowed", users.adminEnzo, contract, true);
  await expectStorageRead("storage contracts tenant read denied", users.tenant, contract, false);
  await expectStorageWrite("storage contracts tenant write denied", users.tenant, contract, false);
  await expectStorageRead("storage contracts stale admin claim read allowed", users.staleAdmin, contract, true, "WARNING: allowed from stale admin token projection while canonical profile is tenant.");

  await expectStorageWrite("storage message-attachments admin/all write allowed", users.adminAll, messageAttachment, true);
  await expectStorageRead("storage message-attachments admin/enzo read allowed", users.adminEnzo, messageAttachment, true);
  await expectStorageRead("storage message-attachments tenant read denied", users.tenant, messageAttachment, false);
  await expectStorageWrite("storage message-attachments tenant write denied", users.tenant, messageAttachment, false);
  await expectStorageWrite("storage message-attachments missing-profile admin claim write allowed", users.missingProfile, "message-attachments/message-t1/missing-profile-claim.txt", true, "WARNING: allowed from token projection despite missing Firestore profile.");

  await expectStorageWrite("storage rent-receipts admin/all writes tenant-t1 receipt", users.adminAll, tenantRentReceipt, true);
  await expectStorageWrite("storage rent-receipts admin/all writes tenant-t2 receipt", users.adminAll, otherTenantRentReceipt, true);
  await expectStorageRead("storage rent-receipts tenant reads own tenantId", users.tenant, tenantRentReceipt, true);
  await expectStorageRead("storage rent-receipts tenant denied other tenantId", users.tenant, otherTenantRentReceipt, false);
  await expectStorageWrite("storage rent-receipts tenant write denied", users.tenant, tenantRentReceipt, false);
  await expectStorageRead("storage rent-receipts admin/enzo reads tenant-t2 because Storage has no owner-scope lookup", users.adminEnzo, otherTenantRentReceipt, true, "WARNING: allowed by admin claim; Storage cannot inspect property ownerScope.");
  await expectStorageWrite("storage rent-receipts admin/enzo writes tenant-t2 because Storage has no owner-scope lookup", users.adminEnzo, otherTenantRentReceipt, true, "WARNING: allowed by admin claim; Storage cannot inspect property ownerScope.");
  await expectStorageRead("storage rent-receipts stale tenant token reads old tenantId", users.staleTenant, tenantRentReceipt, true, "WARNING: allowed from stale tenantId token projection while canonical profile is tenant-t2.");
  await expectStorageRead("storage rent-receipts stale tenant token denied current profile tenantId", users.staleTenant, otherTenantRentReceipt, false, "WARNING: denied because token projection is stale, not because Storage read canonical profile.");
  await expectStorageRead("storage rent-receipts stale admin claim reads all", users.staleAdmin, otherTenantRentReceipt, true, "WARNING: allowed from stale admin token projection while canonical profile is tenant.");
  await expectStorageRead("storage rent-receipts disabled user denied", users.disabled, tenantRentReceipt, false);

  record("storage limitation documented", true, "Storage rules use request.auth.token projection because Firestore profile reads are unavailable in Storage rules; stale/missing profile warnings above are expected current behavior.");
}

async function expectStorageRead(name, user, objectPath, shouldAllow, note = "") {
  const token = user ? await signIn(user) : null;
  const response = await fetch(storageObjectUrl(objectPath), {
    headers: withoutEmptyHeaders({ Authorization: token ? `Bearer ${token}` : "" })
  });
  record(name, shouldAllow ? response.ok : !response.ok, storageDetail(response, note));
}

async function expectStorageWrite(name, user, objectPath, shouldAllow, note = "") {
  const token = user ? await signIn(user) : null;
  const response = await fetch(storageUploadUrl(objectPath), {
    method: "POST",
    headers: withoutEmptyHeaders({
      Authorization: token ? `Bearer ${token}` : "",
      "Content-Type": "text/plain"
    }),
    body: `auth authority verifier fixture: ${objectPath}`
  });
  record(name, shouldAllow ? response.ok : !response.ok, storageDetail(response, note));
}

function storageObjectUrl(objectPath) {
  return `http://${storageHost}/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(objectPath)}?alt=media`;
}

function storageUploadUrl(objectPath) {
  return `http://${storageHost}/v0/b/${encodeURIComponent(storageBucket)}/o?${new URLSearchParams({ name: objectPath }).toString()}`;
}

function storageDetail(response, note) {
  return [String(response.status), note].filter(Boolean).join(" ");
}

async function expectCallable(name, user, functionName, data, shouldAllow, validateResult) {
  const token = user ? await signIn(user) : null;
  const response = await fetch(`http://${functionHost}/${projectId}/us-central1/${functionName}`, {
    method: "POST",
    headers: withoutEmptyHeaders({ "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" }),
    body: JSON.stringify({ data })
  });
  const payload = await response.json().catch(() => ({}));
  const resultOk = validateResult ? await validateResult(payload, response) : response.ok && !payload.error;
  record(name, shouldAllow ? resultOk : !response.ok || Boolean(payload.error), JSON.stringify(payload.error || payload.result || {}));
}

async function expectFirestoreGet(name, user, documentPath, shouldAllow) {
  const token = user ? await signIn(user) : null;
  const encodedPath = documentPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/${encodedPath}`, {
    headers: withoutEmptyHeaders({ Authorization: token ? `Bearer ${token}` : "" })
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

function resultArray(payload, key) {
  return Array.isArray(payload.result?.[key]) ? payload.result[key] : [];
}

function withoutEmptyHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value));
}

function authReachedBusinessValidation(payload, response) {
  if (response.ok && !payload.error) {
    return true;
  }

  const status = String(payload.error?.status ?? payload.error?.code ?? "").toLowerCase();
  return Boolean(payload.error) && status !== "permission-denied" && status !== "unauthenticated";
}
