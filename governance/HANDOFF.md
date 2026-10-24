# HANDOFF — v0.5.51-stage51 — DATE: 2026-10-24

## Where we are (3 lines)
- Investigation R01–R14 is done; the 38 Golden Cases are decomposed into 167 steps (R13).
- Waves 1–2 are built and runtime-tested (CC-015…CC-024). The RK-003 module sweep has executed variations, QA/HSE, approval rejection paths, HR/payroll and EDMS for the first time (CC-025…CC-029).
- Every change is gated in CI on PG 16/17 with the API running in Africa/Cairo. CI green through CC-036 (run 37816911306); CC-037…045 green; CC-046…049 and CC-051/F-39 green; CC-050 red on PG16 (F-39, test timing, fixed); CC-052…058 green in CI (runs 37937731989 … 38081597944; the first CC-056 commit 21e7366 was red on the money static check, follow-up 1f4a023 green); CC-059 green (run 38083461003), CC-060 green (run 38084547164); CC-061 green (run 38589882954, first CI run with the MFA server and browser check); CC-062 green (run 38592828286); CC-063 green (run 38658876720); CC-064 green (run 38673561339); CC-065 green (verified in every later run, latest 38713172633); CC-066 green (run 38734846921); CC-067 green (run 38738811220); CC-068 green (run 38749436403); CC-069 red in CI (run 38858826704, static check redteam-rev20; fixed by CC-070); CC-070 green (run 38889043485, full gate, covers the CC-069 code); CC-071 green (run 38890807915); CC-072 green (run 38902095470); CC-073 green (run 38915217023); CC-074 green (run 39659224930); CC-075 green (run 39711747184); CC-076 green (run 39771819081); CC-077 green (run 39784708041); CC-078 green (run 39879682501); CC-079 red (run 39884551840: ubuntu-latest moved to 26.04, Playwright could not install Chromium before any test ran) — runner pinned to ubuntu-24.04 by CC-080, green on CC-079's code (run 40119823917); CC-080 green (run 40121318863).

## Done (numbers)
- **Change controls:** CC-001…CC-081 (`DECISION_LEDGER.md`, `registers/10`). Migrations 001–087.
- **Runtime suites, all from zero (E1):** 46 API suites + 7 browser checks (tests/ui, UI_CHECK=1, in CI), 1,735 checks + shared-guard probe + Golden Case status check, all PASS, RUN sh43 ("700" earlier was a records error, F-19; Stage 1 claims 26, Stage 2 technical office 30, Stage 3 assets 27, Stage 4 inventory 21, Stage 5 NDC-002 29, Stage 6 cost/EAC 19, Stage 7 view isolation 10, Stage 8 sessions 20, Stage 9 time for completion 30, Stage 10 inventory controls 37, Stage 11 login throttling 20, Stage 12 risk register 37, Stage 14 report packs 29, Stage 15 commissioning 37, Stage 16 design impact 28, Stage 17 mobilisation 28; chain 92).

  | Suite | Checks | Suite | Checks |
  |---|---|---|---|
  | chain | 85 | hostile concurrency | 17 |
  | isolation | 36 | daily record + change paths | 29 |
  | BOQ handover | 41 | programme + CPM | 25 |
  | vendor master | 41 | variations | 20 |
  | DOA governance | 26 | quality / HSE | 20 |
  | tenant onboarding | 20 | approval rejection | 29 |
  | subcontract IPC | 24 | HR / payroll | 43 |
  | notice engine | 36 | EDMS | 24 |

- **Defects found by first runtime execution in the sweep and fixed (before → after evidence in `takeover/evidence/SW-*`):**
  - **Approvals (CC-027):** a rejected/returned approval left the record stuck under review forever; rejection needed no reason; an issued PO could be resubmitted and reset to approved.
  - **Payroll (CC-028):** every payroll submission crashed (HTTP 500) — payroll could never be approved; lines editable after approval; double pay, negative net, paying terminated staff and another tenant's employee all accepted.
  - **EDMS (CC-029):** every refusal returned HTTP 500; unapproved or superseded drawings could be issued for construction; approved files could be swapped in the DB; no record of who approved which revision.
  - Earlier waves: vendor eligibility, DOA self-confirmation, bootstrap takeover, subcontract certificates, F-13 dates, F-14 period lock, F-15 CPM loops, variations VA1–VA5, QA/HSE QH1–QH4.
- **Golden Case coverage** (`governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv`, 167 steps): RUNTIME 46 · PARTIAL 49 · API 9 · SCHEMA 2 · ABSENT 61.
- **Discovery:** NDC-001…029 (NDC-029 approved-EOT propagation, found in Stage 1) and DFS-001…006.
- **Snapshot delivered:** `MISHEL_SNAPSHOT_v0.5.0-sweep_8feec80.zip` (commit 8feec80, zip SHA-256 5549622f…1439).

## Proven (E1) / UNVERIFIED
- **E1:** everything listed in the suites above, on PG 16.14 locally and in CI on 16/17. Evidence is in `takeover/evidence/W1-*`, `W2-*` and the CI artefacts.
- **UNVERIFIED:**
  - docker-compose runtime;
  - browser UI (the frontend builds, but its behaviour is untested);
  - modules outside the suites (assets/plant, claims, technical office RFIs/submittals/method statements, inventory transfers, portals, dashboards/reports, AI, automation, knowledge);
  - performance, DR, penetration testing.

## Open Issues/Gaps (Critical/Major first)
- **RK-003 remainder:** assets/plant, claims, technical office, inventory transfers — never executed.
- **NDC-002 remainder:** NEC compensation-event register, FIDIC determination/DAAB, claim gating on notices.
- **NDC-011:** accruals and reproducible EAC.
- **G-013:** token revocation.
- **G-009:** D-pack coverage.
- **G-012:** unread archives (owner action).
- **Commercial provisioning (DEC-010):** decided by the owner; needs the owner's plan catalogue and pricing.

## Owner decisions required (decision | options | recommendation | reason)
- **DEC-009, IPC revenue/retention accounting.** DECIDED 2026-10-09 by owner (gross + retention receivable; IPC = billing; revenue over time, cost-to-cost); implementation Stages 28-29.
  - The frozen STEP09 rule that certification is not revenue requires, at minimum, the structure "IPC → receivable/contract balance; revenue from a policy engine".
- **DEC-012 (new), subcontract certificate valuation model and cost/AP posting basis.**
  - Today the system posts the net amount as cost: 18,000 posted for 20,000 gross (F-12).
  - Recommendation: gross-basis cost with a separate retention-payable liability. Decide together with DEC-009.
- **DEC-013 (new), payroll cost basis.** Payroll lines post *net* pay as project labour cost (gross 11,500 − deductions 1,500 → 10,000 posted; F-16). Recommendation: gross pay as cost, deductions to payables; add employer contributions when modelled. Decide with DEC-009/012.
- **DEC-014 (new), inventory valuation method** (F-17): transfers currently carry the source store's average inbound cost as a provisional default only.
- **DEC-010 follow-up:** plan catalogue and pricing for commercial tenant provisioning. These are owner-only values.
- **G-012:** make the three Drive archives readable, either by splitting them into parts under 10 MB or by allowing `drive.usercontent.google.com`.
- **Real values (the platform enforces structure but never invents values):**
  - DOA amount bands for the 30 STEP15 classes (`STEP15_DOA_RULE_CLASSES_30.csv`);
  - chart of accounts and posting rules;
  - contract clause periods per contract form.

## What I objected to and why
- v5 "TRUE FINAL" plan and its name-mapping evidence: rejected (R03).
- Frozen STEP06/18 generic aggregate schemas as a build spec: rejected. CCR18 shows that domain fields and transitions were never authored (R12). We build from Golden Case decomposition plus the proven R0 schema.
- Generic JSON aggregate store from the Render/Supabase bundle as the data model: rejected (R12). It cannot carry the relational invariants proven in R0.

## Next authorized step (owner-controlled staged execution; STOP after each stage and wait for "كمل")
- Stage 1 — GC-16 Claims: **DONE** (CC-030).
- Stage 2 — Technical Office: **DONE** (CC-031).
- Stage 3 — Assets & Equipment: **DONE** (CC-032).
- Stage 4 — Inventory transfers: **DONE** (CC-033; DEC-014 + NDC-030 opened).
- Stage 5 — NDC-002 remainder: **DONE** (CC-034).
- Stage 6 — NDC-011 remainder: **DONE** (CC-035).
- **Next stages (derived from directive, gaps and discovery; owner confirms by "كمل"):**
  - Stage 7 — G-015/G-016 hardening: **DONE** (CC-036; 4 views were leaking at DB level).
  - Stage 8 — G-013 session revocation: **DONE** (CC-037; G-017 login throttling opened).
  - Stage 9 — NDC-029: **DONE** (CC-038; signed-terms defect fixed; F-20/F-21). Was: NDC-029 approved-EOT/CE propagation to time-for-completion, LD exposure and budget (time-for-completion revisions).
  - Stage 10 — NDC-030: **DONE** (CC-039; F-22 direct adjustments, F-23 open items). Was: NDC-030 inventory control workflows (in-transit, stock count, approved adjustments).
  - Stage 11 — G-017: **DONE** (CC-040; DEC-015, G-018 MFA, F-24). Was: G-017 login throttling/lockout mechanism (configurable; values are owner/security policy).
  - Stage 12 — GC-26 + GC-01 s8 risk & opportunity register: **DONE** (CC-041; GC RUNTIME 49 / PARTIAL 52 / ABSENT 56; F-25 stale statuses, F-26 open risk items).
  - Stage 13 — Golden Case status reconciliation: **DONE** (CC-042; RUNTIME 56 / PARTIAL 54 / ABSENT 51 / API 5 / SCHEMA 1; checker in gate).
  - Stage 14 — GC-10 report packs: **DONE** (CC-043; weekly-executive defects fixed; RUNTIME 59 / PARTIAL 54 / ABSENT 48).
  - Stage 15 — GC-20 commissioning-to-handover: **DONE** (CC-044; punch-list defects fixed; RUNTIME 63 / PARTIAL 55 / ABSENT 44).
  - Stage 16 — GC-04 design-revision impact: **DONE** (CC-045; RUNTIME 66 / PARTIAL 54 / ABSENT 42; F-27 fixture gap).
  - Stage 17 — GC-02 mobilisation gate + IPC/unsigned-contract defect + F-27: **DONE** (CC-046; RUNTIME 67 / PARTIAL 54 / ABSENT 41).
  - Stage 18 — Project Controls UI + browser verification: **DONE** (CC-047; F-28 Google Fonts dependency, F-29 partial browser coverage).
  - Stage 19 — UI hardening: **DONE** (CC-048; F-28, F-29 closed; F-30 found and fixed).
  - Stage 20 — GC-12 subcontract advances/back-charges/less-previous + negative-net defect: **DONE** (CC-049; F-31 closed; F-32, F-33 open; RUNTIME 68 / PARTIAL 54 / ABSENT 41 / API 3).
  - Stage 21 — GC-13 client advances/IPC deductions (F-32) + CC-049 cap correction + F-30 page review: **DONE** (CC-050; F-34, F-35 opened).
  - Stage 22 — GC-13 client certification evidence, dispute/resubmission, AR = certified (F-35): **DONE** (CC-051; F-36/F-37/F-38 opened).
  - Stage 23 — Payments & Certification screen + browser check in CI: **DONE** (CC-052; F-38 closed).
  - Stage 24 — contract payment terms → due dates; client certified breakdown (F-36, F-37): **DONE** (CC-053; F-40 opened).
  - Stage 25 — collection/settlement (GC-13 s8 + AP mirror) and F-40 UI: **DONE** (CC-054; F-41 opened).
  - Owner DECIDED DEC-009/012/013/014/015 on 2026-10-09 (register 09). Implementation plan:
  - Stage 26 — DEC-016..019 decided professionally; tax engine (client side): **DONE** (CC-055).
  - Stage 27 — DEC-013 + DEC-014: **DONE** (CC-056; F-43 opened).
  - Stage 28 — DEC-012 core: **DONE** (CC-057; F-42 closed).
  - Stage 29 — DEC-012 remainder + DEC-016/017 supplier side: **DONE** (CC-058; F-33 closed; F-44 found and closed — payments now clear the account their payable was credited to).
  - Stage 30 — DEC-009 part 1: **DONE** (CC-059; F-45/F-46 found and closed; known limitation: released retention stays in the retention GL account until collected).
  - Stage 31 — DEC-009 part 2: **DONE** (CC-060; revenue run; retention reclassification; F-05 closed; F-47 opened).
  - Stage 32 — DEC-015 / G-018: **DONE** (CC-061; MFA API + sign-in screen + admin reset; gate runs a second API server with MFA required). Deployment note: set `MFA_ENCRYPTION_KEY` (own key, ≥32 chars) and keep `MFA_ENFORCEMENT=required` - the API refuses to start in production otherwise.
  - Stage 33 — screens: **DONE** (CC-062; Revenue & Contract Position, Admin MFA state/reset, F-48 closed). Snapshot delivered to the owner before it: MISHEL_ERP_v0.5.32-stage32_131ee74.zip (SHA-256 1a3f4aba…c771).
  - Stage 34 — GC-24 / DEC-019 part 1: **DONE** (CC-063; cut-over plan, opening TB and detail, mandatory reconciliation, SoD approval, opening journal; F-49 opened). The cut-over date itself stays OI-4 (owner, at go-live).
  - Stage 35 — F-49: **DONE** (CC-064; engines continue from opening positions; opening retention release).
  - Stage 36 — F-50: **DONE** (CC-065; Go-live cut-over screen: paste + column mapping + row-level dry-run preview, reconciliation differences, SoD approval, opening retention release; GC-24 step 2 RUNTIME, step 1 PARTIAL - saved/versioned mappings and file profiling remain).
  - **Master plan MP-01…MP-07 approved by the owner (Mishel Thabet Halim, 2026-10-15, approval register A-001):** governance/masterplan/MP-01…MP-07 (organisation, 210 processes, 220 documents, 37 AI agents, engineering engines, UX / dashboards / 26 alerts, gap map and releases R0–R7); inputs OVD-001 (owner vision), OQS-001 (owner quality standard), COMPETITOR_SCAN_001. Every part passed automated checks and two hostile reviews. The approval covers the plan, not a claim that the product is built.
  - Stage 37 — R1.1 bilingual shell: **DONE** (CC-066; translation framework, Arabic default, shell / navigation / sign-in / MFA in both languages; browser check i18n.ui). Product name settled by the owner in Stage 43 (MARC, DEC-020).
  - Stage 38 — R1.2 batch 1: **DONE** (CC-067; per-area dictionaries with build-enforced key parity; shared table / drop-downs, landing dashboard (stale claims and cross-currency sum removed) and Go-live cut-over in both languages; Arabic browser checks). F-51 opened: cut-over shows `#id` for clients / projects when the user may not read them (pre-existing).
  - Stage 39 — R1.2 batch 2: **DONE, approved by the owner (A-002)** (CC-068; Revenue & Contract Position and Payments & Certification in both languages; layout now follows the language — navigation on the right in Arabic — wide tables scroll in their panel instead of covering the navigation, numbers / amounts / dates left-to-right; four layout defects found by the new checks and fixed, one of them a regression caught before commit).
  - Stage 40 — R1.2 batch 3: **DONE** (CC-069; Project Controls and Users / Roles / Permissions / DOA in both languages; 92 stored codes labelled; English server messages isolated in Arabic notices; Logout click workarounds removed now that the layout no longer overlaps). All six browser-checked screens and the shell are now bilingual with Arabic checks.
  - Stage 41 — R1.2 batch 4: **DONE** (CC-070 fixed the CI red on CC-069 — a static check read English Admin labels now in the dictionary; CC-071 commercial screens Projects, CRM, Tendering, BOQ, Contracts, Claims, Subcontracts in both languages; CRM lead creation from the screen fixed — source / project type were free text the API always refused — and the invalid "note" activity removed; dictionary-aware helper for static label checks; new bilingual browser check screens.ui). 14 of 36 page files translated.
  - Stage 42 — R1.2 batch 5: **DONE** (CC-072; Cost Control, Approvals, Inventory, Procurement, Finance in both languages; Finance manual journal creation fixed — the screen sent a reason category the API always refused — Finance tables given labelled columns (the General Ledger had no credit column), Cost Control totals per currency, Approvals errors shown instead of failing silently). 19 of 36 page files translated. Full project copy delivered to the owner (source, full Git history bundle, last gate evidence, SHA-256 manifest).
  - Stage 43 — brand: **DONE** (CC-073; owner decision DEC-020 / approval A-003: brand MARC, descriptor «المنظومة المتكاملة لشركات المقاولات» / Integrated Construction Enterprise System; tab title and default MFA issuer follow; MARC in Latin letters in both languages unless the owner chooses an Arabic spelling).
  - Stage 44 — R1.2 batch 6: **DONE** (CC-074; Technical Office, Planning, Site Execution, QA/QC, HSE, EDMS, HR, Assets in both languages; RFI cost / time impact flags settable from the screen (the contract-event control on closing never applied before), Planning refusals shown and the progress tile labelled as an unweighted average, milestone date / contractual flag, tiles count every row, EDMS transmittal lines follow the transmittal's project, local date instead of UTC date on five screens; screens.ui 114; F-52 open: reference drop-downs do not refresh after a create).
  - Stage 45 — R1.2 batch 7: **DONE** (CC-075; Executive Dashboard, Reports, Runtime Validation, Portals, AI Platform, Automation, Knowledge, Commercial SaaS in both languages; fatalities were not counted as serious incidents in the weekly report or in frozen report packs (code 'fatal' never stored) — fixed in the API and by migration 084; executive financials per project and currency; labelled tables instead of raw JSON / raw fields; screens.ui 212; F-53 open: cost summary and report-pack cost block not split by currency — design with the owner).
  - Stage 46 — DEC-021 part 1: **DONE** (CC-076; owner decision A-004: one currency at the exchange rate of each transaction's date; cost transactions freeze the rate, refused without one, reversal at the original rate; cost reports in the project currency; F-53 closed for cost; F-54 open: ledger / AR / AP / payments / accruals, exchange differences, revaluation, maximum rate age).
  - Stage 47 — DEC-021 part 2a: **DONE** (CC-077; GL lines in the base currency at a frozen rate, exact batch balance without a rounding account, trial balance endpoint and GL base columns; F-54 remaining: realised exchange differences on settlement and period-end revaluation - both need the company's exchange gain / loss accounts in its posting rules - GRN accruals in a foreign currency, open AR / AP in base, maximum rate age).
  - Stage 48 — DEC-022: **DONE** (CC-078; decisions delegated by the owner: separate gain / loss accounts set by the company, period-end revaluation cumulative incl. settlement residues, maximum rate age 7 days (setting), CBE rate with reference - side to confirm with the auditor; F-54 remaining: foreign GRN accruals in cost snapshots, AR / AP lists in base, screens for exchange settings / revaluation).
  - Stage 49 — R1.2 batch 8: **DONE** (CC-079; set-up screen bilingual; server messages translated in the API client - general and common families, the rest F-55; Exchange Rates & Revaluation screen; F-56 open: currencies cannot be added from the application).
  - Stage 50 — R1.2 close-out: **DONE** (CC-080; CI runner pinned to ubuntu-24.04; F-51 cut-over names through one lookup under the finance permission; F-52 drop-down lists refreshed after every change and at sign-in / sign-out; F-55 batch 1: finance API refusals translated, held by a static coverage check).
  - Stage 51 — R1.3 grouped navigation: **DONE** (CC-081; 11 MP-06 groups, items by view permission, folding groups; F-57 five enforced permission modules made grantable on the Roles screen). Not built from MP-06 §3: workspace switcher, global search, home by role.
  - **NEXT:** R1.4 notification centre, R1.5 export / print, R1.6 owner portfolio dashboard v1; F-55 continues one module group per stage. F-47 to be placed by the owner. Open with the owner: optional Arabic spelling of MARC (Latin shown today).
  - Stage 34 — GC-24 legacy import per DEC-019 methodology (opening TB, in-flight contracts/subcontracts cumulative, reconciliation report).
  - Later candidates: GC-24 legacy import; GC-12 advance recovery/back-charges; snapshot ZIP when the owner asks.
  - Gate order note: wave1_boq_handover now runs BEFORE chain.mjs (it configures contract-signing DOA and signers the chain uses).
  - Then: remaining ABSENT Golden Case steps by business priority; frontend browser verification; performance/DR/pentest preparation.
- Afterwards: derive next stages from the Owner Execution Directive, constitution, reconciliation/discovery state (incl. NDC-029, G-013).
- DEC-015 DECIDED (2026-10-09): lockout 5/15/15 adopted; address limit to be enabled per deployment with TRUST_PROXY; MFA mandatory for admin/finance/DOA approvers (Stage 32).
- DEC-009 / DEC-012 / DEC-013 / DEC-014 were DECIDED by the owner on 2026-10-09 (register 09); DEC-009/012/013/014 are implemented (CC-056…060; DEC-009 remainder F-47). (Records correction: this line said "stay OPEN" after the decision.)

## Warnings for next session
- Postgres in this container stops between sessions. Restart with `pg_ctl` (see CURRENT_STATE).
- **Run every static check after any frontend edit.** CC-017's CI went red because a red-team script greps the Admin UI.
- New suites must test SoD with a user who holds *all* permissions. A permission-denied 403 is not SoD evidence.
- Never treat static checks or name-mapping as implementation evidence.
- Shared trigger functions dispatching on TG_TABLE_NAME must not reference another table's columns in one condition (CC-006, CC-028, CC-031, CC-032 — audit the remaining shared guards): PL/pgSQL resolves fields at run time.
- A suite that fails stops `run_from_zero.sh` (set -e); to capture pre-fix evidence for a later suite, temporarily remove earlier new checks.
