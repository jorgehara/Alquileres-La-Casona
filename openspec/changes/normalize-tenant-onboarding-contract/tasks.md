# Tasks: Normalize Tenant Onboarding Contract

## Phase 1: Contract Foundation

- [x] 1.1 In `functions/src/modules/tenants.ts`, define one canonical onboarding contract for tenant access: normalized lowercase email, `tenantId`, `userId`, `status`, `displayName`, `createdAt`, `createdBy`, `claimedAt`, `claimedBy`, and legacy identifier metadata when needed.
- [x] 1.2 In `functions/src/modules/tenants.ts`, add small helpers for normalized invitation ids and email normalization so `inviteTenantUser` and `claimTenantAccess` stop duplicating lookup rules.
- [x] 1.3 In `functions/src/types.ts`, add or align tenant onboarding/invitation types used by callable functions without changing the current Firebase Functions + vanilla JS stack.
- [x] 1.4 In `firestore.rules`, update helper naming/lookup expectations so rules reference the canonical email-keyed invitation path and do not rely on token-style invitation ids for signed-in tenant claims.

## Phase 2: Invitation and Claim Normalization

- [x] 2.1 In `functions/src/modules/tenants.ts`, update `inviteTenantUser` to write `tenantInvitations/{normalizedEmail}` as the canonical document and keep any token value as compatibility metadata only, not the primary claim key.
- [x] 2.2 In `functions/src/modules/tenants.ts`, make `inviteTenantUser` idempotent for an existing Auth user or invitation with the same normalized email and tenant, preserving role `tenant`, `tenantId`, and active user profile state.
- [x] 2.3 In `functions/src/modules/tenants.ts`, update `claimTenantAccess` to resolve access from the canonical invitation first, then from one explicitly supported legacy fallback only when unambiguous.
- [x] 2.4 In `functions/src/modules/tenants.ts`, ensure `claimTenantAccess` atomically aligns Firebase custom claims, `users/{uid}`, `tenantInvitations/{normalizedEmail}`, and `tenants/{tenantId}.invitationStatus` after a successful claim.
- [x] 2.5 In `public/app.js`, keep post-login claim handling compatible with the normalized callable response and force token/profile refresh only after successful claim alignment.

## Phase 3: Cleanup of Ambiguous Self-Service Paths

- [x] 3.1 In `functions/src/modules/tenants.ts`, remove or disable ambiguous self-service onboarding behavior that creates active tenant profiles from public property selection when no canonical invitation exists.
- [x] 3.2 In `public/app.js`, remove or gate the tenant self-service onboarding submit path so unaffiliated signed-in users are directed to pending access instead of creating tenant profiles.
- [x] 3.3 In `public/app.js`, clean tenant onboarding copy/state transitions so invited tenants claim access and non-invited users see a clear admin-contact path.
- [x] 3.4 In `firestore.rules`, remove tenant self-create assumptions from `/users/{userId}` rules if the server-side claim callable is now the only supported tenant-linking path.
- [x] 3.5 In `docs/setup-firebase.md` and `docs/local-tenant-emulator-flow.md`, update onboarding notes to describe invitation/claim flow as canonical and self-service profile creation as unsupported for this slice.

## Phase 4: Compatibility Handling

- [x] 4.1 In `functions/src/modules/tenants.ts`, support legacy `tenantInvitations/{token}` or tenant `invitationToken` data only as read/repair compatibility during claim, with deterministic conflict rejection for multiple candidates.
- [x] 4.2 In `functions/src/modules/tenants.ts`, when a legacy invitation is accepted, write the canonical `tenantInvitations/{normalizedEmail}` document and mark legacy metadata as migrated or claimed without deleting historical audit context.
- [x] 4.3 In `firestore.rules`, keep read/update compatibility only for signed-in users whose email matches canonical invitation email; do not allow token-id documents to become a second claim authority.
- [x] 4.4 In `docs/modelo-datos.md` or `docs/arquitectura-tecnica-final.md`, document canonical invitation shape plus legacy fields tolerated during migration.

## Phase 5: Verification Strategy

- [x] 5.1 Run `npm run lint:functions` and verify TypeScript strict mode accepts the normalized tenant invitation helpers and callable responses.
- [x] 5.2 Run `npm run validate:local-dev` to confirm this slice keeps local Firebase emulator isolation checks intact.
- [ ] 5.3 With Firebase emulators, verify admin invitation creates/updates `tenantInvitations/{normalizedEmail}`, sets Auth custom claims, links `users/{uid}`, and updates `tenants/{tenantId}.invitationStatus`.
- [ ] 5.4 With Firebase emulators, verify invited tenant first login claims access, refreshes claims/profile, lands in the tenant portal, and can read only their own tenant data.
- [ ] 5.5 With Firebase emulators, verify non-invited user login cannot self-create a tenant profile and renders pending/access-denied UI without writing `tenants`, `users`, or `tenantInvitations` documents.
- [ ] 5.6 With Firebase emulators, verify legacy token invitation data can be claimed only when it maps to exactly one tenant/email pair and is repaired into the canonical email-keyed document.
- [ ] 5.7 With Firebase emulators, verify duplicate active tenants or conflicting invitation records for one email fail with explicit `failed-precondition` behavior and do not partially mutate claims or Firestore documents.
- [ ] 5.8 Record verification evidence in `openspec/changes/normalize-tenant-onboarding-contract/verify-report.md`, including commands run, emulator scenarios, and any intentionally deferred compatibility cleanup.
