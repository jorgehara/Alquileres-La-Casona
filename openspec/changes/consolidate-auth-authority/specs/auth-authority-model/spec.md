# Delta for Auth Authority Model

## ADDED Requirements

### Requirement: Canonical Authority Source

The system MUST use a single canonical authority model for `role`, `tenantId`, and `ownerScope`. Backend Functions, Firestore rules, Storage rules, and frontend session state SHALL evaluate equivalent authority for the same user; no layer MAY grant broader access from stale custom claims or client-supplied profile data.

Acceptance notes:

- `users/{uid}` is the canonical source for Functions, Firestore rules, and frontend session/profile state.
- Custom claims are a derived projection for Auth token compatibility and Firebase Storage rules, not an independent authority source.
- Privileged Functions and Firestore reads MUST evaluate current `users/{uid}` data and MUST NOT authorize from token-only role data when profile authority is missing, disabled, or narrower than the token.

#### Scenario: Function resolves authority consistently

- GIVEN an authenticated user has canonical authority fields
- WHEN a callable Function authorizes role, tenant, or owner-scoped access
- THEN it MUST authorize from the canonical authority model
- AND it MUST NOT trust request body, local session cache, or stale token-only fields for escalation

#### Scenario: Rules match Function authority

- GIVEN the same authenticated user reads or writes Firestore or Storage
- WHEN Firestore rules and Storage rules evaluate access
- THEN they MUST enforce the same role, `tenantId`, and `ownerScope` boundaries as Functions
- AND access MUST be denied if required authority cannot be proven

### Requirement: Role, Tenant, and Owner Scope Boundaries

The system MUST define explicit meanings for roles and scopes. Tenant access MUST be constrained to the claimed `tenantId`. Owner access MUST be constrained by `ownerScope`; empty or missing owner scope MUST NOT imply global owner access. Admin access MAY bypass tenant or owner scope only for documented administrative operations.

Role/scope matrix:

| Case | Canonical profile | Expected authority |
|------|-------------------|--------------------|
| Superadmin | `role: superadmin`, effective `ownerScope: all` | Administrative access across all owner scopes. |
| Admin Enzo | `role: admin`, `ownerScope: enzo` | Administrative access only to Enzo-scoped data unless endpoint is explicitly global. |
| Admin Ivo | `role: admin`, `ownerScope: ivo` | Administrative access only to Ivo-scoped data unless endpoint is explicitly global. |
| Admin All | `role: admin`, `ownerScope: all` | Administrative access across owner scopes. |
| Tenant | `role: tenant`, required `tenantId` | Access only to that tenant's data and tenant-permitted operations. |
| Disabled profile | `status` not `active` | Denied in Functions and rules; claims must be cleared or ignored. |
| Missing profile | no `users/{uid}` profile | Denied except named bootstrap/tenant-claim profile creation flows. |
| Unauthenticated | no Auth session | Denied. |

#### Scenario: Tenant accesses own tenant data

- GIVEN a user has role `tenant` and canonical `tenantId` `T1`
- WHEN the user accesses tenant-scoped data for `T1`
- THEN the system MUST allow only operations permitted for tenants

#### Scenario: Owner lacks matching owner scope

- GIVEN a user has role `owner` without matching `ownerScope`
- WHEN the user accesses owner-scoped data
- THEN the system MUST deny access
- AND it MUST NOT fall back to client-side filtering as authorization

### Requirement: Stale Token Handling

The system MUST detect stale or incomplete tokens whenever token claims disagree with canonical authority or omit required fields. Functions SHOULD return a refresh-required response for recoverable stale sessions; rules MUST fail closed when authority cannot be validated.

Browser/session verification notes:

- After role, scope, status, or tenant assignment changes, active tabs MUST reconcile the ID token against `users/{uid}` before showing admin or tenant UI.
- If profile and token authority disagree after a forced token refresh, the frontend MUST clear privileged UI state and route to a refresh/sign-in or access-denied path.
- Storage access MAY still depend on the current token projection because Storage rules cannot read Firestore profiles; writers MUST keep claims projected from `users/{uid}` and users MUST refresh tokens after authority changes.

#### Scenario: Token omits updated authority

- GIVEN canonical authority was updated after the user's token was issued
- WHEN the frontend or Function detects missing or mismatched authority
- THEN the user MUST be prompted to refresh authentication before retrying privileged actions
- AND the action MUST NOT partially succeed using stale authority

#### Scenario: Rules encounter stale authority

- GIVEN rules cannot verify required role, `tenantId`, or `ownerScope`
- WHEN the user attempts Firestore or Storage access
- THEN the request MUST be denied
- AND the frontend SHOULD translate denial into a session refresh or access-denied path

### Requirement: Denied Access Behavior

The system MUST present denied access as an authorization outcome, not as missing data or silent UI failure. Frontend session handling SHALL clear privileged UI affordances when authority is absent, stale, or denied.

#### Scenario: Unauthorized operation is denied

- GIVEN a signed-in user lacks required authority
- WHEN the user attempts a protected operation
- THEN Functions, Firestore rules, or Storage rules MUST reject it
- AND the frontend MUST show an access-denied or reauthentication message without exposing protected data

### Requirement: Slice 2 Onboarding Compatibility

The authority model MUST preserve the slice 2 onboarding contract: tenant authority is granted only after an admin-governed invitation or compatible unambiguous legacy email invitation is claimed. Compatibility MUST NOT reintroduce tenant self-claiming or duplicate-email ambiguity.

#### Scenario: Claimed tenant receives authority

- GIVEN a tenant successfully claims access through the normalized onboarding contract
- WHEN authority is established for that user
- THEN canonical authority MUST include the linked `tenantId` and tenant role
- AND Functions, rules, and frontend session state MUST converge on that authority after token refresh if needed

#### Scenario: Ambiguous legacy invitation remains denied

- GIVEN legacy onboarding data maps one email to multiple active tenants or conflicting grants
- WHEN authority is requested
- THEN the system MUST deny automatic authority creation
- AND it MUST require admin correction before access can be granted
