# Delta for Privileged Tenant/User Operations

## ADDED Requirements

### Requirement: Backend-Owned Privileged Mutations

Privileged tenant and user mutations MUST be owned by callable/backend operations. The frontend MUST NOT directly create, update, or delete audit-sensitive documents for these operations, except for non-authority user self-service fields explicitly allowed by rules.

#### Scenario: Frontend submits privileged intent

- GIVEN an authorized admin uses the existing UI
- WHEN they create, update, deactivate, delete, revoke, resend, or change access
- THEN the frontend MUST call a backend-owned operation with intent data
- AND it MUST NOT directly write affected tenant, invitation, user, property-link, claim, or audit state

#### Scenario: Direct client write is attempted

- GIVEN a browser client attempts a privileged direct Firestore write
- WHEN rules evaluate the request
- THEN the write MUST be denied
- AND no partial authority, invitation, or audit-sensitive state MUST change

### Requirement: Tenant Admin Profile Mutation Ownership

Tenant admin profile creation, update, deactivation, and permanent removal MUST be validated and committed server-side as one authorized operation, preserving existing UX semantics where practical.

#### Scenario: Tenant profile is created or updated

- GIVEN an admin has authority for the target owner scope
- WHEN they save tenant profile, property assignment, rent configuration, or email changes
- THEN the backend MUST validate occupancy, duplicate-email, scope, and onboarding constraints
- AND it MUST commit tenant, property-link, invitation, linked-user, and open-charge side effects consistently

#### Scenario: Tenant is removed

- GIVEN an admin confirms soft removal or permanent deletion
- WHEN the backend processes the request
- THEN it MUST apply the same visible outcome as today
- AND related invitation, linked-user, property-link, and audit-sensitive state MUST be handled atomically or fail without partial writes

### Requirement: Invitation Revoke and Resend State Ownership

Invitation revoke/resend state changes MUST be performed by backend-owned operations that enforce the tenant onboarding contract.

#### Scenario: Invitation is revoked

- GIVEN an admin revokes tenant access
- WHEN the backend accepts the request
- THEN the invitation MUST become non-claimable
- AND linked tenant/user access MUST be deactivated or preserved according to the selected UX action

#### Scenario: Invitation is resent

- GIVEN a pending or compatible invitation exists
- WHEN an admin resends it
- THEN the backend MUST refresh delivery metadata without creating duplicate active invitations
- AND claimed or revoked invitations MUST NOT become claimable unless an explicit authorized reactivation action is requested

### Requirement: User Role and Status Mutation Ownership

User role, owner-scope, tenant assignment, and status changes MUST be committed by backend-owned operations that keep canonical profile authority and derived claims consistent.

#### Scenario: Admin changes another user's access

- GIVEN an admin is allowed to manage the target user
- WHEN role, owner scope, or status changes
- THEN the backend MUST update canonical profile authority and derived claims consistently
- AND the frontend MUST preserve current success/error UX and refresh affected session state when practical

#### Scenario: Unsafe access change is requested

- GIVEN the actor targets self-escalation, invalid role/scope, tenant demotion without tenant authority, or unauthorized scope
- WHEN the backend validates the request
- THEN it MUST reject the mutation
- AND no profile, claim, tenant, invitation, or audit state MUST change

### Requirement: Server-Side Audit-Sensitive Writes

Audit-sensitive writes for privileged tenant/user operations MUST be created by the backend from authenticated actor context and committed with the business mutation when possible.

#### Scenario: Privileged mutation succeeds

- GIVEN a backend-owned privileged mutation completes
- WHEN audit data is recorded
- THEN audit records MUST include actor, target entity, action, and before/after-sensitive metadata where appropriate
- AND the client MUST NOT be trusted as source of actor or authority metadata

#### Scenario: Mutation fails validation

- GIVEN a privileged mutation is rejected before commit
- WHEN the backend returns an error
- THEN no success audit entry MUST be written
- AND the frontend SHOULD show the existing equivalent error or cancellation message
