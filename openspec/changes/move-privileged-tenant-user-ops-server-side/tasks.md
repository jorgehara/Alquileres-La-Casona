# Tasks: Move Privileged Tenant User Ops Server Side

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 250-380 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single slice: backend callables + frontend swaps + rule hardening + emulator/manual verification |
| Delivery strategy | chained-slices |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Server-authoritative tenant user operations | Same PR | Callable contracts and exports before UI/rules changes. |
| 2 | Browser write removal and verification | Same PR | Swap call sites, harden rules, prove emulator/manual behavior. |

## Phase 1: Backend Callable Creation

- [x] 1.1 In `functions/src/modules/tenants.ts`, add admin-only callable(s) for tenant user deactivation/revocation and deletion, covering `tenants/{tenantId}`, linked `users/{uid}`, and `tenantInvitations/{email}` consistency.
- [x] 1.2 In `functions/src/modules/tenants.ts`, reuse canonical auth/profile helpers so role, owner-scope, tenant status, and invitation mutations are validated server-side.
- [x] 1.3 In `functions/src/index.ts`, export the new tenant user operation callable(s) with stable names consumed by the SPA.

## Phase 2: Frontend Call-Site Swaps

- [x] 2.1 In `public/app.js`, replace direct privileged writes around admin user removal (`users`, `tenants`, `tenantInvitations`) with the new callable response handling.
- [x] 2.2 In `public/app.js`, replace direct tenant edit/deactivate/delete flows around lines handling `tenants`, `properties`, `tenantInvitations`, and linked `users` with backend callable calls.
- [x] 2.3 In `public/app.js`, keep existing admin UX messages, loading states, and dataset refresh behavior while removing browser authority for cross-document tenant user mutations.

## Phase 3: Rule Hardening

- [x] 3.1 In `firestore.rules`, deny direct browser create/update/delete for privileged `tenants` mutations now owned by callables, preserving tenant self-profile edits only if already allowed by spec.
- [x] 3.2 In `firestore.rules`, deny direct browser create/update/delete for `tenantInvitations/{invitationId}` except explicitly supported tenant claim compatibility reads/updates.
- [x] 3.3 In `firestore.rules`, deny direct browser admin deletes/authority updates for `users/{userId}` that are now callable-owned.

## Phase 4: Emulator and Manual Verification

- [x] 4.1 Extend `scripts/verify-auth-authority-emulator.mjs` or add a focused emulator script to prove stale/non-admin browser writes to `tenants`, `users`, and `tenantInvitations` are denied.
- [x] 4.2 With Firebase emulators, verify an authorized admin can revoke/deactivate tenant access through the callable and resulting `users`, `tenants`, and `tenantInvitations` state is consistent.
- [x] 4.3 With Firebase emulators, verify an authorized admin can delete tenant access through the callable without leaving linked active user authority or pending invitation state.
- [ ] 4.4 Manual browser smoke: admin tenant edit/delete/revoke UI works through callables; tenant and non-admin sessions cannot perform equivalent direct Firestore writes from the browser.
