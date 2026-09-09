# Payments Spec Delta

## ADDED Requirements

### Requirement: Admin contingency payment override
The system SHALL allow admin and superadmin users to submit a transfer payment in contingency mode for an existing charge.

#### Scenario: Admin submits contingency payment
- GIVEN an authenticated admin or superadmin
- AND an existing charge belonging to the selected tenant
- AND uploaded receipt ids that belong to the selected tenant and are unused
- AND a positive confirmed amount
- AND a valid admin-selected payment date
- AND a non-empty contingency reason
- WHEN the admin submits contingency mode for that charge
- THEN the system SHALL create an approved transfer payment
- AND the payment amountReported and amountConfirmed SHALL equal the admin-confirmed amount
- AND the payment SHALL include contingency metadata
- AND the selected charge SHALL be marked paid
- AND the payment and charge paid/reported date SHALL equal the admin-selected payment date
- AND the selected charge total SHALL be replaced by the admin-confirmed amount
- AND the receipts SHALL be associated to the created payment

#### Scenario: Non-admin cannot submit contingency payment
- GIVEN an authenticated tenant
- WHEN the tenant attempts to submit contingency mode
- THEN the system SHALL reject the request with permission-denied

#### Scenario: Missing reason is rejected
- GIVEN an authenticated admin or superadmin
- WHEN the contingency reason is empty
- THEN the system SHALL reject the request with invalid-argument

### Requirement: Normal payment flow remains unchanged
The system SHALL keep the existing transfer payment validation behavior when contingency mode is not enabled.

#### Scenario: Admin uploads without contingency mode
- GIVEN an admin uses the existing receipt upload form without contingency mode
- WHEN the receipt does not satisfy the existing automatic validation checks
- THEN the system SHALL continue to return the existing blocked validation response
