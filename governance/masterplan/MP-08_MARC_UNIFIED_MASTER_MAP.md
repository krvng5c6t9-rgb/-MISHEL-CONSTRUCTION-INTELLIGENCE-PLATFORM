# MP-08 — MARC unified master map (owner plan "NEXORA ONE" reviewed and merged) — 2026-11-26

Product name: **MARC** (owner decision 2026-11-26). Inputs: OVD-001, OVD-002, OVD-003; the owner's plan package
`nexora.zip` (SHA-256 1f27b0be9aa4d672f2022585a625dece2db4147858aa2f40414632eaae866fb2, owner-supplied, approved source),
reference copies in `governance/sources/nexora/`; the MARC code and gate as of CC-099 (RUN sh96, 2,272 checks, 0 FAIL;
CI green). Owner instruction: "the most correct, complete and best according to the hard reviews and committees - do it".
This document is the plan of record. It extends MP-01…MP-07; MP-07 §3 releases are re-sequenced by §6 below.

## 1. What the owner's plan contains (read, measured)
| Part | Content | Measured status in the package itself |
|---|---|---|
| Program list | `ORIGINAL_451_SOURCE_ORDER.csv`: 451 entries in 16 categories, each with role, sources, integration route, licence status | 451 rows, **437 distinct names** (14 names repeated across categories, 2 marked as aliases); every row "RETAIN_FOR_FULL_FEATURE_RESEARCH", "NOT_TESTED", licence "ASSUMED_AVAILABLE_NOT_VALIDATED" |
| Organisation | 14 divisions, 634 roles (General Assembly … database administrator), one candidate AI agent profile per role | role IDs are candidates, not permissions (package's own note) |
| Data model | 175 tables in 4 schemas (`nx_design` 28, `nx_org` 43, `nx_market` 103, `nx_auth` 1) | "proposed transactional data model, not executable business engines"; checked by a template checker and SQLite, not by PostgreSQL; RLS placeholders untested |
| Market gaps | G01–G20 with priorities | "domain workflow and negative fixtures still required" for each |
| Program rounds | contracts / schemas / fixtures for programs 1–145 (R23–R27) | "blueprint delivery only; no production certification"; R25 summary missing from the package |

Conclusion of the review: the owner's plan is strong in **breadth** (programs, divisions, roles, market gaps); MARC is
strong in **executed, tested depth** (104 migrations, 46 screens, 66 suites). They are merged, not replaced: MARC's
proven engine stays; the plan's breadth becomes MARC's scope, catalogue and roadmap.

## 2. Decisions taken (head of the development committee, under OVD-003 §1)
| # | Decision | Reason |
|---|---|---|
| D1 | Keep MARC's stack: PostgreSQL 16 with forced RLS, Node/TypeScript API, React/Vite, database-enforced rules, the from-zero gate | proven by 2,272 checks and CI; rewriting would lose tested behaviour |
| D2 | Do **not** import the 175-table DDL wholesale. Each proposed table is mapped to an existing MARC table, merged into one, or built as part of its gap (G-item) with its invariants and tests | the DDL is untested and overlaps MARC (e.g. journal, invoice, RFI, punch, FX already exist with guards) |
| D3 | The 634-role catalogue and 14 divisions become a **role template library**: a company adopts, renames or removes roles; MARC permissions and DOA stay the source of authority | product sold to many companies; roles differ per company; nothing assumed |
| D4 | One AI agent profile per division first (14), then per role family, on the existing AI layer (company key, verified quotes, human approval, AI register) | quality before quantity; every agent needs an evaluation set |
| D5 | Programs are answered by four strategies (register column `marc_strategy`): **REPLACE_NATIVE** (MARC does the job itself), **INTEGRATE** (connector / open formats with the client's licensed tool), **INNOVATE / AI_NATIVE** (beyond the reference product), **INTEGRATE_ONLY** (outside the construction core) | authoring CAD/BIM and FEM solvers cannot be re-implemented credibly in one step; open formats (IFC, DXF, BCF, XER, MSPDI, XLSX, GeoJSON) and vendor APIs give working value now, native engines follow in later waves with verification |
| D6 | Engineering results (structural, MEP, energy) are always records signed by the accountable licensed engineer; AI never signs | OVD-001 §5 |
| D7 | Country packs are data + rules per country (tax, e-invoice, payroll, labour law, calendar): Egypt first (exists partly), KSA and UAE next, then Gulf and Arab states, then EU/US | OVD-003 market order |
| D8 | Duplicated / alias entries of the list are kept for traceability and flagged in the register; coverage is counted on distinct products | honesty of counts |

## 3. Coverage of the 451 programs (register: `MARC_451_COVERAGE_REGISTER.csv`)
Status is the status of the **MARC capability that answers the program's role**, measured by MARC's gate - not a claim of
feature parity with the named product (parity is proven only by a per-product acceptance set, §7).

| Cat | Area | Entries | Strategy | MARC status | Wave |
|---|---|---:|---|---|---|
| 01 | General ERP suites | 31 | replace + coexistence connectors | PARTIAL (consolidation, treasury, depreciation missing) | W1 |
| 02 | Construction ERP | 34 | replace | BUILT & TESTED core | W1 |
| 03 | Construction PM / CDE | 24 | replace | PARTIAL (offline mobile, model-based CDE missing) | W3 |
| 04 | Construction AI | 29 | AI-native | PARTIAL (tender study agent only) | W5 |
| 05 | Estimating / take-off | 23 | replace + innovate | PARTIAL (take-off from drawings missing) | W6 |
| 06 | Scheduling | 14 | replace | PARTIAL (resources, Monte Carlo risk, 4D missing) | W3 |
| 07 | BIM / CAD coordination | 23 | open formats + native viewer | NOT STARTED | W6 |
| 08 | Arab / regional ERP | 28 | replace and compete | PARTIAL (KSA / UAE packs missing) | W1 |
| 09 | CRM, HCM, BI, collaboration | 58 | replace | PARTIAL | W1 |
| 10 | AI agents / automation | 24 | AI-native | PARTIAL | W5 |
| 11 | Autodesk AEC portfolio | 26 | open formats + APIs under client licence | NOT STARTED | W6 |
| 12 | Architecture / interior | 42 | integrate + innovate | NOT STARTED | W6 |
| 13 | Structural / geotechnical | 26 | connector now, verified engine later | NOT STARTED | W6 |
| 14 | MEP, lighting, energy | 27 | integrate + native calculators | NOT STARTED | W6 |
| 15 | Infrastructure / GIS / survey | 24 | open formats | NOT STARTED | W6 |
| 16 | Mechanical / PLM / simulation | 18 | integrate only | NOT STARTED | W8 |
Totals: BUILT_TESTED_CORE 34, PARTIAL 231, NOT_STARTED 186.

## 4. Coverage of the 14 divisions (634 roles)
| Div | Division (roles) | MARC today (evidence) | Missing (goes to wave) |
|---|---|---|---|
| 01 | Governance and board (50) | DOA, approvals, executive and owner-portfolio dashboards, audit | board / committee meetings, resolutions, company secretary registers (W1) |
| 02 | Strategy, M&A, PPP, JV (36) | - | investment appraisal, JV accounting and partner shares (W1) |
| 03 | Business development (41) | CRM leads, opportunities, activities | company prequalification library, key accounts (W1) |
| 04 | Tendering and estimating (42) | tenders, clarifications, documents, BOQ, rate build-up, AI tender study | take-off from drawings/models (W6) |
| 05 | Commercial, contracts, claims (41) | contracts, clauses, notices, claims, EOT, variations, compensation events, LDs | delay-analysis methods (TIA) on the schedule (W3) |
| 06 | Design and engineering (63) | design links, revision impacts, drawings | engineering calculation records, model viewer, connectors (W6) |
| 07 | Technical office and document control (39) | RFIs, submittals, transmittals, EDMS, method statements, QR verification | model-based CDE workflows (W3) |
| 08 | PMO and planning (41) | projects, controls, EVM, risks, dated CPM, XER/MSPDI | resources, Monte Carlo risk, 4D (W3) |
| 09 | Construction and site (50) | site diary, manpower, equipment, instructions, permits, punch, NCR, HSE, attendance | offline mobile app, photo progress (W3) |
| 10 | Supply chain and logistics (39) | MR, RFQ, comparative, PO, GRN, 3-way match, inventory, vendors and prequalification | logistics, customs, supplier directory and marketplace (W2, W7) |
| 11 | Plant, equipment, manufacturing (47) | assets, usage, maintenance | depreciation, fleet dispatch, precast production (W1) |
| 12 | Finance and treasury (50) | GL, periods, journals, AP/AR, FX revaluation, cash flow, guarantees, tax engine, e-invoice EG, revenue recognition, profitability | group consolidation, bank statements and payment proposals, tax returns / withholding, depreciation (W1) |
| 13 | Human resources (39) | employees, payroll, cost allocation, attendance, leave, recruitment | statutory payroll per country, performance, learning, expat mobility (W1) |
| 14 | IT and security (56) | RLS isolation, MFA, audit, sessions, SaaS plans, integrations, webhooks | SSO / SCIM, SIEM export, data residency options (W1) |

## 5. Market gaps G01–G20 against MARC (evidence from migrations and suites)
| Gap | MARC today | Verdict |
|---|---|---|
| G01 5D BOQ / WBS / FIDIC | BOQ, IPC BOQ lines, variations, notices, compensation events, activities with WBS | PARTIAL - BOQ ↔ activity ↔ element allocation (5D) to build (W3) |
| G02 Field and CDE | RFIs, submittals, transmittals, checklists, punch, NCR | PARTIAL - due-date escalation rules, checklist versioning (W3) |
| G03 / G11 Ledger core | chart of accounts, general ledger, periods, journals, posting rules | BUILT & TESTED |
| G04 Offline sync | - | NOT STARTED (W3) |
| G05–G10 Developer / real estate (units, reservations, CRM, brokers, instalments, leases, handover / FM, portals) | construction handover and commissioning only | NOT STARTED - new real-estate developer suite (W4) |
| G12 Consolidation | multi-company isolation only | NOT STARTED (W1) |
| G13 AP / AR matching | AP, AR, GRN, vendor invoices, match results | BUILT & TESTED |
| G14 Treasury | bank accounts, reconciliation, cash flow, guarantees | PARTIAL - statement import, payment proposals under DOA (W1) |
| G15 Tax lifecycle | tax codes, contract tax profiles, withholding at certification, e-invoice EG | PARTIAL - returns, ZATCA / UAE (W1) |
| G16 Payroll localisation | payroll runs, lines, cost allocation | PARTIAL - statutory rules per country (W1) |
| G17 Time and labour | attendance, timesheets, payroll allocation | BUILT & TESTED |
| G18 Fixed assets | assets, usage, maintenance | PARTIAL - depreciation runs posted to GL (W1) |
| G19 Revenue / WIP | revenue recognition runs, forecasts, EVM, profitability | BUILT & TESTED |
| G20 Integration governance | connections, webhooks, automation, data imports, Excel exchange | PARTIAL - dead-letter replay, full export manifest (W1) |

## 6. Unified roadmap (waves; each wave = stages with the full gate, records, CI)
| Wave | Scope | Why this order |
|---|---|---|
| **W1 Enterprise group core** | group / company hierarchy and consolidation with intercompany eliminations; depreciation; treasury statements and payment proposals; tax returns and withholding; country packs KSA (ZATCA phase 2) and UAE (FTA), payroll statutory engines per country; board / JV registers; SSO; division and role template library (634 roles) | a group like Orascom / Emaar / Al Shafar cannot run without consolidation, treasury and country compliance |
| **W2 Built-in research and reference (OVD-003 §2)** | codes and references library (Egyptian, Saudi, UAE, Gulf, Arab, US …) with clause index and cited AI answers; market price index with source and date; approved-supplier directory with verification and performance ratings | owner priority "this is the beginning"; foundation of the marketplace |
| **W3 Field, schedule and offline** | offline mobile site app with conflict-safe sync; photo progress; resources and Monte Carlo risk on the schedule; 5D link BOQ ↔ activity; escalations; delay analysis | daily users on sites |
| **W4 Developer / real estate suite** | units, price books, reservations, sales instalments, leases, brokers and commissions, unit handover, FM service requests and SLA, portal feeds | the Emaar / developer market (G05–G10) |
| **W5 AI agents per division** | 14 division agents then role families: contract risk review, claims assistant, schedule optimisation, progress from photos, procurement assistant, finance close assistant, HR assistant; evaluation sets per agent | AI-first product, built on governed data |
| **W6 Design and engineering integration** | IFC / DXF / BCF viewer and model quantities; take-off from PDF / DXF; drawing review agent; connectors to licensed Revit / AutoCAD (APS), SAP2000 / ETABS (OAPI), Primavera API; MEP / lighting / energy calculators; GIS layers; later a verified open-source analysis engine | replaces the design-side programs step by step with open formats and verified engines |
| **W7 Construction marketplace (OVD-003 §3)** | catalogue, RFQ, orders, payments with licensed providers, delivery tracking, ratings; linked to procurement, stores and cost | revenue line; shares the supplier directory of W2 |
| **W8 Global raise** | EU / US country packs, GDPR, SOC 2 / ISO 27001 evidence, accessibility conformance, multi-region hosting | OVD-003 §1 second stage |

Third-party / open-source components needed by a wave are reported to the owner before download (OVD-003 §1), with
licence checked first (LGPL / GPL code is read for reference only unless the owner approves the licence model).

## 7. Review committees and release levels (no release before all levels pass)
| Level | Committee / check | Evidence required |
|---|---|---|
| L1 Author gate | full gate from an empty database (API suites + browser checks), static and security checks, typecheck | gate log, 0 FAIL |
| L2 CI | the same gate on GitHub Actions for both branches | CI green |
| L3 Independent review | separate reviewers for correctness, security (attack surface), data model and UX / accessibility, without sight of the author's reasoning | findings closed or registered |
| L4 Domain acceptance | golden cases per domain (accounting, tax, payroll, contracts, scheduling) computed independently; per-product acceptance sets for parity claims | acceptance report |
| L5 Hostile red team | abuse, isolation, concurrency, injection, privilege escalation | red-team report (pattern of REDTEAM_REV*) |
| L6 Release board | owner sign-off on scope, evidence and the honest announcement text (MP-07 §5) | signed release record |
Today MARC operates L1 and L2 on every stage and has executed red-team rounds; L3–L6 are added per wave from W1.

## 8. Next step
Start W1 stage 71: group hierarchy and consolidation (companies under a group, intercompany accounts, elimination
rules, consolidation runs reproducible with FX), with the full gate and records; then the remaining W1 stages in the
order of §6.
