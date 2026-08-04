# Verification Report

**Change**: consolidate-auth-authority
**Version**: N/A
**Mode**: Standard
**Artifact store**: in-repo OpenSpec

---

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 18 |
| Tasks complete | 18 |
| Tasks incomplete | 0 |

Incomplete tasks: none.

---

## Build & Tests Execution

**Root validation**: ✅ Passed

```text
npm run validate
All configured validation checks passed.
```

**Local validation**: ✅ Passed

```text
npm run validate:local-dev
Local development validation passed (5 reproducible setup checks).
```

**Type check / lint**: ✅ Passed

```text
npm run lint:functions
tsc -p tsconfig.json --noEmit
```

**Build**: ✅ Passed before emulator startup

```text
npm run verify:auth-authority
> npm run build:functions
> tsc -p tsconfig.json
```

**Behavioral emulator verification**: ✅ Passed for implemented script coverage

```text
npm run verify:auth-authority
Result: 78/78 checks passed.
```

**Environment note**: JDK 21 is installed locally, but the default `java` on `PATH` is Java 17. The passing run set `JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot` and prepended `%JAVA_HOME%\bin` for the command. This is local environment setup, not app code.

**Tests**: ⚠️ 78 behavioral checks completed. Callable and Firestore representative matrices passed. Storage read/write matrix passed for the current custom-claim projection model only; browser/manual matrix coverage remains incomplete.

**Coverage**: ➖ Not available; no coverage command or threshold found.

---

## Spec Compliance Matrix

| Requirement | Scenario | Runtime Test | Result |
|-------------|----------|--------------|--------|
| Canonical Authority Source | Function resolves authority consistently | `npm run verify:auth-authority` passed callable checks for admin dataset, tenant claim, tenant payment boundary, superadmin settings, audit write, stale admin, stale tenant, disabled, missing profile, and unauthenticated cases | ✅ PASS FOR CALLABLE MATRIX |
| Canonical Authority Source | Rules match Function authority | Script passed Firestore emulator REST checks across `users`, `properties`, `tenants`, `charges`, `payments`, `paymentReceipts`, `rentReceipts`, `messages`, and `tenantInvitations`; Storage emulator REST checks passed on `utility-bills`, `payment-receipts`, `contracts`, `message-attachments`, and `rent-receipts` for claim-projection behavior only | ⚠️ PASS FOR FIRESTORE / STORAGE PROJECTION ONLY |
| Role, Tenant, and Owner Scope Boundaries | Tenant accesses own tenant data | Script passed tenant own/other Firestore checks across representative tenant-scoped collections and tenant callable boundary checks | ✅ PASS FOR FIRESTORE/CALLABLE COVERAGE |
| Role, Tenant, and Owner Scope Boundaries | Owner lacks matching owner scope | Script passed admin/enzo vs admin/ivo Firestore denials and scoped `getScopedAdminDataset` filtering | ✅ PASS FOR COVERED OWNER-SCOPE MATRIX |
| Stale Token Handling | Token omits updated authority | Script passed direct emulator run for stale-token cases it covers; browser session/manual refresh behavior still not checked | ⚠️ PARTIAL COVERAGE |
| Stale Token Handling | Rules encounter stale authority | Firestore stale-claim checks passed; Storage runtime checks honestly prove stale/missing-profile claims can still authorize from projected token fields because Storage cannot read `users/{uid}` | ⚠️ FIRESTORE PASS / STORAGE STALE-CLAIM WARNING |
| Denied Access Behavior | Unauthorized operation is denied | Script passed denied callable/Firestore cases for disabled, missing profile, stale claims, owner-scope mismatch, tenant mismatch, and unauthenticated reads/calls; frontend access-denied UI browser/manual check is pending | ⚠️ SERVER/RULES PASS / UI PENDING |
| Slice 2 Onboarding Compatibility | Claimed tenant receives authority | `claimTenantAccess` runtime check passed and verified a canonical tenant `users/{uid}` profile was created | ✅ PASS FOR CLAIM FLOW |
| Slice 2 Onboarding Compatibility | Ambiguous legacy invitation remains denied | Static code checks duplicate active tenants/invitations; no dedicated runtime evidence | ❌ UNTESTED |

**Compliance summary**: `npm run verify:auth-authority` passed 78/78 checks. Runtime compliance is established for representative callable and Firestore matrices. Storage task 4.4 is complete only under this wording: current `storage.rules` read/write behavior is verified for the custom-claim projection model. It does **not** prove canonical profile freshness because Firebase Storage rules cannot read `users/{uid}` profiles. Browser/manual session checks remain pending outside this verifier.

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Canonical Authority Source | ⚠️ Partial | Functions now resolve `users/{uid}` in `resolveAuthContext()` and reject missing/inactive profiles. Firestore rules read `users/{uid}` and representative runtime coverage passed. Frontend loads profile before rendering. Storage remains claim-only and can still accept stale broad claims. |
| Role, Tenant, and Owner Scope Boundaries | ⚠️ Partial | `AuthContext`, `normalizeOwnerScope()`, Firestore helpers, and UI ownerScope controls exist. But missing/invalid admin `ownerScope` normalizes to `all`, conflicting with spec text that empty/missing owner scope MUST NOT imply global owner access. |
| Stale Token Handling | ⚠️ Partial | Functions reject role, tenantId, ownerScope, and authVersion mismatches when claims are present. Frontend forces refresh on role/tenant mismatch and some ownerScope mismatch. Missing admin/superadmin `ownerScope` is not refreshed, and Storage has no freshness enforcement. |
| Denied Access Behavior | ⚠️ Partial | Functions/rules deny several unauthorized cases statically and the direct emulator script passed covered denied cases; frontend `renderAccessDenied()` still lacks browser/manual evidence. |
| Slice 2 Onboarding Compatibility | ⚠️ Partial | Tenant claim/invitation paths preserve admin-governed canonical invitation flow and write `users/{uid}` plus projected claims via `claimsFromProfile()`. Existing auth/privileged scripts only partially overlap; dedicated onboarding scenarios remain pending. |

---

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| `users/{uid}` is canonical authorization source | ✅ Mostly | Functions, Firestore, and frontend follow profile authority. |
| Custom claims are derived projection, not fallback authority | ✅ Mostly | `claimsFromProfile()` centralizes projection; general `resolveClaims()` delegates to profile-backed `resolveAuthContext()`. |
| Storage uses claims with freshness guardrails | ⚠️ Deviated | Storage documents the limitation and validates claim shape, but does not enforce freshness/version or prevent stale admin/superadmin claims from broad Storage access. |
| Frontend renders only after profile/session parity is known | ⚠️ Partial | Profile is loaded before render and refresh happens on several mismatches, but missing ownerScope for admin/superadmin is not treated as incomplete/stale. |
| Preserve current data compatibility during rollout | ✅ Yes | Missing admin ownerScope defaults to `all`, and bootstrap/claim exceptions are preserved. This conflicts with strict spec wording on missing ownerScope. |

---

## Scope Purity

**Slice-relevant changed files found**:

- `functions/src/types.ts`, `functions/src/lib/auth.ts`, `functions/src/modules/tenants.ts`
- `firestore.rules`, `storage.rules`
- `public/app.js`, `public/index.html`
- `docs/modelo-datos.md`, `docs/local-tenant-emulator-flow.md`
- `scripts/verify-auth-authority-emulator.mjs`, `package.json`
- `openspec/changes/consolidate-auth-authority/**`

**Residual / prior-slice working-tree changes present**:

- `.firebaserc.example`, `.gitignore`, `README.md`, `docs/setup-firebase.md`, `firebase.json`, `functions/.env.example`, `functions/src/config.ts`, `public/firebase-config.js`, `public/runtime-config.js`, `public/verificar-comprobante.html`, `public/verify-receipt.js`, `package-lock.json`, `scripts/validate-local-dev.mjs`.

Scope purity verdict: ⚠️ Mixed working tree. The auth-authority slice itself is identifiable, but the repository contains many local-dev/runtime-config changes from prior slices. Verification focused only on auth-authority-relevant files; archive/PR slicing must avoid bundling unrelated prior-slice changes accidentally.

---

## Issues Found

### CRITICAL

None found in this verifier pass.

### WARNING

1. Missing/invalid admin `ownerScope` normalizes to `all`, which matches rollout compatibility in design but conflicts with spec wording: empty/missing owner scope MUST NOT imply global owner access.
2. Frontend `sessionClaimsNeedRefresh()` does not refresh when admin/superadmin token lacks `ownerScope`; it only refreshes if `claims.ownerScope` exists and mismatches.
3. Storage matrix is now runtime-covered, but only for token projection. Storage rules cannot query Firestore profiles, so they cannot prove freshness against canonical `users/{uid}` authority.
4. Storage rules still rely on custom claims without freshness/version enforcement; stale broad admin/superadmin claims can grant Storage access broader than current Firestore/Functions profile authority.
5. Runtime Storage evidence confirmed broader projection behavior: missing-profile admin claims can read/write admin paths, stale admin claims can read admin paths, admin/enzo can read/write `rent-receipts/tenant-t2` because Storage cannot inspect property owner scope, and stale tenant `tenantId` claims can read the old tenant rent receipt while denying the current profile tenant receipt.
6. Spec uses `role: owner` in one scenario, while implementation/design roles are `superadmin | admin | tenant`; this should be clarified before archive.

### SUGGESTION

1. Consider adding an `authVersion` freshness marker only after deciding how Storage can validate it meaningfully, or explicitly relax the Storage stale-claim requirement in the spec.

---

## Remaining Runtime / Manual Checks

- Manually smoke current browser sessions after role/scope/status changes: forced token refresh, access-denied rendering, admin route hiding, tenant route hiding.
- Confirm product/security acceptance of Storage's claim-projection limitation or redesign sensitive file access behind Functions/signed URLs. Current rules can only evaluate `request.auth.token`, not canonical `users/{uid}` freshness.

---

## Verdict

**PASS FOR COVERED RUNTIME MATRIX / STORAGE LIMITATION REMAINS**

Static implementation largely follows the intended profile-canonical model for Functions, Firestore, and frontend, and `npm run verify:auth-authority` passed 78/78 checks after using local JDK 21 for the command. Task 4.4 can be marked complete only as runtime verification of current Storage claim-projection behavior. Storage stale-claim behavior remains broader than canonical profile authority and cannot be made equivalent to Firestore/Functions without a different file-access design or meaningful freshness mechanism.
