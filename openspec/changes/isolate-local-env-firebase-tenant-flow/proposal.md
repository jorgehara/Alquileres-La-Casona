# Proposal: Isolate Local Env Firebase Tenant Flow

## Problem

Local development can touch production-shaped Firebase resources or assumptions while testing tenant flows. That makes fixes risky: auth, tenant access, Firestore data, Storage references, and callable/function endpoints may behave differently between emulator/local and production. Before hardening tenant behavior, the repo needs a safe local boundary.

## Goals

- Make tenant-flow development run against local/emulated Firebase services by default.
- Preserve current stack: Firebase Hosting, Vanilla JS frontend, Cloud Functions TypeScript, Firestore/Auth/Storage.
- Clarify environment contracts so local, emulator, and production endpoints cannot be mixed accidentally.
- Provide validation hooks or checks that prove local tenant flow isolation before later slices.

## Non-Goals

- No tenant UX redesign.
- No Firestore schema migration beyond what isolation requires.
- No production deployment or product-code implementation in this proposal phase.
- No replacement of Firebase, frontend framework, or Functions architecture.

## Scope Boundaries

### In Scope
- Local environment configuration for frontend and Functions tenant flow.
- Emulator-oriented auth, Firestore, Storage, and function endpoint boundaries.
- Documentation/validation expectations for safe local tenant testing.

### Out of Scope
- Business-rule changes to tenant invitations, permissions, or booking behavior.
- Production data cleanup, seed redesign, or admin tooling.
- Later scalability/refactor slices.

## Capabilities

### New Capabilities
- `local-firebase-tenant-isolation`: Defines safe local/emulator Firebase behavior for tenant flow development.

### Modified Capabilities
- None. No existing OpenSpec capabilities are present yet.

## Approach

Treat this as foundation slice: specify local-first Firebase configuration, explicit environment separation, emulator connection expectations, and checks that fail when tenant-flow development can accidentally target production.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `public/` | Modified later | Frontend Firebase/env selection and tenant flow entry points. |
| `functions/src/` | Modified later | Callable/HTTP tenant endpoints and emulator-safe config. |
| `firebase.json`, `.firebaserc`, env files | Modified later | Emulator/project separation and local defaults. |
| `docs/`, validation scripts | Modified later | Local tenant-flow runbook and guard checks. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Local config diverges from production behavior | Medium | Keep same Firebase APIs; isolate only environment/project selection. |
| Hidden production coupling remains | Medium | Add explicit validation checks in later tasks. |
| Emulator gaps mask auth/rules bugs | Medium | Document known emulator limits and keep production rules/spec parity. |

## Why First in the Chain

Every later tenant-flow fix needs a safe feedback loop. Isolation comes first because debugging auth, Firestore rules, Storage access, or Functions behavior is irresponsible if local work can leak into production or depend on production state.

## Rollback Plan

Revert the change folder and any later slice commits that alter env selection, emulator config, or validation scripts. Since this proposal changes no product code, rollback is deleting this OpenSpec change directory.

## Success Criteria

- [ ] Specs can define local/emulator tenant-flow behavior without changing stack.
- [ ] Later implementation tasks have clear boundaries for frontend, Functions, Firebase config, and validation.
- [ ] No product code is changed by this proposal.
