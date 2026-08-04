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
| Tasks complete | 15 |
| Tasks incomplete | 3 |

Incomplete tasks:

- 4.2 Callable Function matrix across representative endpoints.
- 4.3 Firestore rules matrix across representative collections.
- 4.4 Storage rules matrix across representative paths.

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
scripts/verify-auth-authority-emulator.mjs
Ran directly against running Firebase emulators with required env vars set.
Result: 11/11 checks passed.
```

**Environment note**: JDK 21 was installed locally to unblock Firebase emulator execution. This is local environment setup, not app code.

**Tests**: ⚠️ 11 behavioral checks completed. The auth-authority emulator script passed, but broader callable, Firestore rules, Storage rules, and browser/manual matrix coverage remains incomplete.

**Coverage**: ➖ Not available; no coverage command or threshold found.

---

## Spec Compliance Matrix

| Requirement | Scenario | Runtime Test | Result |
|-------------|----------|--------------|--------|
| Canonical Authority Source | Function resolves authority consistently | `scripts/verify-auth-authority-emulator.mjs` passed direct emulator run with stale admin, disabled, missing profile, and stale tenant checks | ✅ PASS FOR SCRIPT COVERAGE |
| Canonical Authority Source | Rules match Function authority | Script passed direct emulator run with partial Firestore checks; broader Firestore matrix and real Storage path checks remain pending | ⚠️ PARTIAL COVERAGE |
| Role, Tenant, and Owner Scope Boundaries | Tenant accesses own tenant data | Script passed direct emulator run with seeded tenant and limited Firestore own-profile check; tenant collection/path matrix incomplete | ⚠️ PARTIAL COVERAGE |
| Role, Tenant, and Owner Scope Boundaries | Owner lacks matching owner scope | No direct runtime test found for admin/enzo vs admin/ivo denial across representative data | ❌ UNTESTED |
| Stale Token Handling | Token omits updated authority | Script passed direct emulator run for stale-token cases it covers; browser session/manual refresh behavior still not checked | ⚠️ PARTIAL COVERAGE |
| Stale Token Handling | Rules encounter stale authority | Firestore static/script evidence is partial; Storage still authorizes from projected claims and has no freshness guard | ⚠️ PARTIAL / STATIC GAP |
| Denied Access Behavior | Unauthorized operation is denied | Script passed direct emulator run for covered denied callable/Firestore cases; frontend access-denied UI exists but browser/manual check is pending | ⚠️ PARTIAL COVERAGE |
| Slice 2 Onboarding Compatibility | Claimed tenant receives authority | `linkTenantUser()` writes profile then projected claims; covered only where auth-authority script overlaps, not a dedicated onboarding scenario suite | ⚠️ PARTIAL COVERAGE |
| Slice 2 Onboarding Compatibility | Ambiguous legacy invitation remains denied | Static code checks duplicate active tenants/invitations; no dedicated runtime evidence | ❌ UNTESTED |

**Compliance summary**: The direct auth-authority emulator script passed 11/11 checks. Runtime compliance is established only for that implemented script coverage. Broader callable/Firestore/Storage matrix coverage and browser/manual session checks remain pending.

---

## Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Canonical Authority Source | ⚠️ Partial | Functions now resolve `users/{uid}` in `resolveAuthContext()` and reject missing/inactive profiles. Firestore rules read `users/{uid}`. Frontend loads profile before rendering. Storage remains claim-only and can still accept stale broad claims. |
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

1. Tasks 4.2, 4.3, and 4.4 remain incomplete; broader callable/rules/storage matrix verification is not finished.
2. Storage rules still rely on custom claims without freshness/version enforcement; stale broad admin/superadmin claims can grant Storage access broader than current Firestore/Functions profile authority.

### WARNING

1. Missing/invalid admin `ownerScope` normalizes to `all`, which matches rollout compatibility in design but conflicts with spec wording: empty/missing owner scope MUST NOT imply global owner access.
2. Frontend `sessionClaimsNeedRefresh()` does not refresh when admin/superadmin token lacks `ownerScope`; it only refreshes if `claims.ownerScope` exists and mismatches.
3. Emulator script coverage is partial: Storage matrix is a documentation-only check, and representative Firestore/callable endpoint coverage is narrower than tasks 4.2-4.4 require.
4. Spec uses `role: owner` in one scenario, while implementation/design roles are `superadmin | admin | tenant`; this should be clarified before archive.

### SUGGESTION

1. Add explicit runtime checks for admin/enzo denied on ivo-scoped property, admin/ivo denied on enzo-scoped property, tenant T1 denied on T2, disabled profile denied across Firestore/Functions, and Storage path deny/allow cases.
2. Consider adding an `authVersion` freshness marker only after deciding how Storage can validate it meaningfully, or explicitly relax the Storage stale-claim requirement in the spec.

---

## Remaining Runtime / Manual Checks

- Manually smoke current browser sessions after role/scope/status changes: forced token refresh, access-denied rendering, admin route hiding, tenant route hiding.
- Confirm Storage behavior manually in emulator for `utility-bills`, `payment-receipts`, `contracts`, `message-attachments`, and `rent-receipts` paths.
- Expand callable/Firestore emulator matrix beyond the 11 checks already passing in `scripts/verify-auth-authority-emulator.mjs`.

---

## Verdict

**PARTIAL PASS / GAPS REMAIN**

Static implementation largely follows the intended profile-canonical model for Functions, Firestore, and frontend, and the direct auth-authority emulator script passed 11/11 checks after JDK 21 unblocked emulator execution. Verification cannot fully pass yet because broader matrix tasks remain incomplete, browser/manual checks are pending, and Storage stale-claim behavior does not satisfy the strict spec requirement.
