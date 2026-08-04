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
  admin: { uid: "tenant-onboarding-admin", email: "tenant-onboarding-admin@example.test", password: "Local123!" },
  existingTenant: { uid: "tenant-onboarding-existing", email: "Tenant.Onboarding.Existing@Example.Test", normalizedEmail: "tenant.onboarding.existing@example.test", password: "Local123!" },
  invitedTenant: { uid: "tenant-onboarding-invited", email: "Tenant.Onboarding.Invited@Example.Test", normalizedEmail: "tenant.onboarding.invited@example.test", password: "Local123!" },
  outsider: { uid: "tenant-onboarding-outsider", email: "tenant.onboarding-outsider@example.test", password: "Local123!" },
  legacyTenant: { uid: "tenant-onboarding-legacy", email: "tenant.onboarding-legacy@example.test", password: "Local123!" },
  legacyAmbiguous: { uid: "tenant-onboarding-legacy-ambiguous", email: "tenant.onboarding-legacy-ambiguous@example.test", password: "Local123!" },
  duplicateTenant: { uid: "tenant-onboarding-duplicate", email: "tenant.onboarding-duplicate@example.test", password: "Local123!" },
  conflictingInvitation: { uid: "tenant-onboarding-conflict", email: "tenant.onboarding-conflict@example.test", password: "Local123!" }
};

await seedBase();
await verifyAdminInvitationAndExistingUserLink();
await verifyInvitedTenantClaimAndRules();
await verifyNonInvitedUserCannotSelfCreate();
await verifyLegacyInvitationCompatibility();
await verifyConflictFailuresDoNotPartiallyMutate();

console.table(checks);
const failed = checks.filter((check) => !check.ok);
if (failed.length) {
  throw new Error(`Tenant onboarding verification failed: ${failed.map((check) => check.name).join(", ")}`);
}

console.log("Tenant onboarding emulator verification passed.");

function assertLocalEmulatorsOnly() {
  const required = [
    ["FIRESTORE_EMULATOR_HOST", firestoreHost],
    ["FIREBASE_AUTH_EMULATOR_HOST", authHost],
    ["FUNCTIONS_EMULATOR_HOST", functionHost]
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Run through Firebase emulators only. Missing: ${missing.join(", ")}`);
  }
}

async function seedBase() {
  await Promise.all(Object.values(users).map(async (user) => {
    await auth.deleteUser(user.uid).catch(() => null);
    await auth.createUser({ uid: user.uid, email: user.email, password: user.password, emailVerified: true });
    await auth.setCustomUserClaims(user.uid, null);
  }));

  await deleteKnownDocs();

  await db.doc("properties/tenant-onboarding-property-admin-link").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-admin-pending").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-other").set(property("ivo"));
  await db.doc("properties/tenant-onboarding-property-legacy").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-legacy-ambiguous").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-duplicate-a").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-duplicate-b").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-conflict-a").set(property("enzo"));
  await db.doc("properties/tenant-onboarding-property-conflict-b").set(property("enzo"));

  await setAuthority(users.admin.uid, {
    role: "admin",
    ownerScope: "all",
    email: users.admin.email,
    displayName: "Tenant Onboarding Admin"
  });
}

async function deleteKnownDocs() {
  const propertyIds = [
    "tenant-onboarding-property-admin-link",
    "tenant-onboarding-property-admin-pending",
    "tenant-onboarding-property-other",
    "tenant-onboarding-property-legacy",
    "tenant-onboarding-property-legacy-ambiguous",
    "tenant-onboarding-property-duplicate-a",
    "tenant-onboarding-property-duplicate-b",
    "tenant-onboarding-property-conflict-a",
    "tenant-onboarding-property-conflict-b"
  ];
  const tenantSnapshot = await db.collection("tenants").where("propertyId", "in", propertyIds).get();
  await Promise.all(tenantSnapshot.docs.map((docSnap) => docSnap.ref.delete().catch(() => null)));

  const paths = [
    "properties/tenant-onboarding-property-admin-link",
    "properties/tenant-onboarding-property-admin-pending",
    "properties/tenant-onboarding-property-other",
    "properties/tenant-onboarding-property-legacy",
    "properties/tenant-onboarding-property-legacy-ambiguous",
    "properties/tenant-onboarding-property-duplicate-a",
    "properties/tenant-onboarding-property-duplicate-b",
    "properties/tenant-onboarding-property-conflict-a",
    "properties/tenant-onboarding-property-conflict-b",
    "tenants/tenant-onboarding-admin-link",
    "tenants/tenant-onboarding-other",
    "tenants/tenant-onboarding-legacy",
    "tenants/tenant-onboarding-legacy-ambiguous",
    "tenants/tenant-onboarding-duplicate-a",
    "tenants/tenant-onboarding-duplicate-b",
    "tenants/tenant-onboarding-conflict-a",
    "tenants/tenant-onboarding-conflict-b",
    "tenantInvitations/tenant.onboarding.existing@example.test",
    "tenantInvitations/tenant.onboarding.invited@example.test",
    "tenantInvitations/tenant.onboarding-outsider@example.test",
    "tenantInvitations/tenant.onboarding-legacy@example.test",
    "tenantInvitations/tenant-onboarding-legacy-token",
    "tenantInvitations/tenant-onboarding-legacy-token-a",
    "tenantInvitations/tenant-onboarding-legacy-token-b",
    "tenantInvitations/tenant.onboarding-legacy-ambiguous@example.test",
    "tenantInvitations/tenant.onboarding-duplicate@example.test",
    "tenantInvitations/tenant.onboarding-conflict@example.test"
  ];
  await Promise.all(paths.map((path) => db.doc(path).delete().catch(() => null)));
  await Promise.all(Object.values(users).map((user) => db.doc(`users/${user.uid}`).delete().catch(() => null)));
  await db.doc("users/tenant-onboarding-other-user").delete().catch(() => null);
}

async function verifyAdminInvitationAndExistingUserLink() {
  await db.doc("tenants/tenant-onboarding-admin-link").set({
    fullName: "Existing Tenant",
    email: users.existingTenant.normalizedEmail,
    propertyId: "tenant-onboarding-property-admin-link",
    status: "active",
    invitationStatus: "not_sent",
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const response = await expectCallable("admin invitation links existing auth user", users.admin, "inviteTenantUser", {
    tenantId: "tenant-onboarding-admin-link",
    email: users.existingTenant.email,
    displayName: "Existing Tenant"
  }, true);
  record("admin invite returns canonical email id", response.result?.invitationId === users.existingTenant.normalizedEmail, JSON.stringify(response.result ?? {}));

  const invitationDoc = await db.doc(`tenantInvitations/${users.existingTenant.normalizedEmail}`).get();
  const tenantDoc = await db.doc("tenants/tenant-onboarding-admin-link").get();
  const userDoc = await db.doc(`users/${users.existingTenant.uid}`).get();
  const claims = (await auth.getUser(users.existingTenant.uid)).customClaims ?? {};
  record("admin invite writes canonical invitation claimed", invitationDoc.exists
    && invitationDoc.get("tenantId") === "tenant-onboarding-admin-link"
    && invitationDoc.get("email") === users.existingTenant.normalizedEmail
    && invitationDoc.get("status") === "claimed"
    && invitationDoc.get("userId") === users.existingTenant.uid);
  record("admin invite updates tenant status", tenantDoc.get("invitationStatus") === "claimed");
  record("admin invite links profile and claims", userDoc.get("role") === "tenant"
    && userDoc.get("tenantId") === "tenant-onboarding-admin-link"
    && claims.role === "tenant"
    && claims.tenantId === "tenant-onboarding-admin-link");
}

async function verifyInvitedTenantClaimAndRules() {
  const createResponse = await expectCallable("admin creates pending invitation-backed tenant", users.admin, "createTenantAdminProfile", {
    fullName: "Invited Tenant",
    dni: "11111111",
    phone: "1122334455",
    email: users.invitedTenant.email,
    propertyId: "tenant-onboarding-property-admin-pending",
    baseRent: 1000,
    dueDayOfMonth: 10,
    rentUpdateFrequency: "quarterly",
    nextAdjustmentPeriod: "2026-09"
  }, true);
  const tenantId = String(createResponse.result?.tenantId ?? "");
  record("admin create produced tenant id", Boolean(tenantId), JSON.stringify(createResponse.result ?? {}));

  const pendingInvitation = await db.doc(`tenantInvitations/${users.invitedTenant.normalizedEmail}`).get();
  const pendingTenant = await db.doc(`tenants/${tenantId}`).get();
  record("admin create writes canonical pending invitation", pendingInvitation.exists
    && pendingInvitation.get("tenantId") === tenantId
    && pendingInvitation.get("email") === users.invitedTenant.normalizedEmail
    && pendingInvitation.get("status") === "pending"
    && pendingTenant.get("invitationStatus") === "pending");

  await db.doc("tenants/tenant-onboarding-other").set({
    fullName: "Other Tenant",
    email: "tenant.onboarding-other@example.test",
    propertyId: "tenant-onboarding-property-other",
    status: "active",
    invitationStatus: "claimed"
  });
  await db.doc("users/tenant-onboarding-other-user").set({
    role: "tenant",
    tenantId: "tenant-onboarding-other",
    email: "tenant.onboarding-other@example.test",
    status: "active"
  });

  await expectCallable("invited tenant first login claims access", users.invitedTenant, "claimTenantAccess", {}, true);
  const claimedInvitation = await db.doc(`tenantInvitations/${users.invitedTenant.normalizedEmail}`).get();
  const claimedTenant = await db.doc(`tenants/${tenantId}`).get();
  const userDoc = await db.doc(`users/${users.invitedTenant.uid}`).get();
  const claims = (await auth.getUser(users.invitedTenant.uid)).customClaims ?? {};
  record("tenant claim aligns claims profile invitation tenant", claims.role === "tenant"
    && claims.tenantId === tenantId
    && userDoc.get("role") === "tenant"
    && userDoc.get("tenantId") === tenantId
    && claimedInvitation.get("status") === "claimed"
    && claimedInvitation.get("claimedBy") === users.invitedTenant.uid
    && claimedTenant.get("invitationStatus") === "claimed");

  await expectFirestoreGet("rules allow tenant own profile", users.invitedTenant, `users/${users.invitedTenant.uid}`, true);
  await expectFirestoreGet("rules allow tenant own tenant", users.invitedTenant, `tenants/${tenantId}`, true);
  await expectFirestoreGet("rules deny other tenant profile", users.invitedTenant, "users/tenant-onboarding-other-user", false);
  await expectFirestoreGet("rules deny other tenant doc", users.invitedTenant, "tenants/tenant-onboarding-other", false);
}

async function verifyNonInvitedUserCannotSelfCreate() {
  const beforeClaims = (await auth.getUser(users.outsider.uid)).customClaims ?? {};
  await expectCallable("non-invited user cannot self-create tenant profile", users.outsider, "createTenantProfile", {
    propertyType: "Casa",
    propertyCode: "1"
  }, false, "PERMISSION_DENIED");

  const userDoc = await db.doc(`users/${users.outsider.uid}`).get();
  const invitationDoc = await db.doc(`tenantInvitations/${users.outsider.email}`).get();
  const tenantSnapshot = await db.collection("tenants").where("email", "==", users.outsider.email).limit(1).get();
  const afterClaims = (await auth.getUser(users.outsider.uid)).customClaims ?? {};
  record("non-invited failure leaves no tenant onboarding writes", !userDoc.exists
    && !invitationDoc.exists
    && tenantSnapshot.empty
    && !beforeClaims.role
    && !afterClaims.role);
}

async function verifyLegacyInvitationCompatibility() {
  await db.doc("tenants/tenant-onboarding-legacy").set({
    fullName: "Legacy Tenant",
    email: users.legacyTenant.email,
    propertyId: "tenant-onboarding-property-legacy",
    status: "active",
    invitationStatus: "pending"
  });
  await db.doc("tenantInvitations/tenant-onboarding-legacy-token").set({
    tenantId: "tenant-onboarding-legacy",
    email: users.legacyTenant.email,
    displayName: "Legacy Tenant",
    status: "pending"
  });

  await expectCallable("legacy token invitation claims when unambiguous", users.legacyTenant, "claimTenantAccess", {}, true);
  const canonicalDoc = await db.doc(`tenantInvitations/${users.legacyTenant.email}`).get();
  const legacyDoc = await db.doc("tenantInvitations/tenant-onboarding-legacy-token").get();
  const tenantDoc = await db.doc("tenants/tenant-onboarding-legacy").get();
  record("legacy token claim repairs canonical doc", canonicalDoc.exists
    && canonicalDoc.get("status") === "claimed"
    && canonicalDoc.get("tenantId") === "tenant-onboarding-legacy"
    && canonicalDoc.get("migratedFromLegacyId") === "tenant-onboarding-legacy-token"
    && legacyDoc.get("status") === "claimed"
    && legacyDoc.get("migratedToInvitationId") === users.legacyTenant.email
    && tenantDoc.get("invitationStatus") === "claimed");

  await db.doc("tenants/tenant-onboarding-legacy-ambiguous").set({
    fullName: "Legacy Ambiguous Tenant",
    email: users.legacyAmbiguous.email,
    propertyId: "tenant-onboarding-property-legacy-ambiguous",
    status: "active",
    invitationStatus: "pending"
  });
  await db.doc("tenantInvitations/tenant-onboarding-legacy-token-a").set({
    tenantId: "tenant-onboarding-legacy-ambiguous",
    email: users.legacyAmbiguous.email,
    status: "pending"
  });
  await db.doc("tenantInvitations/tenant-onboarding-legacy-token-b").set({
    tenantId: "tenant-onboarding-legacy-ambiguous",
    email: users.legacyAmbiguous.email,
    status: "pending"
  });

  await expectCallable("ambiguous legacy token invitations fail", users.legacyAmbiguous, "claimTenantAccess", {}, false, "FAILED_PRECONDITION");
  const ambiguousCanonical = await db.doc(`tenantInvitations/${users.legacyAmbiguous.email}`).get();
  const ambiguousUserDoc = await db.doc(`users/${users.legacyAmbiguous.uid}`).get();
  const ambiguousClaims = (await auth.getUser(users.legacyAmbiguous.uid)).customClaims ?? {};
  record("ambiguous legacy failure leaves no canonical repair", !ambiguousCanonical.exists && !ambiguousUserDoc.exists && !ambiguousClaims.role);
}

async function verifyConflictFailuresDoNotPartiallyMutate() {
  await db.doc("tenants/tenant-onboarding-duplicate-a").set({
    fullName: "Duplicate Tenant A",
    email: users.duplicateTenant.email,
    propertyId: "tenant-onboarding-property-duplicate-a",
    status: "active",
    invitationStatus: "pending"
  });
  await db.doc("tenants/tenant-onboarding-duplicate-b").set({
    fullName: "Duplicate Tenant B",
    email: users.duplicateTenant.email,
    propertyId: "tenant-onboarding-property-duplicate-b",
    status: "active",
    invitationStatus: "pending"
  });

  await expectCallable("duplicate active tenants fail before mutation", users.duplicateTenant, "claimTenantAccess", {}, false, "FAILED_PRECONDITION");
  const duplicateUserDoc = await db.doc(`users/${users.duplicateTenant.uid}`).get();
  const duplicateClaims = (await auth.getUser(users.duplicateTenant.uid)).customClaims ?? {};
  const duplicateInvitation = await db.doc(`tenantInvitations/${users.duplicateTenant.email}`).get();
  const duplicateTenantA = await db.doc("tenants/tenant-onboarding-duplicate-a").get();
  const duplicateTenantB = await db.doc("tenants/tenant-onboarding-duplicate-b").get();
  record("duplicate active tenant failure has no partial mutation", !duplicateUserDoc.exists
    && !duplicateClaims.role
    && !duplicateInvitation.exists
    && duplicateTenantA.get("invitationStatus") === "pending"
    && duplicateTenantB.get("invitationStatus") === "pending");

  await db.doc("tenants/tenant-onboarding-conflict-a").set({
    fullName: "Conflict Tenant A",
    email: users.conflictingInvitation.email,
    propertyId: "tenant-onboarding-property-conflict-a",
    status: "active",
    invitationStatus: "pending"
  });
  await db.doc("tenants/tenant-onboarding-conflict-b").set({
    fullName: "Conflict Tenant B",
    email: "tenant.onboarding-conflict-other@example.test",
    propertyId: "tenant-onboarding-property-conflict-b",
    status: "active",
    invitationStatus: "pending"
  });
  await db.doc(`tenantInvitations/${users.conflictingInvitation.email}`).set({
    tenantId: "tenant-onboarding-conflict-b",
    email: users.conflictingInvitation.email,
    status: "pending"
  });

  await expectCallable("conflicting canonical invitation fails before mutation", users.conflictingInvitation, "claimTenantAccess", {}, false, "FAILED_PRECONDITION");
  const conflictUserDoc = await db.doc(`users/${users.conflictingInvitation.uid}`).get();
  const conflictClaims = (await auth.getUser(users.conflictingInvitation.uid)).customClaims ?? {};
  const conflictInvitation = await db.doc(`tenantInvitations/${users.conflictingInvitation.email}`).get();
  const conflictTenantA = await db.doc("tenants/tenant-onboarding-conflict-a").get();
  record("conflicting invitation failure has no partial mutation", !conflictUserDoc.exists
    && !conflictClaims.role
    && conflictInvitation.get("status") === "pending"
    && conflictInvitation.get("tenantId") === "tenant-onboarding-conflict-b"
    && conflictTenantA.get("invitationStatus") === "pending");
}

async function setAuthority(uid, profile) {
  const storedProfile = { ...profile, status: profile.status || "active", updatedAt: nowIso() };
  await db.doc(`users/${uid}`).set(storedProfile);
  await auth.setCustomUserClaims(uid, storedProfile.status === "disabled" ? null : pickClaims(storedProfile));
}

function pickClaims(profile) {
  return Object.fromEntries(Object.entries({
    role: profile.role,
    tenantId: profile.tenantId,
    ownerScope: profile.ownerScope,
    status: profile.status
  }).filter(([, value]) => value !== undefined));
}

async function expectCallable(name, user, functionName, data, shouldAllow, expectedErrorStatus = "") {
  const token = await signIn(user);
  const response = await fetch(`http://${functionHost}/${projectId}/us-central1/${functionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data })
  });
  const payload = await response.json().catch(() => ({}));
  const status = payload.error?.status ?? "";
  const ok = shouldAllow
    ? response.ok && !payload.error
    : (!response.ok || Boolean(payload.error)) && (!expectedErrorStatus || status === expectedErrorStatus);
  record(name, ok, JSON.stringify(payload.error || payload.result || {}));
  return payload;
}

async function expectFirestoreGet(name, user, documentPath, shouldAllow) {
  const token = await signIn(user);
  const response = await fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`, {
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

function property(ownerScope) {
  return {
    ownerScope,
    status: "active",
    unitType: "Casa",
    unitCode: String(Math.floor(Math.random() * 100000)),
    updatedAt: nowIso()
  };
}

function nowIso() {
  return new Date().toISOString();
}

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
}
