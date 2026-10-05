# End-to-End Runtime Test Cycle — REV-C

This file defines the professional acceptance cycle for the current ERP package.

## Test Cycle

1. Create/confirm organization and base currency.
2. Bootstrap first System Admin.
3. Login and confirm JWT token.
4. Create project.
5. Confirm BOQ and cost code visibility.
6. Create procurement record chain:
   - Material Requisition
   - RFQ
   - Vendor Quotation
   - Comparative Statement
   - Purchase Order
7. Approve PO.
8. Confirm committed cost transaction exists.
9. Create vendor invoice.
10. Approve vendor invoice.
11. Confirm actual cost transaction exists.
12. Post cost transaction to GL.
13. Create IPC.
14. Approve/post IPC to AR and GL.
15. Create payment.
16. Post payment to GL.
17. Confirm reports and dashboards read from posted data.

## Acceptance Criteria

- No route returns unauthorized access for System Admin.
- No approval action accepts `approver_id` from request body.
- No direct insert/update/delete is allowed on `cost_transactions` outside posting services.
- Committed cost is created only from approved PO.
- Actual cost is created only from approved vendor invoice or approved internal posting source.
- GL posting is balanced for every journal batch.
- Runtime Validation screen returns `passed` for schema-health.

## Current Status

Prepared, not fully executed in this chat environment because dependency installation and clean database boot must be run in the target runtime.
