# Design: Consolidate Auth Authority

## Technical Approach

Keep the current Firebase Hosting + vanilla JS frontend, Firebase Functions TypeScript, Firestore, Storage, and emulator workflow. No product code is implemented in this phase.

The change consolidates authorization around one canonical profile document, `users/{uid}`, while keeping Auth custom claims as a compatibility and Storage-rule projection. Firestore rules already read `role`, `tenantId`, and `ownerScope` from `users/{uid}`; Functions already prefer `users/{uid}` through `resolveClaims()`; frontend profile loading already fetches `users/{uid}` before rendering. Storage rules are the outlier because they can only see `request.auth.token`, so custom claims remain required there.

Proposal/spec files for `consolidate-auth-authority` were not present in `openspec/changes/` at design time, so this design derives requirements from the requested scope and current code inspection.

## Architecture Decisions

### Decision: `users/{uid}` is the canonical authorization source

**Choice**: Treat `users/{uid}` as source of truth for `role`, `tenantId`, `ownerScope`, and `status`. Functions and Firestore rules MUST resolve authority from the user profile. Custom claims mirror only the minimum fields needed by Storage rules and stale-token detection.

**Alternatives considered**: Make custom claims canonical everywhere; keep current split-brain model; introduce a new `authProfiles/{uid}` collection.

**Rationale**: Custom claims are fast and available to Storage, but stale until token refresh and hard to query/audit. Firestore profiles are mutable, auditable, compatible with existing rules, and already used by `functions/src/lib/auth.ts` and `public/app.js`. A new collection would add migration risk without solving Storage's claim-only limitation.

### Decision: Custom claims are a derived projection, not a fallback authority

**Choice**: Functions write custom claims after profile writes using values derived from the canonical profile. Runtime authorization in Functions should not silently authorize from claims when an active `users/{uid}` profile is missing, except for explicit bootstrap/claim flows that create the profile.

**Alternatives considered**: Preserve `resolveClaims()` fallback to token claims for all callables; remove custom claims entirely.

**Rationale**: Fallback claims can keep deleted/deactivated users authorized until token expiry. Removing claims breaks `storage.rules`, which cannot read Firestore. Narrow exceptions keep tenant claiming and bootstrap possible without accepting stale claims as general authority.

### Decision: Storage uses claims with freshness guardrails

**Choice**: Storage rules continue using `request.auth.token.role` and `request.auth.token.tenantId`. Claims should include mirrored authorization fields and a small freshness/version marker such as `authVersion` or `claimsUpdatedAt` if implementation chooses version checks. Rollout should initially validate parity before enforcing freshness.

**Alternatives considered**: Move every Storage access behind signed download/upload Functions; duplicate profile data in Storage metadata.

**Rationale**: Storage rules cannot call Firestore. Function-mediated file access is stronger but larger scope and changes product flows. Mirrored claims keep current UX while making the limitation explicit and testable.

### Decision: Frontend renders only after profile/session parity is known

**Choice**: `loadUserProfile()` should load `users/{uid}` as canonical, compare token claims against profile fields, force `getIdToken(true)` when claims are missing/stale, then continue from profile authority. UI role and owner scope should come from `state.profile`, not from claims except during refresh diagnostics.

**Alternatives considered**: Keep fallback `state.profile.role ?? state.authClaims?.role`; rely on user re-login after role changes.

**Rationale**: Current fallback can render UI from stale claims if profile data is missing or incomplete. Forced refresh after `setCustomUserClaims()` is already used after tenant claim and bootstrap; formalizing it reduces intermittent permission-denied failures.

### Decision: Preserve current data compatibility during rollout

**Choice**: Support existing user documents with `role`, optional `tenantId`, optional `ownerScope`, and `status`. Normalize missing admin `ownerScope` to `all`, require tenant `tenantId`, and preserve `superadmin` as all-scope. Existing tenant invitation/onboarding compatibility stays out of this slice except where it creates or refreshes profile/claims parity.

**Alternatives considered**: Big-bang backfill of every user and immediate rules tightening; block login for profiles missing optional fields.

**Rationale**: Existing production data likely includes mixed historical fields from tenant onboarding and admin creation. Compatibility-first rollout prevents lockouts while making invalid states observable.

## Data Flow

### Canonical profile creation/update

```text
Admin/tenant/bootstrap callable
  └─ validate operation-specific permissions
     └─ write users/{uid} canonical profile
        ├─ role: "superadmin" | "admin" | "tenant"
        ├─ tenantId: required only for tenant
        ├─ ownerScope: "all" | "enzo" | "ivo" for admins; superadmin => "all"
        └─ status: "active" | inactive-compatible values
           └─ set custom claims from canonical profile projection
              └─ frontend forces token refresh when current user is affected
```

### Callable authorization

```text
Callable request
  └─ request.auth.uid
     └─ users/{uid}
        ├─ missing profile => deny, except bootstrap/claim profile-creation flows
        ├─ status != active => deny
        └─ role/tenantId/ownerScope => AuthContext returned to modules
```

### Firestore rules authorization

```text
Firestore request
  └─ request.auth.uid
     └─ users/{uid}
        ├─ userRole()
        ├─ tenantId()
        └─ adminOwnerScope()
           └─ collection rules enforce tenant self-access and owner-scope access
```

### Storage rules authorization

```text
Storage request
  └─ request.auth.token
     ├─ role / tenantId / ownerScope projection
     └─ optional authVersion / claimsUpdatedAt freshness marker
        └─ storage path rules keep current behavior until stronger file gateway exists
```

### Frontend session loading

```text
onAuthStateChanged
  └─ loadUserProfile(uid)
     ├─ getIdTokenResult(false)
     ├─ get users/{uid}
     ├─ if no profile: try claim/bootstrap eligibility flow
     ├─ if profile active but claims missing/stale: getIdToken(true), re-read token result
     └─ state.profile drives role, tenantId, ownerScope, subscriptions, and shell rendering
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `functions/src/types.ts` | Modify | Add/clarify canonical auth profile/context types for role, tenantId, ownerScope, status, and optional auth version/freshness metadata. |
| `functions/src/lib/auth.ts` | Modify | Make profile-backed authorization explicit; separate raw token projection, canonical profile resolution, active-status validation, tenant/admin/scope assertions, and claim projection helpers. |
| `functions/src/modules/tenants.ts` | Modify | Route tenant claim, admin creation, linked tenant updates, and bootstrap through shared profile + claims projection helpers; preserve current callable names. |
| `functions/src/modules/adminData.ts` | Modify | Continue relying on `requireRole()` but consume normalized owner scope from canonical auth context. |
| `functions/src/modules/downloads.ts` | Modify | Continue relying on `requireRole()` but avoid direct assumptions about claim fallback. |
| `functions/src/modules/documents.ts` | Modify | Keep tenant/admin file callable checks aligned with canonical auth context. |
| `functions/src/modules/notifications.ts` | Modify | Keep owner-scope access checks aligned with canonical auth context. |
| `functions/src/modules/audit.ts` | Modify | Record actor role/scope from canonical auth context when available, not token-only data. |
| `firestore.rules` | Modify | Keep `users/{uid}` as authority; add explicit active-profile helper and normalize `ownerScope` defaults consistently with Functions. |
| `storage.rules` | Modify | Document and enforce mirrored-claims contract; optionally add freshness/version checks after parity rollout. |
| `public/app.js` | Modify | Make profile data canonical for UI/session state; detect stale/missing claims and force token refresh before Storage-dependent flows. |
| `docs/modelo-datos.md` | Modify | Document canonical `users/{uid}` auth profile and custom-claim projection. |
| `docs/local-tenant-emulator-flow.md` | Modify | Add emulator scenarios for stale claims, profile updates, Firestore/Storage parity, tenant claim, and admin scope. |

## Interfaces / Contracts

### Canonical Firestore profile

```ts
type AppRole = "superadmin" | "admin" | "tenant";
type OwnerScope = "all" | "enzo" | "ivo";

type UserAuthProfile = {
  role: AppRole;
  status: "active" | "inactive" | "disabled";
  email?: string;
  displayName?: string;
  tenantId?: string;      // required when role === "tenant"
  ownerScope?: OwnerScope; // admin: all/enzo/ivo; superadmin normalized to all
  authVersion?: number;   // optional rollout/freshness marker
  claimsUpdatedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};
```

Validation rules:

- `superadmin`: effective `ownerScope` is always `all`; `tenantId` ignored/absent.
- `admin`: effective `ownerScope` is `profile.ownerScope ?? "all"` and MUST be one of `all | enzo | ivo`.
- `tenant`: `tenantId` MUST be present and match tenant-owned data; `ownerScope` is not authoritative.
- non-`active` profiles MUST be denied by Functions and Firestore rules.
- missing profile MUST be denied except in explicit profile-creation flows: tenant claim and initial admin bootstrap.

### Custom claims projection

```ts
type AuthClaimsProjection = {
  role: AppRole;
  tenantId?: string;
  ownerScope?: OwnerScope;
  authVersion?: number;
  claimsUpdatedAt?: string;
};
```

Projection rules:

- Claims are written from canonical `users/{uid}` values, never independently composed in each callable.
- Tenant claims include `{ role: "tenant", tenantId }`.
- Admin claims include `{ role: "admin", ownerScope }`.
- Superadmin claims include `{ role: "superadmin", ownerScope: "all" }` for parity, even if current code only writes role.
- Claims should be cleared or replaced with a non-authorized projection when a profile is disabled/deleted, where current flows support that safely.

### Function helper contract

```ts
type AuthContext = {
  uid: string;
  role: AppRole;
  tenantId?: string;
  ownerScope: OwnerScope;
  profile: UserAuthProfile;
};

async function resolveAuthContext(request: CallableRequest): Promise<AuthContext>;
async function requireRole(request: CallableRequest, allowed: AppRole[]): Promise<AuthContext>;
function claimsFromProfile(profile: UserAuthProfile): AuthClaimsProjection;
```

`resolveAuthContext()` should be the only general-purpose authority resolver. A separate narrowly named helper may read token claims for Storage parity diagnostics, but not for permission decisions.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit / TypeScript | Profile normalization, `claimsFromProfile()`, `resolveAuthContext()` denial for missing/inactive/invalid profile, tenant `tenantId` requirement, admin owner-scope default | Add focused Functions tests if test harness exists; otherwise validate through TypeScript build/lint and callable emulator scripts. |
| Firestore rules | `users/{uid}` role/status/tenantId/ownerScope governs reads/writes; stale token with changed profile does not override Firestore denial; inactive user denied | Firebase emulator rules scenarios seeded with user/profile docs. |
| Storage rules | Claim-projected tenant can read only own `rent-receipts/{tenantId}`; admin/superadmin claim can access admin file paths; stale claims are documented and optionally blocked by version check after rollout | Firebase Storage emulator scenarios. |
| Frontend session | `loadUserProfile()` uses profile as authority, forces token refresh on stale/missing claims, renders owner scope from profile, and handles pending access/claim/bootstrap paths | Manual emulator smoke in vanilla SPA because no frontend test suite is present. |
| Regression | Existing admin users missing `ownerScope`, existing superadmin claims with only `role`, existing tenants with `tenantId`, and legacy tenant claim flows keep working | Seed current-compatible data in emulator and run login/callable/rules smoke paths. |

## Migration / Rollout

No big-bang migration required.

1. **Observe and normalize in Functions**: introduce shared profile/auth helper behavior while preserving callable names. Log or return diagnostics for missing profile, inactive profile, missing tenantId, and claim/profile mismatch.
2. **Write canonical profile first**: update tenant claim, admin creation, linked tenant update, and bootstrap paths so `users/{uid}` is written before custom claims are projected.
3. **Frontend refresh safety**: update `loadUserProfile()` to force `getIdToken(true)` when profile exists but claims are missing or differ in `role`, `tenantId`, `ownerScope`, or optional `authVersion`.
4. **Rules parity**: keep Firestore profile authority; align active-status and owner-scope defaults with Functions. Keep Storage on claims but document projection requirement.
5. **Backfill optional fields**: optionally backfill `ownerScope: "all"` for superadmin/admin profiles missing it and claims for active users. This can be done lazily through login/admin updates or via an explicit admin script later.
6. **Tighten fallback**: after parity is verified, remove general Functions fallback from missing `users/{uid}` to token claims. Keep only named bootstrap/claim exceptions.

Rollback plan:

- Preserve existing callable names and document fields.
- Do not tighten Storage freshness checks until claims refresh behavior is verified.
- Keep Firestore's `users/{uid}` authority model because it is already current behavior.
- If frontend refresh causes login loops, revert to profile-only rendering while retaining server-side profile authority.

## Tradeoffs

- **Custom claims vs `users/{uid}`**: claims are required for Storage and reduce reads, but stale and hard to audit. `users/{uid}` is auditable and already used by Firestore/Functions/frontend, but unavailable to Storage. Design chooses profile canonical + claims projection.
- **Rollout safety vs immediate strictness**: immediate removal of token fallback reduces risk from stale claims but can lock out historical users. Design phases strictness after parity and compatibility checks.
- **Freshness marker vs forced refresh only**: `getIdToken(true)` handles current-user updates, but not all stale sessions instantly. Version/freshness claims can improve detection, but require extra writes/backfill and Storage cannot compare against Firestore unless expected version is encoded in path/metadata or mediated by Functions.
- **Current data compatibility vs clean schema**: allowing missing `ownerScope` default to `all` preserves access but may over-broaden old admin profiles. Tight migration would be cleaner but riskier without a confirmed production dataset.

## Open Questions

- [ ] Should implementation add `authVersion` now, or keep versioning as a later hardening step after profile/claims parity is stable?
- [ ] Should stale Storage access be accepted until token expiry, or should sensitive Storage operations move behind callable/signed URL gateways in a later change?
