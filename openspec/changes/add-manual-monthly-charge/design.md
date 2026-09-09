# Design: Manual Monthly Charge Creation

## Backend
Add callable `createManualCharge` in `functions/src/modules/charges.ts`.

Input:
- `tenantId`
- `period` (`YYYY-MM`)
- `dueDate` (`YYYY-MM-DD`)
- `amount`
- `reason`

Behavior:
- Require admin/superadmin role.
- Verify tenant exists and has a property.
- Verify admin owner-scope access to the property.
- Reject duplicates by tenant + period.
- Create a `charges` document with `status: "pending"`, one rent item, and manual metadata.
- Write an `auditLogs` entry.

## Frontend
Add sidebar section `Cargo manual del mes` for admin users.

The section includes:
- tenant/unit selector
- period input
- due date input
- amount input
- reason textarea

After creation, reload scoped admin data so the charge becomes available for contingency upload.
