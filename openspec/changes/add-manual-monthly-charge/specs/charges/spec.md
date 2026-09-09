# Charges Spec Delta

## ADDED Requirements

### Requirement: Admin manual monthly charge creation
The system SHALL allow admin and superadmin users to create a monthly charge manually for an existing tenant.

#### Scenario: Admin creates manual monthly charge
- GIVEN an authenticated admin or superadmin
- AND an existing tenant with an assigned property
- AND no existing charge for the same tenant and period
- WHEN the admin submits period, due date, amount, and reason
- THEN the system SHALL create a pending charge
- AND the charge total and subtotal SHALL equal the admin-entered amount
- AND the charge SHALL include manual-charge metadata
- AND the system SHALL write an audit log entry

#### Scenario: Duplicate manual charge is rejected
- GIVEN an authenticated admin or superadmin
- AND an existing charge for the same tenant and period
- WHEN the admin tries to create another manual charge for that tenant and period
- THEN the system SHALL reject the request with already-exists

#### Scenario: Tenant cannot create manual charge
- GIVEN an authenticated tenant
- WHEN the tenant attempts to create a manual charge
- THEN the system SHALL reject the request with permission-denied
