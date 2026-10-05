# Code Phase 5 — QA/QC + HSE + HR/Payroll + Assets + EDMS Closeout

## Scope Delivered

This package extends the Phase 1A+2+3+4 codebase with operational controls for:

- HR and Payroll
- Attendance and Timesheets
- Payroll run approval and posting hooks
- Assets and Equipment register
- Equipment usage approval and project cost posting
- Maintenance log
- QA/QC inspection checklists
- NCR creation and closure
- HSE incidents, permits to work, and toolbox talks
- EDMS document registers and transmittals

## Backend Modules Added

- `/api/hr`
- `/api/assets`
- `/api/qaqc`
- `/api/hse`
- `/api/edms`

## Services Added

- `postPayrollLineToCostTransaction`
- `postEquipmentUsageToCostTransaction`
- `postPayrollOverheadToGl`

## Consultant Notes

1. The code now uses the Phase 4.1–4.5 tables already present in migration `007_phase4_hr_assets_qaqc_hse.sql`.
2. Payroll lines with project allocation post to `cost_transactions` as actual cost.
3. Payroll overhead lines post directly to GL using `payroll_overhead` rules.
4. Equipment usage posts to `cost_transactions` only after approval.
5. NCR cost impact is recorded but not auto-converted into a variation because that requires a commercial decision and approval workflow.
6. HSE incident records are intentionally factual, status-based, and non-graphic.

## Not Production-Close Items Still Pending

- Automated end-to-end API tests.
- Running all migrations on a clean PostgreSQL instance.
- UI create/edit forms for every register. Current screens are monitoring/control dashboards.
- Detailed ITP templates, HSE risk assessments, and audit schedules as configurable master data.
