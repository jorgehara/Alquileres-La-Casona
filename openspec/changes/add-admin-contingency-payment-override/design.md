# Design: Admin Contingency Payment Override

## Backend
Add a new callable function in `functions/src/modules/payments.ts`:

`submitContingencyTransferPayment`

Input:
- `tenantId: string`
- `chargeId: string`
- `amountConfirmed: number`
- `receiptIds: string[]`
- `contingencyPaidAt: string`
- `contingencyReason: string`

Authorization:
- Require role `admin` or `superadmin`.
- Verify the charge exists.
- Verify the charge belongs to the tenant.
- Verify the admin has owner-scope access to the charge property.

Behavior:
- Validate all receipts exist, belong to the tenant, and are unused.
- Optionally analyze receipts for metadata, but do not block on amount/destination mismatch.
- Create a `payments` document with `status: "approved"`, `method: "transfer"`, `amountReported` and `amountConfirmed` set to the admin-confirmed amount.
- Store the admin-selected payment date as `reportedPaidAt` on the payment and `paidAt`/`reportedPaidAt` on the charge.
- Store `contingencyMode: true`, `validationStatus: "admin_contingency_override"`, and `contingencyReason`.
- Update receipt documents with the payment id and contingency metadata.
- Update the selected charge as paid and replace `total` with the admin-confirmed amount.
- Add an `auditLogs` document from the backend.

## Frontend
Extend the existing admin receipt upload modal in `public/app.js`:

- Add a `Modo contingencia` checkbox.
- Add a payment/receipt date input required when contingency mode is enabled.
- Add a mandatory reason textarea displayed/required when the checkbox is enabled.
- If unchecked, keep calling `submitTransferPayment` exactly as today.
- If checked, call `submitContingencyTransferPayment` with `amountConfirmed` and `contingencyReason`.
- Show clear copy that contingency mode bypasses automatic validation and uses the entered amount as source of truth.

## Data Notes
Use existing collections:
- `payments`
- `paymentReceipts`
- `charges`
- `auditLogs`

No schema migration is required because Firestore documents are schemaless.
