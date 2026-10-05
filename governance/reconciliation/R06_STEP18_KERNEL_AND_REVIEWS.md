# R06 — STEP18 v0.29 kernel, agent catalog, STEP19/20 and the final hostile review

## Sources

| Source | How it was read |
|---|---|
| STEP18 `app/catalog.py`, `app/store.py` (head) | Read in full |
| STEP18 `app/main.py` | Endpoint inventory |
| STEP18 `ops/PRODUCTION_GAP_REGISTER.md` | Read |
| STEP18 `contracts/agent_catalog_256.json` | Parsed in full |
| `06_FINAL_HOSTILE_REVIEW/FINAL_HOSTILE_COMMITTEE_VERDICT.md`, `OPEN_ITEM_CLASSIFICATION.md` | Read in full |
| `BLOCKED_RUNTIME_REGISTER_v0_21.csv` | Header plus row count |

## Findings
1. **STEP18 is a contract-driven generic runtime, not the product.**
   - Its `app/` is about 1,700 lines of Python (FastAPI + SQLite).
   - It loads the STEP14–16 JSON contracts and serves 552 generated operations over a single generic `aggregate_records` store, plus about 14 read-only "summary" endpoints.
   - It contains no domain engines. Its own production gap register lists: SQLite only, no RLS, no production IAM/KMS/HA/DR.
   - **Value:** a working prototype of the metadata-driven pattern (F03 dynamic platform). It shows contract → route generation, lifecycle and SoD binding, and a canonical event envelope. It is input for the dynamic-platform design.
   - **Not value:** it is not evidence for the 1,688 requirements that v5 and the forensic report attributed to it. `catalog.py` is 24 lines that load JSON files.
2. **Its own committee rejected the frozen STEP18.**
   - The verdict reads "NOT FIT FOR OWNER APPROVAL / NOT FIT FOR FREEZE / NOT FIT FOR PRODUCTION".
   - 107 aggregates were blocked, accounting double-entry was unproven, and specialist solvers were not implemented.
   - The master status nevertheless records the "OWNER APPROVED / FROZEN STEP18 v0.29" overlay. That freeze is read as a **frozen prototype candidate**, not an approved product capability. No owner decision is needed, but no claim may cite STEP18 as implemented product scope.
   - The double-entry gap it flagged is now closed at runtime in the TypeScript core (R0-4: balanced GL, deferred batch-balance trigger), for the posting sources exercised.
3. **Agent catalog (256 entries).**
   - 86 "family steward" agents, one per family, templated.
   - 170 named specialist archetypes in 20 professional packs: Executive/PMO, Tender, Planning, Technical Office, Engineering (12 disciplines), BIM/CDE, QS, Cost/Finance, Procurement, Site, QA/QC, HSE/Sustainability, Contracts/Legal, Documents/Knowledge, HR, Plant/Materials, Commissioning/FM, Real Estate, Platform/Security, Agent Factory.
   - All 256 entries share 1 authority boundary and 2 execution rules. No skills, tools, inputs, outputs, evals or KPIs are defined.
   - The names are adopted as the **initial digital-workforce roster** (`STEP18_AGENT_ARCHETYPES_256.csv`). Each agent still needs a full manifest (STEP10 78-field contract + STEP_01 §7 definition) and a binding to the Golden Case steps it performs.

## Consequence
- The product core is the TypeScript/PostgreSQL system that has been runtime-proven.
- STEP18 is mined for patterns (metadata runtime, contract compilation, event envelope, SoD/DOA binding) and for its contract JSONs. It is **not** merged as a second backend: two sources of truth would violate v5 rule 1 and STEP_01.
