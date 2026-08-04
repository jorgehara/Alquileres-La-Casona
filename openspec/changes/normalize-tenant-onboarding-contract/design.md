# Design: Normalize Tenant Onboarding Contract

## Technical Approach

Normalize tenant onboarding around an admin-governed invitation + claim flow without changing stack or forcing a data migration. The backend remains Firebase Cloud Functions TypeScript on Node 20, Firestore/Auth remain the source systems, and the frontend remains the existing vanilla JS SPA in `public/app.js`.

The core change is to make `functions/src/modules/tenants.ts` the canonical writer for onboarding relationships across `tenants`, `users`, and `tenantInvitations`. Existing email-keyed invitation documents stay readable and claimable. New writes should prefer a stable invitation document contract that can coexist with legacy records, while admin-created tenant profiles remain the entry point for access.

## Architecture Decisions

### Decision: Admin invitation is the canonical onboarding path

**Choice**: Tenant access is granted only after an admin creates or updates a tenant record and an invitation exists for that tenant/email pair. The public self-service onboarding form stops creating independent tenant/property records and instead claims an existing admin-governed invitation.

**Alternatives considered**: Keep open self-registration via `createTenantProfile`; migrate every existing tenant to a new invitation model before release.

**Rationale**: The current self-registration path lets a signed-in user create `tenants`, select units, create `users`, update properties, and generate charges. That conflicts with an admin-governed rental domain and creates race/matching risks. A big-bang migration increases production risk; compatibility-first claim logic avoids that.

### Decision: Keep legacy email-keyed `tenantInvitations/{email}` as a compatibility read path

**Choice**: `claimTenantAccess` resolves invitations by normalized auth email against existing `tenantInvitations/{email}` records first/alongside any new canonical lookup, then writes back claimed state in a compatible shape.

**Alternatives considered**: Rename all invitation docs to random IDs; require explicit invitation tokens in URLs; delete email-keyed records.

**Rationale**: Firestore rules and current frontend flows already depend on email-keyed docs. Removing that contract would strand existing pending invitations. Random IDs or tokens can be introduced later as an enhancement, but this change should normalize behavior without data loss.

### Decision: Functions own cross-document consistency

**Choice**: `functions/src/modules/tenants.ts` becomes responsible for tenant invitation creation, claim resolution, Auth custom claims, `users/{uid}` linkage, and tenant invitation-status transitions.

**Alternatives considered**: Continue direct frontend writes to `tenants` + `tenantInvitations`; rely on Firestore rules to enforce complex onboarding invariants.

**Rationale**: Existing direct writes duplicate business logic in `public/app.js` and Functions. Cross-document invariants need server authority because they span Auth custom claims plus three Firestore collections.

### Decision: Preserve document shapes during rollout

**Choice**: Existing fields remain valid: `tenantInvitations.email`, `tenantInvitations.tenantId`, `displayName`, `status`, `createdAt`, `createdBy`, `claimedAt`, `claimedBy`; `tenants.email`, `invitationStatus`; `users.role`, `tenantId`, `email`, `displayName`, `status`.

**Alternatives considered**: Introduce a completely new collection or remove `invitationStatus` from tenants.

**Rationale**: The SPA renders invitation status from tenant documents, Firestore rules reference `tenantInvitations/{email}`, and admin operations delete/update invitation docs by tenant email. Keeping shape reduces blast radius.

## Data Flow

### Admin creates or updates tenant

```text
Admin form (`public/app.js`)
  └─ callable Function (`functions/src/modules/tenants.ts`)
       ├─ validate admin scope + property occupancy
       ├─ upsert tenants/{tenantId}
       ├─ upsert tenantInvitations/{normalizedEmail} when email exists
       ├─ update linked users/{uid} if tenant already claimed
       └─ return tenant + invitation status to SPA
```

### Tenant signs in and claims access

```text
Tenant login/register (`public/app.js`)
  └─ tryClaimTenantAccess()
       └─ claimTenantAccess callable
            ├─ normalize request.auth.token.email
            ├─ resolve pending compatible invitation
            │    ├─ tenantInvitations/{email} legacy/current record
            │    └─ fallback tenants query by email only for legacy active records
            ├─ validate tenants/{tenantId} exists + active
            ├─ set Auth custom claims { role: "tenant", tenantId }
            ├─ upsert users/{uid}
            ├─ mark tenantInvitations/{email} claimed
            └─ mark tenants/{tenantId}.invitationStatus = "claimed"
```

### Revocation/deactivation

```text
Admin action
  └─ server-side tenant access operation
       ├─ tenants/{tenantId}.status = inactive or invitationStatus = revoked
       ├─ users where tenantId == target marked inactive/deleted as current UX requires
       └─ tenantInvitations/{email}.status = revoked or document deleted for permanent deletion
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `public/app.js` | Modify | Replace direct tenant onboarding creation with claim-first UX; route admin tenant create/update/delete/revoke through callables; keep `tryClaimTenantAccess()` as login entry point. |
| `public/index.html` | Modify | Reword tenant onboarding panel away from open self-service unit selection; show claim/account completion copy and only collect fields still needed after an admin invitation. |
| `functions/src/modules/tenants.ts` | Modify | Centralize invitation lifecycle helpers, tenant create/update callable responsibilities, claim resolution, legacy compatibility, and access revocation/deletion operations. |
| `functions/src/index.ts` | Modify | Export any new tenant admin callables introduced to replace direct frontend writes. |
| `firestore.rules` | Modify | Narrow client-side writes once Functions own onboarding; preserve read/update compatibility for email-keyed invitation claim records until rollout completes. |
| `docs/modelo-datos.md` | Modify | Document the normalized onboarding contract and legacy-compatible `tenantInvitations/{email}` behavior. |
| `docs/local-tenant-emulator-flow.md` | Modify | Add emulator validation steps for admin invite, tenant claim, and legacy email invitation compatibility. |

## Interfaces / Contracts

### Firestore documents

```ts
type TenantInvitationStatus = "pending" | "claimed" | "accepted" | "revoked";

type TenantInvitationDocument = {
  tenantId: string;
  email: string;          // normalized lowercase email
  displayName?: string;
  status: TenantInvitationStatus;
  createdAt?: string | FirebaseFirestore.Timestamp;
  createdBy?: string;
  updatedAt?: string | FirebaseFirestore.Timestamp;
  claimedAt?: string | FirebaseFirestore.Timestamp;
  claimedBy?: string;
};

type TenantOnboardingFields = {
  email?: string;
  invitationStatus?: "not_sent" | "pending" | "claimed" | "accepted" | "revoked" | "self_registered";
};

type TenantUserDocument = {
  role: "tenant";
  tenantId: string;
  email: string;
  displayName: string;
  status: "active" | "inactive";
};
```

`accepted` should be treated as a legacy synonym for `claimed` during reads because `updateTenantAdminProfile` currently writes `accepted` for linked users while `humanizeInvitationStatus()` only labels `claimed`.

### Function responsibilities in `functions/src/modules/tenants.ts`

Keep the existing module boundary. Add small internal helpers instead of new infrastructure:

- `normalizeEmail(value)` for consistent invitation IDs.
- `resolveTenantInvitationForClaim(email)` to support `tenantInvitations/{email}` and legacy tenant-email fallback.
- `upsertTenantInvitation({ tenantId, email, displayName, status, actorUid })` for admin create/update flows.
- `linkTenantUser({ uid, email, tenantId, displayName })` for Auth claims + `users/{uid}` write.
- `markTenantInvitationClaimed(email, tenantId, uid)` for claim side effects.

Callable ownership target:

- `claimTenantAccess`: remains public authenticated claim endpoint; becomes the only tenant claim writer.
- `inviteTenantUser`: either remains as compatibility wrapper or becomes the canonical admin invite callable; avoid changing its callable name unless frontend and docs migrate together.
- New admin callable(s), if needed: `createTenantAdminProfile`, `deactivateTenantAccess`, `deleteTenantAdminProfile`. Prefer extending existing callables only if names already match behavior.
- `createTenantProfile`: deprecate open self-registration behavior; during rollout, keep callable exported but require a pending compatible invitation or return a clear `failed-precondition` error.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| TypeScript | New helper contracts and callable payload handling | `npm run lint:functions` / `npm run build:functions` after implementation. |
| Rules/emulator | Admin can create invitation-backed tenant; tenant can claim own email-keyed invitation; unrelated signed-in user cannot claim another email | Use Firebase emulator workflow and extend `docs/local-tenant-emulator-flow.md`. |
| Frontend smoke | Login triggers `tryClaimTenantAccess`; admin tenant create/update no longer writes invitation docs directly; status labels handle `pending`, `claimed`, `accepted`, `revoked` | Manual emulator smoke because no frontend test suite exists. |
| Regression | Existing `tenantInvitations/{email}` pending records still claim successfully | Seed emulator with legacy invitation doc and verify `users/{uid}`, custom claims, invitation, tenant status. |

## Migration / Rollout

No big-bang migration required.

1. **Compatibility phase**: deploy claim logic that supports existing `tenantInvitations/{email}` records and tenant-email fallback. Preserve current document fields.
2. **Server-authority phase**: move admin create/update/revoke/delete flows from direct frontend writes into Functions. Keep Firestore rules permissive enough for existing deployed frontend during rollout.
3. **Frontend UX phase**: change tenant onboarding UI from open profile creation to account claim/completion. Login remains the primary entry point through `tryClaimTenantAccess()`.
4. **Rules tightening phase**: after frontend deployment is verified, narrow client writes to `tenants`, `users`, and `tenantInvitations` so onboarding mutations happen through Functions. Keep tenant invitation read/claim compatibility as long as legacy docs exist.
5. **Cleanup phase**: optionally backfill or normalize old `invitationStatus` values (`accepted` → `claimed`) after observing production stability. This is optional and should be reversible.

Rollback plan:

- Keep callable names stable and backwards-compatible so the previous frontend can still call `claimTenantAccess` and existing admin flows can continue during phased deploy.
- Do not delete legacy email-keyed invitation docs during rollout.
- If new server-authority admin callables fail, temporarily leave rules and frontend direct-write fallback available until the issue is fixed.

## Rollout Risks

- **Auth token staleness**: after `setCustomUserClaims`, users may need `getIdToken(true)` or re-login before tenant-only reads work.
- **Status vocabulary drift**: current code uses `pending`, `claimed`, `not_sent`, `revoked`, `self_registered`, and `accepted`. Reads must tolerate all existing values.
- **Duplicate active tenant emails**: existing fallback query by tenant email can find multiple records. Keep the current `failed-precondition` behavior and require admin cleanup.
- **Rules/frontend deployment order**: tightening Firestore rules before frontend moves to callables would break admin tenant creation and invitation writes.
- **Partial cross-document writes**: claim touches Auth, `users`, `tenantInvitations`, and `tenants`; failures must return clear errors and be idempotent on retry.
- **Existing self-registered tenants**: tenants with `invitationStatus: "self_registered"` must keep access; do not revoke or require re-invitation automatically.

## Open Questions

- [ ] Should new invitations continue using `tenantInvitations/{email}` as the canonical ID, or should this change introduce token/random-ID docs while keeping email docs as aliases?
- [ ] Should admins be able to resend invitation emails from this flow, or is invitation state only access governance for now?
