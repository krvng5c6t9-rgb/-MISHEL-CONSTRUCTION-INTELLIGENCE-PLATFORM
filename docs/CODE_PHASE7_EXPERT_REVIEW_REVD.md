# Code Phase 7 Expert Review — REV-D

## Consultant Decision

REV-C is not accepted as final review baseline because static schema-to-code review found backend SQL references to columns that do not exist in the migrations.

REV-D repairs those mismatches and becomes the current approved package for the next runtime step.

## Critical Findings Repaired

| Area | REV-C issue | REV-D correction | Impact avoided |
|---|---|---|---|
| Finance IPC list | `contracts.contract_no` did not exist | Generated `contract_ref` from `contracts.id` | Runtime SQL failure |
| Finance AP list | `vendors_subcontractors.legal_name` did not exist | Used `vendor_name` | Runtime SQL failure |
| Executive dashboard | `schedule_activities.status` and `finish_date` did not exist | Used `percent_complete` and `planned_finish` | Runtime SQL failure |
| Portals | `subcontracts.subcontract_no` did not exist | Generated `subcontract_ref` | Runtime SQL failure |
| Portals | `subcontract_certificates.net_amount` did not exist | Used `net_amount_due` | Wrong/failed subcontractor dashboard |
| Portals | `site_instructions.vendor_id` did not exist | Joined by subcontract project | Runtime SQL failure |
| Assets/HR | `cost_codes.cost_code` did not exist | Used `cost_codes.code as cost_code` | Runtime SQL failure |
| QA/QC/HR | `schedule_activities.activity_code` did not exist | Used `activity_id_ext as activity_code` | Runtime SQL failure |
| Root scripts | README referenced `install:all` but package script was missing | Added `install:all` | Runbook failure |

## Static Review Result

- File structure: acceptable.
- Backend modules: broad coverage exists.
- Frontend pages: broad coverage exists.
- Permission consistency script: passed before REV-D and remains structurally aligned.
- Remaining hold point: dependency installation/build and clean PostgreSQL migration execution must be performed in runtime environment.

## Professional Status

REV-D is suitable to proceed to final runtime execution/testing. It is not yet production-approved.
