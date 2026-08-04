# Proposal: Normalize Tenant Onboarding Contract

## Intent

Converge tenant access on one governed onboarding contract. The current flow mixes admin invitations, email-based claim fallback, and tenant self-registration, which creates ambiguous authority across `tenantInvitations`, `tenants`, `users`, custom claims, Functions, and rules. This slice normalizes the contract while keeping Firebase Hosting, vanilla JS, Cloud Functions, Firestore/Auth/Storage, and the local Firebase isolation from slice 1.

## Scope

### In Scope
- Define a single tenant access contract: admin-governed tenant record + invitation/access grant + explicit claim/activation state.
- Keep onboarding entry points, but make them resolve through the same contract and state machine.
- Specify data-shape and validation expectations for `tenantInvitations`, `tenants`, and `users` documents.
- Preserve current stack and local/emulator workflow.

### Out of Scope
- Broader auth-authority refactor between `/users`, custom claims, Firestore rules, and Storage rules.
- UI redesign, framework migration, new auth provider, or production data migration.
- Payment, document, receipt, and owner-scope behavior changes except where tenant access gating requires clarity.

## Capabilities

### New Capabilities
- `tenant-onboarding-contract`: Defines governed tenant invitation, claim, activation, and self-onboarding boundaries.

### Modified Capabilities
- None. No main OpenSpec specs exist yet.

## Approach

Treat admin-created tenant access as canonical. Admin invitation/access grant establishes who may claim a tenant. Claim-by-email becomes a compatibility path only when it maps to an existing governed grant. Self-onboarding must not silently create active tenant authority outside the contract; it should produce a governed pending/reviewable path or be explicitly disabled/deferred by spec. Do not solve final auth authority yet; only make downstream authority sources consume a clearer onboarding result.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `functions/src/modules/tenants.ts` | Modified later | Normalize invite, claim, create profile, and activation semantics. |
| `public/app.js` | Modified later | Align tenant onboarding UI calls with the governed contract. |
| `firestore.rules` | Modified later | Match tenant/user/invitation creation and claim permissions to the contract. |
| `storage.rules`, `functions/src/lib/auth.ts` | Reviewed later | Keep behavior stable; document remaining authority split for next slice. |
| `openspec/changes/isolate-local-env-firebase-tenant-flow/` | Dependency | Builds on local emulator isolation; no product-code changes here. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking existing tenant access | Medium | Preserve callable names where possible; specify compatibility for existing email grants. |
| Expanding into auth-authority refactor | High | Explicitly defer claims/rules source-of-truth consolidation. |
| Ambiguous self-onboarding policy | Medium | Specs must decide pending/review vs disabled before implementation. |

## Rollback Plan

This proposal changes no product code. Roll back by deleting `openspec/changes/normalize-tenant-onboarding-contract/`. Later implementation rollback should revert tenant onboarding, rules, and UI changes as one slice.

## Dependencies

- Slice 1 local Firebase tenant isolation must remain available for safe validation.

## Success Criteria

- [ ] Specs define one governed tenant onboarding/access contract.
- [ ] Claim-by-email and self-onboarding boundaries are explicit, not implicit competing flows.
- [ ] Broader auth-authority refactor is documented as deferred.
- [ ] No product code is changed by this proposal.
