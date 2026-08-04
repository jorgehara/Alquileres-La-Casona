# Proposal: Move Privileged Tenant/User Ops Server-Side

## Intent

Reduce the highest-risk browser-side writes after slices 1-3. Tenant and user authority is now canonical around `users/{uid}`, but some destructive lifecycle operations still mutate `tenants`, `users`, `tenantInvitations`, and linked `properties` directly from `public/app.js`. This slice moves those privileged mutations into Cloud Functions so authorization, validation, claims cleanup, audit context, and multi-document consistency live server-side.

## Scope

### In Scope
- Add callable Functions for privileged user and tenant lifecycle mutations: deactivate/delete tenant access, permanently delete tenant profile, and permanently delete user access.
- Replace the highest-risk direct browser writes in those flows with callable invocations.
- Enforce server-side authority using the slice 3 `users/{uid}` model and close matching Firestore rule write paths where feasible.
- Preserve current Firebase Hosting + vanilla JS + Cloud Functions TypeScript stack and existing UI flow.

### Out of Scope
- Frontend modularization, SPA restructuring, or broader component extraction.
- Moving lower-risk operational writes such as bills, receipts, payments, settings, and property creation unless required by tenant/user lifecycle consistency.
- Production data migration, new auth provider, or framework migration.

## Capabilities

### New Capabilities
- `server-side-privileged-mutations`: Defines callable-only privileged tenant/user lifecycle mutations and matching client/rules boundaries.

### Modified Capabilities
- None. No main OpenSpec specs exist yet; this builds on active `auth-authority-model` and `tenant-onboarding-contract` deltas.

## Approach

Implement focused callable endpoints in `functions/src/modules/tenants.ts` (or adjacent module if needed) for destructive tenant/user lifecycle operations. Each Function resolves canonical actor authority, rejects self-deletion and scope violations, performs all related document updates/deletes atomically where possible, updates/clears Auth claims when user authority changes, and records audit data server-side or through the existing audit path. `public/app.js` keeps current handlers but swaps direct Firestore mutations for callables. Firestore rules should deny browser writes to protected lifecycle fields now owned by Functions.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `functions/src/modules/tenants.ts` | Modified | Add tenant/user lifecycle callable handlers and reuse authority helpers. |
| `functions/src/index.ts` | Modified | Export new callable endpoints. |
| `public/app.js` | Modified | Replace direct privileged writes in deletion/deactivation handlers with callables only. |
| `firestore.rules` | Modified | Restrict protected `tenants`, `users`, `tenantInvitations`, `properties.currentTenantId` writes to server-owned paths. |
| `docs/modelo-datos.md` | Modified | Document server-owned lifecycle mutation boundary if docs are updated. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Partial multi-document lifecycle update | Medium | Use batch/transaction where safe; define idempotent status transitions. |
| Admin lockout via bad user deletion | Medium | Keep self-deletion blocked and require canonical superadmin/admin checks. |
| Scope creep into frontend cleanup | High | Only touch existing handlers needed to call Functions. |

## Rollback Plan

This proposal changes no product code. Roll back by deleting `openspec/changes/move-privileged-tenant-user-ops-server-side/`. Later implementation rollback should restore previous browser handlers and rules together, then remove new callable exports.

## Dependencies

- Slice 1 local Firebase isolation for safe validation.
- Slice 2 tenant onboarding contract.
- Slice 3 canonical `users/{uid}` authority model.

## Success Criteria

- [ ] Specs define which tenant/user lifecycle mutations are callable-only.
- [ ] Browser no longer directly mutates protected lifecycle fields for targeted flows.
- [ ] Functions enforce canonical authority and preserve audit/claim consistency.
- [ ] Frontend modularization remains deferred.
