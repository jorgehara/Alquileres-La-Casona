# Add Manual Monthly Charge Creation

## Problem
Admin contingency payment upload requires an existing charge. When monthly charge generation fails or the system was unavailable, there may be no charge to associate the contingency payment with.

## Scope
Add an admin-only manual charge creation tool.

## Business Rules
- Only admin and superadmin users can create manual charges.
- The admin selects an existing tenant/unit.
- The admin enters the period, due date, amount, and administrative reason.
- The backend rejects duplicate charges for the same tenant and period.
- The created charge starts as pending and can then be used by contingency payment upload.
