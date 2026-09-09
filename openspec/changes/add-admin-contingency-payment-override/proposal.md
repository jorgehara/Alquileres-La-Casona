# Add Admin Contingency Payment Override

## Problem
Administrators need a controlled way to register a transfer receipt when the normal payment validation flow rejects it because the charge amount has changed after late fees or operational downtime. In these exceptional cases, the admin has already verified the payment and calculated the correct amount externally.

## Scope
Add an admin-only contingency mode to the existing admin receipt upload flow.

When contingency mode is enabled:
- Only admin or superadmin users can submit it.
- The admin selects the existing charge from the current charge selector.
- The admin enters the authoritative confirmed amount.
- The admin selects the payment/receipt date.
- The admin uploads one or more receipt files.
- The admin enters a mandatory contingency reason.
- The backend bypasses automatic amount/destination rejection for this submission only.
- The selected charge total is replaced by the admin-confirmed amount.
- The selected charge is marked paid.
- The payment is created as approved.
- The receipt and payment store contingency metadata for auditability.

## Non-goals
- Do not change the tenant payment flow.
- Do not weaken the normal admin upload flow when contingency mode is off.
- Do not allow tenants to use contingency mode.
- Do not create new charges from month/year input; the admin must select an existing charge.

## Business Rules
- Contingency mode is an explicit exceptional action.
- The admin-confirmed amount is the source of truth for the selected monthly charge.
- The admin-selected payment date is the paid/reported date.
- The action date is the approval/audit date.
- A reason is mandatory because this bypasses normal financial validation.
