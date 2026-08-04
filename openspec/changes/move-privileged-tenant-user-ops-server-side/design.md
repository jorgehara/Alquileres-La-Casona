# Design: Move Privileged Tenant/User Operations Server-Side

## Technical Approach

Keep the current Firebase Hosting + vanilla JS frontend and Firebase Cloud Functions TypeScript backend. Move privileged tenant/user mutations that still run as direct Firestore writes in `public/app.js` into callable Cloud Functions under `functions/src/modules/tenants.ts`, reusing the canonical `users/{uid}` authority model from the previous auth-authority slice.

The frontend remains responsible for UI state, confirmation prompts, and calling existing/new callables. Firestore becomes a read/subscription surface for admin screens plus narrowly allowed non-privileged writes; privileged mutations that affect `users`, `tenants`, `tenantInvitations`, and linked `properties.currentTenantId` are authorized and executed by Functions with Admin SDK.

This preserves existing admin flows while closing client-write gaps:

- tenant deactivation
- tenant permanent deletion
- user permanent deletion
- tenant invitation revoke/delete side effects
- linked user disable/delete side effects
- property vacancy side effects
- authority/custom-claim refresh side effects
- audit log creation for these operations

## Architecture Decisions

### Decision: Use callable Functions as the single privileged mutation boundary

**Choice**: Add narrow callables for privileged tenant/user lifecycle operations and have `public/app.js` call them instead of `updateDoc`, `setDoc`, or `deleteDoc` directly for sensitive documents.

**Alternatives considered**: Keep direct Firestore writes and harden rules; introduce an HTTP API layer; rewrite frontend modules first.

**Rationale**: Firestore rules can validate shape and ownership, but cannot safely coordinate multi-document side effects, Auth custom claims, or audit writes. Callable Functions match the existing stack and pattern already used by `createTenantAdminProfile`, `updateTenantAdminProfile`, `createAdministrativeUser`, and `updateUserAuthority`.

### Decision: Keep `users/{uid}` as canonical authority and make claims derived

**Choice**: Authorize callables with `requireRole`/`resolveAuthContext`, read target authority from `users/{uid}`, and update Auth custom claims only after canonical user profile changes commit.

**Alternatives considered**: Authorize from `request.auth.token` only; duplicate checks in frontend; add a new authority collection.

**Rationale**: Slice 3 already made `users/{uid}` canonical. Reusing it preserves compatibility and prevents stale token escalation inside Functions. Custom claims remain a compatibility projection for client/session and Storage limitations, not source of truth.

### Decision: Co-locate tenant/user lifecycle callables in `tenants.ts`

**Choice**: Extend `functions/src/modules/tenants.ts` with lifecycle helpers and exports, keeping shared normalization helpers (`normalizeEmail`, `buildCanonicalAuthProfile`, `normalizeUserStatus`, `upsertTenantInvitation`) in the same module for now.

**Alternatives considered**: Create a new `adminUsers.ts` or `tenantLifecycle.ts` module immediately.

**Rationale**: Existing tenant onboarding, admin tenant profile, admin user creation, and authority update logic already live in `tenants.ts`. Co-location minimizes product-code churn for this slice. A later frontend/backend modularization slice can extract seams without changing contracts.

### Decision: Write audit logs inside privileged callables

**Choice**: Lifecycle callables write audit entries from server-side actor context after successful state changes, using the same `auditLogs` collection shape consumed by the UI.

**Alternatives considered**: Keep frontend `writeAuditLog` calls around the new callables; use Firestore triggers; add a generic audit service first.

**Rationale**: Client-side audit logging can be skipped, spoofed, or become inconsistent if the mutation fails after the audit write. Server-side audit hooks ensure audit reflects the actor authenticated by Functions and the actual committed operation. Firestore triggers would add extra async behavior and make rollback/debugging harder for this slice.

### Decision: Transitional Firestore rules deny privileged writes after frontend switch

**Choice**: Change rules in the same rollout so admin clients can no longer directly create/update/delete `users` or delete/update sensitive tenant lifecycle fields, while preserving reads and tenant self-profile contact updates.

**Alternatives considered**: Deploy Functions first and keep permissive rules indefinitely; deny all tenant/user writes immediately before frontend deployment.

**Rationale**: A short transition avoids breaking active clients during deployment, but final rules must fail closed. Because Hosting and Functions deploys can be ordered, deploy callables first, then frontend, then tightened rules once smoke checks pass.

## Data Flow

### User authority update

```text
Admin UI
  └─ httpsCallable("updateUserAuthority")
       ├─ requireRole(["admin", "superadmin"])
       ├─ reject self mutation
       ├─ validate target user and role/scope/status
       ├─ write users/{targetUid}
       ├─ update Auth custom claims projection
       └─ write auditLogs/{autoId}
```

Existing callable exists; design adds server-side audit and ensures frontend no longer writes a separate audit entry for this mutation.

### Permanent user deletion

```text
Admin UI confirmation
  └─ httpsCallable("deleteAdministrativeUserAccess" or "deleteUserAccess")
       ├─ requireRole(["admin", "superadmin"])
       ├─ reject self deletion
       ├─ read users/{targetUid}
       ├─ if target is admin/superadmin: require actor superadmin
       ├─ if target.tenantId: mark tenants/{tenantId} inactive + invitation revoked
       ├─ if target.email: delete tenantInvitations/{email}
       ├─ delete users/{targetUid}
       ├─ clear/delete Firebase Auth user when safe and intentional
       └─ write auditLogs/{autoId}
```

The current UI text says “elimina definitivamente el acceso”; the design should preserve that behavior by deleting the app authority profile. Deleting the Firebase Auth account is optional only if existing product semantics expect account removal; otherwise the user remains unable to access because `users/{uid}` is gone.

### Tenant deactivation

```text
Admin UI confirmation
  └─ httpsCallable("deactivateTenant")
       ├─ requireRole(["admin", "superadmin"])
       ├─ assert actor can access tenant property ownerScope
       ├─ set tenants/{tenantId}.status = "inactive"
       ├─ set tenants/{tenantId}.contractStatus = "terminated"
       ├─ clear properties/{propertyId}.currentTenantId
       ├─ revoke tenantInvitations/{tenant.email}
       ├─ set linked users status = "inactive"
       ├─ clear linked users' custom claims
       └─ write auditLogs/{autoId}
```

### Tenant permanent deletion

```text
Admin UI exact-name confirmation
  └─ httpsCallable("deleteTenantProfile")
       ├─ requireRole(["admin", "superadmin"])
       ├─ assert actor can access tenant property ownerScope
       ├─ read linked users by tenantId
       ├─ clear properties/{propertyId}.currentTenantId
       ├─ delete tenantInvitations/{tenant.email}
       ├─ delete linked users/{uid}
       ├─ clear linked users' custom claims
       ├─ delete tenants/{tenantId}
       └─ write auditLogs/{autoId}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `functions/src/modules/tenants.ts` | Modify | Add lifecycle callables for user deletion, tenant deactivation, and tenant permanent deletion; add server-side audit helper usage; enforce actor role/scope checks and claim cleanup. |
| `functions/src/index.ts` | Modify | Export new callables from `tenants.ts`. |
| `functions/src/types.ts` | Modify | Add small request/result types only if needed for lifecycle callable contracts. |
| `public/app.js` | Modify | Replace direct Firestore writes in `handleUserPermanentDeletion`, `handleTenantRemoval`, and `handleTenantPermanentDeletion` with `httpsCallable` calls; keep current confirmations and messages; remove duplicate client audit writes for operations audited server-side. |
| `firestore.rules` | Modify | Transitional hardening: deny direct privileged writes to `users`, restrict admin tenant lifecycle writes now handled by Functions, and preserve reads plus tenant self contact update. |
| `scripts/verify-privileged-ops-emulator.mjs` | Create | Emulator verification for callable authorization, direct Firestore write denial, audit creation, tenant/user side effects, and compatibility with prior auth authority behavior. |
| `package.json` | Modify | Add a verification script for privileged ops emulator checks. |

No product code is implemented in this design phase.

## Interfaces / Contracts

Callable names should be explicit and narrow. Exact names may be adjusted during tasks, but contracts should stay stable.

```ts
type DeactivateTenantRequest = {
  tenantId: string;
};

type DeleteTenantProfileRequest = {
  tenantId: string;
};

type DeleteUserAccessRequest = {
  userId: string;
};

type PrivilegedMutationResult = {
  ok: true;
  auditLogId?: string;
};
```

### Authorization contract

- Every callable MUST require authenticated canonical authority via `requireRole` or `resolveAuthContext`.
- Tenant lifecycle operations MUST require `admin` or `superadmin` and MUST enforce owner-scope access to the tenant's property.
- Administrative-user lifecycle operations MUST require `superadmin` when the target user is `admin` or `superadmin`.
- No callable MAY trust client-supplied role, ownerScope, email, tenantId, or displayName for target identity beyond IDs used to load canonical documents.
- Self role/status mutation and self deletion MUST remain denied.
- Disabled/inactive actors MUST be denied because `resolveAuthContext` rejects non-active profiles.

### Audit contract

Server-side audit entries should preserve current UI-readable shape:

```ts
type AuditLogWrite = {
  action: string;
  entityType: "user" | "tenant" | "settings" | string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  createdAt: string;
};
```

Preferred actions:

- `user_permissions_updated`
- `user_deleted`
- `tenant_deactivated`
- `tenant_deleted`

### Firestore rules transition contract

Final tightened state after rollout:

```text
/users/{userId}
  read: admin or own user
  create/update/delete: false, except any explicitly documented self-profile field if still needed

/tenants/{tenantId}
  read: current scoped behavior
  create: admin scoped creation may stay only until all create flows use callable, then deny
  update: tenant self contact fields only; privileged lifecycle fields denied to clients
  delete: false

/tenantInvitations/{invitationId}
  read: admin or own invitation
  create/delete: false for clients after invitation/admin flows are callable-backed
  update: only claim-compatible self update remains if slice 2 still needs it; admin revoke/delete goes through Functions
```

During deployment, Functions Admin SDK bypasses these rules, so denial applies only to public clients.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Function lint/build | New callables compile under existing Node 20 TypeScript strict settings. | `npm run lint:functions` / `npm run build:functions` in verification phase. |
| Emulator integration | Authorized admin/superadmin can deactivate/delete tenant/user; unauthorized tenant/disabled/missing-profile/stale-token users are denied. | Add `scripts/verify-privileged-ops-emulator.mjs` and run via Firebase emulator exec. |
| Firestore rules | Direct public-client writes to privileged `users`, tenant lifecycle fields, and invitation admin paths are denied after rules hardening. | Emulator REST or Firebase SDK checks mirroring `verify-auth-authority-emulator.mjs`. |
| Audit | Each successful callable writes exactly one audit entry with server actor context and expected action/entity metadata. | Emulator script reads `auditLogs` after callable success. |
| Frontend smoke | Existing admin buttons still show same confirmations/messages and call Functions instead of direct writes. | Manual emulator smoke plus static grep for removed direct writes around affected handlers. |
| Regression with slices 2 and 3 | Tenant invitation claim and canonical authority/session refresh behavior still work. | Re-run existing `verify:auth-authority`; include tenant invitation fixtures in privileged ops verification if needed. |

## Migration / Rollout

No data migration required.

Rollout should be phased for safety:

1. **Deploy callables first** with server-side audit and side effects, while old direct writes still technically work.
2. **Switch frontend handlers** in `public/app.js` to call the new callables and stop writing duplicate audit entries.
3. **Smoke test admin flows** in emulator and production/staging-equivalent: user permission update, user deletion, tenant deactivation, tenant deletion, and invitation claim compatibility.
4. **Tighten Firestore rules** to deny direct client writes for the privileged paths now covered by callables.
5. **Monitor auditLogs and Function errors** after deployment; rollback by redeploying previous rules/frontend if callables block a critical admin path.

Rollback safety:

- Because no schema migration is required, rollback is deploy-order based.
- If new callables fail before rules tightening, old frontend/rules can still operate.
- If failure appears after rules tightening, temporarily redeploy previous rules while preserving the callable code for debugging.
- Audit writes are append-only; duplicate audit risk is avoided by removing client audit calls once server audit is active.

## Compatibility Notes

- **Slice 2 onboarding compatibility**: keep canonical `tenantInvitations/{email}` behavior and unambiguous legacy compatibility. Admin revoke/delete side effects move server-side but invitation claim semantics stay intact.
- **Slice 3 auth authority compatibility**: all authorization continues to resolve from `users/{uid}`. Custom claims are updated/cleared as projection after user authority changes, disablement, or deletion.
- **Current admin flows**: UI affordances, confirmation wording, success/error messages, `state.users`, `state.tenants`, and existing `onSnapshot` refresh behavior are preserved. Only mutation transport changes.

## Open Questions

- [ ] Confirm whether “eliminar usuario” should delete the Firebase Auth account or only remove app authority in `users/{uid}`. Current frontend deletes only Firestore authority/profile, despite importing `deleteUser` for client self-account deletion.
