# Verification Report

**Change**: `normalize-tenant-onboarding-contract`  
**Version**: N/A  
**Mode**: Standard  
**Artifact store**: OpenSpec / in-repo  
**Runtime verification date**: 2026-08-03  
**Verifier command**: `npm run verify:tenant-onboarding`

---

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 26 |
| Tasks complete | 24 |
| Tasks incomplete | 2 |

Incomplete tasks:

- [ ] 5.4 UI-only residue: confirm invited tenant lands in tenant portal after claim/token refresh in browser.
- [ ] 5.5 UI-only residue: confirm non-invited user sees pending/access-denied copy in browser.

---

### Build & Tests Execution

**Environment**:

```text
JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot
PATH prepended with %JAVA_HOME%\bin
java -version => openjdk version "21.0.12" 2026-07-21 LTS
Pre-run port check => 9099, 8080, 5001 clear
Post-run port check => 9099, 8080, 5001 clear
```

**Build**: ✅ Passed

```text
npm run build:functions
tsc -p tsconfig.json
```

**Tests / emulator verifier**: ✅ Passed

```text
npm run verify:tenant-onboarding

> npm run build:functions && firebase emulators:exec --only auth,firestore,functions "node scripts/verify-tenant-onboarding-emulator.mjs"

Firebase emulators started for auth, firestore, and functions.
Tenant onboarding emulator verification passed.
Script exited successfully (code 0).
```

**Checks**: ✅ 24 passed / ❌ 0 failed / ⚠️ 0 skipped reported  
**Coverage**: ➖ Not available; custom emulator verifier does not emit coverage.

---

### Emulator Check Table Summary

All 24 verifier checks passed:

| Area | Passed checks |
|------|---------------|
| Admin invitation / canonical email id / existing user linking | 5 |
| Admin-created pending invitation-backed tenant | 3 |
| Invited tenant claim + profile/claims/invitation/tenant alignment | 2 |
| Firestore rules: own profile/tenant allowed, other profile/tenant denied | 4 |
| Non-invited user self-service rejection and no-write behavior | 2 |
| Legacy token invitation claim and canonical repair | 2 |
| Ambiguous legacy token rejection and no repair | 2 |
| Duplicate active tenant rejection and no partial mutation | 2 |
| Conflicting canonical invitation rejection and no partial mutation | 2 |

The prior startup/env guard failure (`Missing: FUNCTIONS_EMULATOR_HOST`) did not recur after the guard fix.

---

### Spec Compliance Matrix

| Requirement | Scenario | Runtime evidence | Result |
|-------------|----------|------------------|--------|
| Admin-Governed Tenant Invitation | Admin prepares tenant invitation | `admin creates pending invitation-backed tenant`, `admin create produced tenant id`, `admin create writes canonical pending invitation` | ✅ COMPLIANT |
| Admin-Governed Tenant Invitation | Tenant cannot self-claim property | `non-invited user cannot self-create tenant profile`, `non-invited failure leaves no tenant onboarding writes` | ✅ COMPLIANT |
| Tenant Claim Flow | Invited tenant claims access | `invited tenant first login claims access`, `tenant claim aligns claims profile invitation tenant`, rules read checks | ✅ COMPLIANT |
| Tenant Claim Flow | Already claimed tenant signs in again | `admin invitation links existing auth user`, `admin invite links profile and claims` | ✅ COMPLIANT |
| Duplicate Email Handling | Duplicate pending invitation is attempted | `conflicting canonical invitation fails before mutation`, `conflicting invitation failure has no partial mutation` | ✅ COMPLIANT |
| Duplicate Email Handling | Duplicate active tenants share email | `duplicate active tenants fail before mutation`, `duplicate active tenant failure has no partial mutation` | ✅ COMPLIANT |
| Invitation Status Contract | Pending state remains until claim succeeds | `admin creates pending invitation-backed tenant`, `admin create writes canonical pending invitation` | ✅ COMPLIANT |
| Invitation Status Contract | Failed claim preserves pending state | duplicate/conflict/ambiguous no-partial-mutation checks | ✅ COMPLIANT |
| Backward-Compatible Email Invitations | Legacy email invitation is claimed | `legacy token invitation claims when unambiguous`, `legacy token claim repairs canonical doc` | ✅ COMPLIANT |
| Backward-Compatible Email Invitations | Legacy data is incomplete or ambiguous | `ambiguous legacy token invitations fail`, `ambiguous legacy failure leaves no canonical repair` | ✅ COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant with runtime evidence.

---

### Correctness (Static — Structural Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Admin-Governed Tenant Invitation | ✅ Implemented | Runtime verifier proves admin-created canonical pending invitation and non-invited self-service rejection. |
| Tenant Claim Flow | ✅ Implemented | Runtime verifier proves invited claim links profile, claims, invitation, tenant, and tenant-only reads. |
| Duplicate Email Handling | ✅ Implemented | Runtime verifier proves duplicate/conflict failures avoid partial mutation. |
| Invitation Status Contract | ✅ Implemented | Runtime verifier proves pending/claimed transitions and failed-claim preservation. |
| Backward-Compatible Email Invitations | ✅ Implemented | Runtime verifier proves legacy unambiguous claim repair and ambiguous rejection. |

---

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Admin invitation is the canonical onboarding path | ✅ Yes | Admin-driven invitation and rejection of non-invited self-service are verified. |
| Keep legacy email-keyed `tenantInvitations/{email}` as compatibility read path | ✅ Yes | Legacy-compatible claim and canonical repair are verified. |
| Functions own cross-document consistency | ✅ Yes | Auth claims, `users/{uid}`, `tenantInvitations/{email}`, and tenant status alignment are verified. |
| Preserve document shapes during rollout | ✅ Yes | Canonical invitation id/status and legacy compatibility are verified without migration requirement. |

---

### Issues Found

**CRITICAL**:
- None.

**WARNING**:
- UI-only portions of tasks 5.4 and 5.5 remain manual/incomplete.
- Firebase Functions emulator warns that `firebase-functions` is outdated; this did not block build, emulator startup, or verifier execution.

**SUGGESTION**:
- Update OpenSpec evidence to remove the obsolete startup/env guard failure and keep this passing root-script run as the current audit trail.

---

### Verdict

**PASS WITH WARNINGS**

The clean `npm run verify:tenant-onboarding` rerun passes with JDK 21, all 24 emulator checks pass, and ports 9099/8080/5001 are clear before and after execution. Remaining warnings are manual UI smoke tasks 5.4/5.5 and the unrelated outdated `firebase-functions` emulator warning.
