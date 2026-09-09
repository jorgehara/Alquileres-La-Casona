# Tasks

## Review Workload Forecast
- Estimated changed lines: 220-320
- 400-line budget risk: Medium
- Chained PRs recommended: No
- Decision needed before apply: No

## Implementation
- [x] Add `submitContingencyTransferPayment` backend callable.
- [x] Export the new callable from `functions/src/index.ts`.
- [x] Extend the admin receipt upload modal with contingency controls.
- [x] Add admin-only sidebar section for contingency mode entry.
- [x] Branch frontend submission behavior between normal and contingency modes.
- [x] Add admin-selected payment date for contingency submissions.
- [x] Keep normal flow unchanged when contingency mode is off.

## Validation
- [x] Run `npm run build:functions`.
- [x] Run available lint/validation if build succeeds.
- [x] Manually inspect the admin upload flow wiring.
