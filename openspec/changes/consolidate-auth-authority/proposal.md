# Proposal: Consolidate Auth Authority

## Intent

Define one consistent authority model for user role, tenant identity, and owner scope. Slice 2 normalized tenant onboarding, but authority is still split: Functions, Firestore rules, Storage rules, and frontend session checks can read different sources (`users`, custom claims, tenant docs). This slice makes those assumptions explicit and consistent while keeping the current Firebase + vanilla JS stack.

## Scope

### In Scope
- Define canonical authority fields for `role`, `tenantId`, and `ownerScope`.
- Align Functions auth helpers, Firestore rules, Storage rules, and frontend session assumptions to the same model.
- Preserve existing callable names, collections, and local/emulator workflow.
- Document claim refresh/session expectations after authority changes.

### Out of Scope
- Frontend modularization or SPA architecture cleanup.
- Broader UX redesign, new auth provider, framework migration, or production data migration.
- Moving all sensitive operations server-side beyond what authority consistency requires.
- Emulator evidence backlog from slice 2, except where reused for authority validation.

## Capabilities

### New Capabilities
- `auth-authority-model`: Defines canonical role, tenant, and owner-scope authority across Functions, Firestore rules, Storage rules, and frontend session assumptions.

### Modified Capabilities
- None. No main OpenSpec specs exist yet.

## Approach

Use custom claims as the fast authorization snapshot and `users/{uid}` as the durable profile/audit source. Functions remain responsible for issuing/updating claims when onboarding or admin changes authority. Firestore and Storage rules must authorize from the same claim contract. Frontend must treat claims/session as derived state: refresh ID tokens after authority mutations, then hydrate UI from the consistent session/profile model.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `functions/src/lib/auth.ts` | Modified later | Centralize role, tenant, and owner-scope resolution. |
| `functions/src/modules/tenants.ts` | Modified later | Keep onboarding claim writes aligned with authority model. |
| `firestore.rules` | Modified later | Use the same authority fields as Functions for document access. |
| `storage.rules` | Modified later | Match tenant/owner access checks to Firestore/Functions authority. |
| `public/app.js` | Modified later | Refresh tokens/session assumptions after authority changes; no modularization. |
| `docs/modelo-datos.md` | Modified later | Document canonical authority contract. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Claims and `users/{uid}` drift | Medium | Specify Functions as the only authority mutation path and require token refresh. |
| Rules break existing sessions | Medium | Preserve field names where possible; validate with emulator/local flow. |
| Scope creep into frontend cleanup | High | Limit frontend work to session assumptions and token refresh. |

## Rollback Plan

This proposal changes no product code. Roll back by deleting `openspec/changes/consolidate-auth-authority/`. Later implementation rollback should revert Functions auth helpers, rules, Storage rules, and session changes as one slice.

## Dependencies

- Slice 1 local Firebase isolation remains the validation boundary.
- Slice 2 tenant onboarding contract remains the source of tenant claim/link creation.

## Success Criteria

- [ ] Specs define one canonical authority contract for role, tenant, and owner scope.
- [ ] Functions, Firestore rules, Storage rules, and frontend session assumptions use that contract.
- [ ] Existing stack and callable/collection boundaries remain intact.
- [ ] Frontend modularization and broader UX work stay deferred.
