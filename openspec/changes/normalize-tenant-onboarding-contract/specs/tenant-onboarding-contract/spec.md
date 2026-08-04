# Delta for Tenant Onboarding Contract

## ADDED Requirements

### Requirement: Admin-Governed Tenant Invitation

Tenant onboarding MUST be initiated by an admin-managed tenant record and invitation. The system MUST NOT allow tenants to self-claim a property by submitting property type, code, or other ambiguous property identifiers.

#### Scenario: Admin prepares tenant invitation

- GIVEN an admin creates or updates a tenant with a normalized email and assigned property
- WHEN the invitation is prepared
- THEN the tenant record and invitation MUST be marked `pending`
- AND the invitation MUST reference exactly one tenant record

#### Scenario: Tenant cannot self-claim property

- GIVEN a signed-in user has no matching pending invitation
- WHEN the user attempts tenant onboarding with property identifiers
- THEN the system MUST reject the claim
- AND it MUST instruct that an admin must prepare or correct the invitation

### Requirement: Tenant Claim Flow

A signed-in user MAY claim tenant access only when the user's normalized authenticated email matches exactly one pending invitation or compatible legacy email invitation for one active tenant.

#### Scenario: Invited tenant claims access

- GIVEN a pending invitation exists for the user's normalized email
- WHEN the user signs in and claims access
- THEN the system MUST link that user to the referenced tenant
- AND the invitation and tenant onboarding state MUST become `claimed`

#### Scenario: Already claimed tenant signs in again

- GIVEN the user is already linked to a tenant profile
- WHEN the user signs in again
- THEN the system MUST keep the existing link
- AND it MUST NOT create a second tenant profile or invitation

### Requirement: Duplicate Email Handling

The system MUST prevent ambiguous email ownership. A normalized email MUST NOT silently overwrite another pending or claimed tenant invitation, and duplicate active tenant records for the same email MUST require admin resolution before claim.

#### Scenario: Duplicate pending invitation is attempted

- GIVEN a pending or claimed invitation already exists for a normalized email
- WHEN an admin tries to create another invitation for that email
- THEN the system MUST block automatic replacement
- AND it MUST surface the tenant conflict for admin review

#### Scenario: Duplicate active tenants share email

- GIVEN more than one active tenant record matches the user's normalized email
- WHEN the user attempts to claim access
- THEN the system MUST reject the claim as ambiguous
- AND no user profile, custom role, or invitation status MUST be changed

### Requirement: Invitation Status Contract

Tenant onboarding states MUST use `pending` for admin-prepared unclaimed access and `claimed` for successfully linked access. Legacy statuses MAY be displayed or interpreted only when needed for backward compatibility.

#### Scenario: Pending state remains until claim succeeds

- GIVEN an invitation exists but no matching user has completed claim
- WHEN admin or tenant-facing views read onboarding state
- THEN the state MUST remain `pending`

#### Scenario: Failed claim preserves pending state

- GIVEN a pending invitation exists
- WHEN claim validation fails because auth email, tenant status, or duplicates are invalid
- THEN the invitation MUST remain `pending`
- AND the tenant MUST NOT be marked `claimed`

### Requirement: Backward-Compatible Email Invitations

Existing invitation-by-email data MUST remain claimable where it identifies one active tenant unambiguously. Compatibility MUST NOT reintroduce property self-claiming or ambiguous duplicate-email linking.

#### Scenario: Legacy email invitation is claimed

- GIVEN an existing invitation keyed or matched by normalized email references one active tenant
- WHEN the matching authenticated user claims access
- THEN the system MUST accept it as a valid invitation
- AND normalize resulting state to `claimed`

#### Scenario: Legacy data is incomplete or ambiguous

- GIVEN legacy invitation-by-email data is missing tenant reference or conflicts with multiple tenants
- WHEN claim is attempted
- THEN the system MUST reject automatic claim
- AND require admin correction before onboarding can continue
