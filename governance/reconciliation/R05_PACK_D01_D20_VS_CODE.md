# R05 — M01–M11 / D01–D20 pack vs actual v0.2 code

## Method
- Entities were extracted from §4 of every D file: 329 in total (`D01_D20_ENTITIES.csv`).
- A first automated pass scored attribute and column overlap (`D01_D20_ENTITY_VS_SCHEMA.csv`). It was **rejected**: spot checks showed name-match errors of the same kind found in v5 (R03). Examples:
  - `chart_of_accounts`, `retention_ledger` and `cost_codes` were reported absent.
  - WIPSnapshot was matched to `ai_agents`.
- Every entity was then mapped **manually** against the real columns of the 135 tables (`governance/tools/d_entity_map.py` → `D01_D20_ENTITY_COVERAGE_MANUAL.csv`), with a one-line reason per entity. The mapping script checks that the list is complete: 0 unmapped, 0 extra.
- Grades:
  - **R**: table exercised by the R0 runtime chain.
  - **S**: substantive schema, not runtime-exercised.
  - **T**: thin; exists but materially shallower than the spec.
  - **A**: absent.

## Result (data-model level, E1 for R, E3 for S/T/A)
| | R | S | T | A |
|---|---|---|---|---|
| All 329 entities | 27 (8%) | 47 (14%) | 85 (26%) | 170 (52%) |

| Domain | R | S | T | A |
|---|---|---|---|---|
| D01 Foundation | 5 | 1 | 6 | 2 |
| D02 Tendering | 1 | 2 | 3 | 6 |
| D03 BOQ/Estimating | 0 | 1 | 7 | 6 |
| D04 Contracts/Claims | 1 | 4 | 6 | 3 |
| D05 Planning/Controls | 0 | 5 | 3 | 6 |
| D06 Procurement | 9 | 0 | 2 | 4 |
| D07 Subcontracts/IPC | 1 | 2 | 4 | 8 |
| D08 Site/Tech Office | 0 | 5 | 6 | 5 |
| D09 Quality | 0 | 2 | 3 | 11 |
| D10 HSE | 0 | 3 | 5 | 12 |
| D11 Plant/Assets | 0 | 2 | 6 | 9 |
| D12 HR/Payroll | 0 | 4 | 8 | 6 |
| D13 Finance | 6 | 2 | 8 | 4 |
| D14 Inventory | 4 | 0 | 2 | 11 |
| D15 Documents | 0 | 5 | 4 | 8 |
| D16 Design/BIM | 0 | 1 | 1 | 13 |
| D17 Risk/Insurance/Guarantees | 0 | 0 | 0 | 18 |
| D18 Reporting/BI | 0 | 0 | 2 | 10 |
| D19 JV/Consolidation | 0 | 0 | 1 | 18 |
| D20 Platform/Integration/AI | 0 | 8 | 8 | 10 |

The pack also contains **193 Given/When/Then scenarios** and **596 test IDs** (`D01_D20_SCENARIOS.csv`). These are the professional acceptance backlog. None has been executed. R0 tests cover the D06/D13 procurement-finance path only.

## Interpretation
- v0.2 is a **thin transactional skeleton of a construction ERP** with a correct and now runtime-proven procurement-to-GL spine.
- It has **no** engine depth in any of these areas: estimating (no estimate versions, takeoff, price history, productivity, assemblies, UoM), planning (no calendars, WBS, constraints, float, resource loading), quality (ITP and tests), HSE beyond registers, BIM, risk/insurance/guarantees, BI semantic layer, JV/consolidation, versioned company configuration.
- **D-spec quality (independent review):** the D files are professionally sound, domain-specific and consistent with STEP_01 and the STEP09 engine catalog. They are adopted as primary input for design. As the pack itself requires, every rate, factor, threshold or legal item in them stays an *example* until it is sourced (`PENDING EVIDENCE`).
- **Consequence for the plan:** this is not "complete the missing fields". About 78% of the data model needs to be designed and built (A+T), and the existing S tables need deepening. The design must start from the Golden Cases and D scenarios, not from the current tables.

## M01–M11 compliance (process standards)
- **Followed:**
  - M01: evidence grades, no claim without evidence.
  - M02: P0 Runtime Truth done; P1 source integrity in progress; P2 forensic traceability in progress (R01–R05).
  - M04: tenant isolation tests (security).
  - M07: runtime tests, the CI gate on PG 16/17.
  - M09: registers and handoff, being populated now under `governance/registers/`.
- **Not yet:**
  - M02 P3 Benchmark (task 5).
  - M02 P4 Scope freeze, P5 atomic plan: correctly blocked until discovery closes.
  - M05: AI agent governance at runtime.
  - M06: competitive protocol.
  - M08: prompt-slice protocol for coding agents.
  - M10: pilot/UAT.
