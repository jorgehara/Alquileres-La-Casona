# Receipt duplicate and apartment 1 rent correction

## Objective

Prevent tenant transfer retries and duplicate-looking admin receipt links, and align apartment 1's October base rent with the confirmed value of ARS 366,715.

## Scope

- Remove duplicate receipt-link rendering in the admin review card.
- Make transfer submission idempotent for the same tenant and charge, preserving an existing in-review/approved payment instead of creating another.
- Update the department rent regularization constant used for apartment 1/current department defaults and verify the active charge display path.

## Constraints

- Preserve pre-existing uncommitted formatting changes in `public/app.js`.
- Do not operate the VPS in this task.
- Technical artifacts remain in English.

## Tasks

- [x] T1 Add focused regression coverage for duplicate receipt rendering and transfer idempotency behavior.
- [x] T2 Implement admin rendering and backend idempotency fixes.
- [x] T3 Apply October apartment 1 rent configuration and run local validation.

## Acceptance criteria

- One stored receipt produces one admin action link.
- Retrying the same tenant/charge transfer does not create a second payment.
- Apartment 1's October base rent resolves to ARS 366,715 in tenant/open-charge/default paths.
- Existing local changes remain intact.

## Checks

- `npm run build:functions`
- `npm run lint:functions`
- Focused regression checks where runner support exists.

## Progress

- Implemented the admin receipt-link deduplication.
- Added sequential transfer retry protection for the same tenant, charge, and transfer method.
- Updated department regularization rent to ARS 366,715 for the confirmed October value.
- Added 12 focused Node regression checks.
- Verification passed: focused tests, functions build, functions lint, and `git diff --check`.
- Work-unit commit: `126c872` (`fix: prevent duplicate receipt submissions`).
- Native review approved and acknowledged for the candidate; two non-blocking reliability warnings remain informational.

## Next step

- Push/deploy only through the normal user-authorized workflow. Production data is unchanged until the regularization script is explicitly run through the normal deployment/operations process.
