# Verification Report

**Change**: `normalize-tenant-onboarding-contract`  
**Version**: N/A  
**Mode**: Standard  
**Artifact store**: OpenSpec / in-repo

---

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 26 |
| Tasks complete | 20 |
| Tasks incomplete | 6 |

Incomplete tasks:

- [ ] 5.3 Emulator: admin invitation creates/updates canonical invitation, claims, user link, tenant invitation status.
- [ ] 5.4 Emulator: invited tenant first login claims access, refreshes claims/profile, lands in tenant portal, can read only own data.
- [ ] 5.5 Emulator: non-invited user cannot self-create tenant profile and sees pending/access-denied UI without writes.
- [ ] 5.6 Emulator: legacy token invitation can be claimed only when unambiguous and repaired to canonical document.
- [ ] 5.7 Emulator: duplicate active tenants/conflicting invitations fail with `failed-precondition` and no partial mutation.
- [ ] 5.8 Record verification evidence in this report. This report records automated/static evidence; emulator evidence remains pending.

---

### Build & Tests Execution

**Build**: ✅ Passed

```text
npm run build:functions
> tsc -p tsconfig.json
exit 0
```

**Tests / checks**: ⚠️ No automated behavioral test suite found

```text
npm run lint:functions
> tsc -p tsconfig.json --noEmit
exit 0

npm run validate:local-dev
Local development validation passed (5 reproducible setup checks).
exit 0

npm run validate
All configured validation checks passed.
```

Additional emulator evidence from adjacent slices is not counted as dedicated onboarding compliance: `scripts/verify-auth-authority-emulator.mjs` passed 11/11 checks and `scripts/verify-privileged-ops-emulator.mjs` passed 15/15 checks when run directly against running emulators with env vars set, but tasks 5.3-5.7 still require normalize-tenant-onboarding-specific scenarios.

**Coverage**: ➖ Not available. No test files found and no coverage command configured.

---

### Spec Compliance Matrix

Runtime compliance requires a passing test/manual emulator result per scenario. Adjacent auth/privileged emulator scripts passed their covered checks, but no dedicated normalize-tenant-onboarding scenario run has proven tasks 5.3-5.7.

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| Admin-Governed Tenant Invitation | Admin prepares tenant invitation | Static evidence in `createTenantAdminProfile`, `updateTenantAdminProfile`, `upsertTenantInvitation`; no emulator result | ❌ UNTESTED |
| Admin-Governed Tenant Invitation | Tenant cannot self-claim property | Static evidence: `createTenantProfile` delegates to `claimTenantAccess`; onboarding form no longer submits property identifiers; no emulator result | ❌ UNTESTED |
| Tenant Claim Flow | Invited tenant claims access | Static evidence in `claimTenantAccessForRequest`; no emulator result | ❌ UNTESTED |
| Tenant Claim Flow | Already claimed tenant signs in again | Static evidence: existing role/tenant user short-circuits without new tenant/invitation; no emulator result | ❌ UNTESTED |
| Duplicate Email Handling | Duplicate pending invitation is attempted | Static evidence: `assertInvitationAvailable` blocks active invitation for another tenant; same tenant is idempotent by task 2.2; no emulator result | ❌ UNTESTED |
| Duplicate Email Handling | Duplicate active tenants share email | Static evidence: `resolveTenantInvitationForClaim` rejects `>1` active tenant before writes; no emulator result | ❌ UNTESTED |
| Invitation Status Contract | Pending state remains until claim succeeds | Static evidence: admin create writes `pending`; no emulator result | ❌ UNTESTED |
| Invitation Status Contract | Failed claim preserves pending state | Static evidence: validation happens before Firestore batch for common claim failures; no emulator result | ❌ UNTESTED |
| Backward-Compatible Email Invitations | Legacy email invitation is claimed | Static evidence: legacy token docs queried by `email` and repaired to canonical doc; no emulator result | ❌ UNTESTED |
| Backward-Compatible Email Invitations | Legacy data is incomplete or ambiguous | Static evidence: multiple legacy invitations and duplicate active tenants reject; no emulator result | ❌ UNTESTED |

**Compliance summary**: 0/10 scenarios compliant by executed behavioral evidence.

---

### Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Admin-Governed Tenant Invitation | ✅ Implemented structurally | Admin create/update use callables and create `tenantInvitations/{normalizedEmail}`; tenant self-service no longer creates tenant/property records. |
| Tenant Claim Flow | ⚠️ Partial | Claim flow links Auth claims, `users`, invitation, and tenant status. However `setCustomUserClaims` happens outside Firestore batch, so cross-system atomicity is not guaranteed if Firestore commit fails after claims are set. |
| Duplicate Email Handling | ✅ Implemented structurally | Duplicate active tenant email and conflicting canonical/legacy invitation paths reject with `failed-precondition`/`already-exists`; same-tenant retry remains idempotent per task 2.2. |
| Invitation Status Contract | ✅ Implemented structurally | New admin-created invitations use `pending`; successful claim writes `claimed`; revoked blocks claim; docs tolerate `accepted` and `self_registered`. |
| Backward-Compatible Email Invitations | ✅ Implemented structurally | Canonical email doc is checked first; legacy token-id docs are read by normalized `email`, rejected when ambiguous, and repaired/marked claimed when accepted. |

---

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Admin invitation is the canonical onboarding path | ✅ Yes | `createTenantAdminProfile`/`updateTenantAdminProfile` own admin setup; `createTenantProfile` only claims existing governed access. |
| Keep legacy email-keyed `tenantInvitations/{email}` as compatibility read path | ✅ Yes | Canonical ID is normalized email; legacy token docs are compatibility-only and migrated/marked. |
| Functions own cross-document consistency | ⚠️ Partial | Functions own create/update/claim. Revocation/deletion paths in `public/app.js` still directly update `tenants`, `users`, and `tenantInvitations`, though design allowed rollout compatibility. |
| Preserve document shapes during rollout | ✅ Yes | Existing fields/statuses preserved and documented. |
| File Changes table | ⚠️ Deviated | Slice files were changed, but working tree also contains unrelated/local-dev changes outside this slice. See Scope Purity. |

---

### Scope Purity

Working tree contains many files beyond this slice, including local-dev/runtime/payment verification/config files (`firebase.json`, root `package.json`, `public/firebase-config.js`, `public/runtime-config.js`, `scripts/`, receipt verification pages, etc.). Those appear outside the proposal/design for tenant onboarding and were not treated as evidence for this slice except `validate:local-dev`.

Slice-relevant files reviewed:

- `functions/src/modules/tenants.ts`
- `functions/src/types.ts`
- `functions/src/index.ts`
- `firestore.rules`
- `public/app.js`
- `public/index.html`
- `docs/modelo-datos.md`
- `docs/setup-firebase.md`
- `docs/local-tenant-emulator-flow.md`

---

### Issues Found

**CRITICAL** (must fix before archive):

1. Behavioral compliance is unproven: 10/10 spec scenarios are untested by executed tests/emulator evidence, and tasks 5.3–5.7 remain incomplete.
2. Task 5.8 remains incomplete because emulator scenario evidence has not been recorded.

**WARNING** (should fix):

1. Cross-system claim alignment is not truly atomic: Auth custom claims are written before Firestore batch commit. If Firestore commit fails, custom claims can be partially mutated.
2. Scope purity risk: active working tree includes unrelated changes beyond this onboarding contract slice.
3. Revocation/deletion flows in `public/app.js` still do direct client writes to `tenants`, `users`, and `tenantInvitations`; acceptable as rollout compatibility only if intentionally deferred.

**SUGGESTION** (nice to have):

1. Add emulator-backed automated tests or scripted smoke checks for the 10 spec scenarios so future verify runs can prove compliance without manual UI-only evidence.
2. Normalize stale frontend helper code related to property-type onboarding (`handlePropertyTypeChange`) if it is no longer reachable, to reduce future confusion.

---

### Verdict

**FAIL**

Static implementation largely matches the intended contract, and TypeScript/local-dev checks pass, but this change cannot pass verification yet because required emulator/manual behavioral scenarios remain incomplete and every spec scenario is unproven at runtime.

---

### Major Requirement Pass/Fail

| Major requirement | Static status | Verification verdict |
|-------------------|---------------|----------------------|
| Admin-governed tenant invitation | ✅ Implemented structurally | ❌ Fail: emulator scenarios pending |
| Tenant claim flow | ⚠️ Partial atomicity concern | ❌ Fail: emulator scenarios pending |
| Duplicate email handling | ✅ Implemented structurally | ❌ Fail: emulator scenarios pending |
| Invitation status contract | ✅ Implemented structurally | ❌ Fail: emulator scenarios pending |
| Backward-compatible email invitations | ✅ Implemented structurally | ❌ Fail: emulator scenarios pending |

### Remaining Manual Follow-ups

Run and record Firebase Emulator evidence for tasks 5.3–5.7, including Firestore document snapshots/custom-claim confirmation for success paths and no-partial-mutation confirmation for failure paths.
