# Apply Progress

## Completed
- Added `submitContingencyTransferPayment` callable in `functions/src/modules/payments.ts`.
- Exported the callable from `functions/src/index.ts`.
- Extended the admin receipt upload modal in `public/app.js` with contingency mode controls.
- Added frontend branching: normal mode still calls `submitTransferPayment`; contingency mode calls `submitContingencyTransferPayment`.
- Confirmed `npm run build:functions` passes.

## Notes
- Contingency mode is admin/superadmin-only at the backend.
- Normal tenant/admin non-contingency payment behavior remains routed through the existing function.
