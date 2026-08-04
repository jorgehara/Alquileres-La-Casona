# Tasks: Consolidate Auth Authority

## Phase 1: Authority Model Decisions

- [x] 1.1 Document the canonical authority model in `openspec/changes/consolidate-auth-authority/design.md`: Firestore `users/{uid}` is the server-side source of truth for `role`, `ownerScope`, `tenantId`, and `status`; custom claims are a cached session/UI hint only.
- [x] 1.2 Add acceptance notes to `openspec/changes/consolidate-auth-authority/specs/auth-authority-model/spec.md` covering stale custom claims: privileged Functions and Firestore reads MUST evaluate current `users/{uid}` data, not token-only role data.
- [x] 1.3 Define the role/scope matrix in `openspec/changes/consolidate-auth-authority/specs/auth-authority-model/spec.md`: `superadmin/all`, `admin/enzo`, `admin/ivo`, `admin/all`, `tenant/{tenantId}`, disabled/missing profile, and unauthenticated.

## Phase 2: Code and Rules Alignment

- [x] 2.1 Update `functions/src/lib/auth.ts` so `resolveClaims()` validates active user profile state from `users/{uid}` and returns Firestore-backed authority for callable Functions.
- [x] 2.2 Update `functions/src/lib/auth.ts` so `requireRole()`, `assertOwnerScopeAccess()`, and `requireTenantOwner()` reject missing, disabled, or stale-profile authority consistently with `HttpsError` codes.
- [x] 2.3 Align user authority writers in `functions/src/modules/tenants.ts` (`linkTenantUser`, `createAdminUser`, `bootstrapInitialAdmin`, role/profile update flows) so custom claims and `users/{uid}` stay synchronized after every role, scope, or tenant assignment.
- [x] 2.4 Align `public/app.js` session bootstrap so UI may read custom claims for fast rendering but MUST reconcile against `users/{uid}` before enabling admin/tenant routes or actions.
- [x] 2.5 Align `firestore.rules` helper functions with the authority model, preserving Firestore-backed `users/{uid}` role checks and ensuring owner-scope helpers match `functions/src/lib/auth.ts` normalization.
- [x] 2.6 Align `storage.rules` with the same authority model or document the Firebase Storage limitation if Firestore profile reads are not available there; restrict paths so stale token claims cannot grant broader access than Firestore/Functions authority.

## Phase 3: Stale Token and Session Verification

- [x] 3.1 Add emulator verification coverage for stale custom claims in `scripts/verify-auth-authority-emulator.mjs`: downgrade an admin in `users/{uid}` while preserving old custom claims, then verify callable admin operations fail.
- [x] 3.2 Add emulator verification coverage for stale tenant claims in `scripts/verify-auth-authority-emulator.mjs`: change `users/{uid}.tenantId`, then verify tenant-only Firestore reads/writes and callable operations follow the current profile.
- [x] 3.3 Add browser/session verification notes to `openspec/changes/consolidate-auth-authority/specs/auth-authority-model/spec.md`: after role/scope change, current tabs MUST refresh/reconcile authority before showing privileged UI.
- [x] 3.4 Wire a non-destructive root script in `package.json` named `verify:auth-authority` that builds Functions as needed and runs the emulator verification script against local emulators only.

## Phase 4: Emulator Role Matrix Checks

- [x] 4.1 Seed emulator users, claims, and Firestore profiles in `scripts/verify-auth-authority-emulator.mjs` for `superadmin/all`, `admin/enzo`, `admin/ivo`, `admin/all`, `tenant`, disabled/missing profile, and unauthenticated cases.
- [ ] 4.2 Verify callable Function access for the matrix across representative endpoints exported from `functions/src/index.ts`: admin dataset, tenant onboarding/claiming, payments/receipts, settings/bootstrap, and audit-sensitive operations.
- [ ] 4.3 Verify `firestore.rules` matrix access for representative collections: `users`, `properties`, `tenants`, `charges`, `payments`, `paymentReceipts`, `rentReceipts`, `messages`, and `tenantInvitations`.
- [ ] 4.4 Verify `storage.rules` matrix access for `utility-bills`, `payment-receipts`, `contracts`, `message-attachments`, and `rent-receipts` paths.
- [x] 4.5 Record emulator check outcomes in `openspec/changes/consolidate-auth-authority/tasks.md` by checking off completed matrix tasks only after local emulator evidence passes. Direct `scripts/verify-auth-authority-emulator.mjs` run passed 11/11 checks; broader callable/Firestore/Storage matrix tasks remain pending.

## Phase 5: Final Verification

- [x] 5.1 Run `npm run lint:functions` and fix only auth-authority-related TypeScript errors introduced by this slice.
- [x] 5.2 Run `npm run validate:local-dev` and confirm no production Firebase config is required for the auth-authority verification flow.
- [x] 5.3 Run auth-authority emulator verification against Firebase emulators and capture pass/fail evidence for stale-token/session and role matrix scenarios. Evidence: `scripts/verify-auth-authority-emulator.mjs` was run directly with emulator env vars set and passed 11/11 checks.
- [x] 5.4 Review `git diff --stat` and confirm this slice only changes auth authority code, rules, emulator verification script, package scripts, and SDD artifacts.
