# MP-07 — Gap map, build plan, test plan and honest announcement scope

Master Plan part 7 of 7 (OVD-001, OQS-001). Closes the master plan: what exists, what is partial, what is missing,
in what order it is built, how each release is proven, and what may be said publicly.

## 1. Where the product stands (evidence)
- **Runtime gate (E1):** 45 API suites + 5 browser checks, 1,410 checks, all passing from an empty database
  (RUN sh5, 2026-10-15); CI on PostgreSQL 16 / 17 green on every push of the branch, the latest being run 38713172633
  whose tree includes CC-065; 65 controlled changes
  (CC-001…CC-065) in 36 stages; 83 migrations; row-level tenant isolation forced on every table.
- **Golden Case steps (gate-checked):** 167 steps — 74 RUNTIME, 52 PARTIAL, 37 ABSENT, 3 API, 1 SCHEMA.
- **Strongest verified areas:** the commercial and financial core — client IPCs (advances, retention, certification,
  disputes, payment terms), subcontract certificates (advances, retention, back-charges, tax), variations, claims /
  EOT, notice / time-bar engine, collections, tax codes and withholding, GL posting with balanced batches, revenue
  recognition runs, go-live cut-over with reconciliation, inventory with valuation and controls, procurement chain,
  DOA and segregation of duties, approvals with rejection paths, HR / payroll basics, EDMS, technical office reviews,
  design-revision impact, commissioning-to-hand-over, risks, report packs, CPM scheduling, sessions, login throttling
  and MFA.

## 2. Gap map by domain (computed)
Method (script `gap_map.py`, scratchpad): each MP-02 process is classified from the gate-checked statuses of the
Golden Case(s) mapped to it. The mapping is at case level, so "some steps RUNTIME / PARTIAL" means the process is
partly covered — not that it is complete. "Not yet assessed" means no Golden Case covers it yet; existing code may
cover part of it, but nothing is claimed until a case and a suite prove it.
| Domain | Processes | Mapped to a Golden Case | All mapped steps RUNTIME | Some steps RUNTIME / PARTIAL | All mapped steps ABSENT | Other (API / SCHEMA only) | Not yet assessed |
|---|---|---|---|---|---|---|---|
| D01 Governance, strategy and policy | 9 | 4 | 0 | 3 | 1 | 0 | 5 |
| D02 Business development and CRM | 7 | 2 | 0 | 2 | 0 | 0 | 5 |
| D03 Tendering and estimating | 14 | 13 | 0 | 13 | 0 | 0 | 1 |
| D04 Award, contract and project hand-over | 6 | 4 | 0 | 4 | 0 | 0 | 2 |
| D05 Project set-up and mobilisation | 10 | 8 | 0 | 8 | 0 | 0 | 2 |
| D06 Design management and technical office | 12 | 9 | 1 | 8 | 0 | 0 | 3 |
| D07 Design studio: interiors and architecture | 8 | 0 | 0 | 0 | 0 | 0 | 8 |
| D08 Planning, controls and reporting | 11 | 10 | 0 | 10 | 0 | 0 | 1 |
| D09 Procurement and subcontracting | 8 | 7 | 1 | 6 | 0 | 0 | 1 |
| D10 Stores and materials | 8 | 4 | 0 | 4 | 0 | 0 | 4 |
| D11 Plant and equipment | 6 | 2 | 0 | 2 | 0 | 0 | 4 |
| D12 Site execution | 10 | 8 | 0 | 7 | 1 | 0 | 2 |
| D13 Quality | 7 | 5 | 0 | 5 | 0 | 0 | 2 |
| D14 Health, safety and environment | 10 | 7 | 0 | 7 | 0 | 0 | 3 |
| D15 Commercial: billing, variations, claims, subcontracts | 13 | 9 | 2 | 7 | 0 | 0 | 4 |
| D16 Finance, treasury and tax | 19 | 11 | 0 | 11 | 0 | 0 | 8 |
| D17 Human resources and payroll | 14 | 7 | 0 | 7 | 0 | 0 | 7 |
| D18 Administration and facilities | 4 | 1 | 0 | 0 | 1 | 0 | 3 |
| D19 Legal and corporate affairs | 5 | 1 | 0 | 1 | 0 | 0 | 4 |
| D20 Handover, warranty and close-out | 8 | 5 | 0 | 5 | 0 | 0 | 3 |
| D21 Facility management (optional unit) | 3 | 0 | 0 | 0 | 0 | 0 | 3 |
| D22 IT, data and AI | 9 | 8 | 0 | 6 | 2 | 0 | 1 |
| D23 Executive portfolio management | 3 | 3 | 0 | 3 | 0 | 0 | 0 |
| D24 Audit and compliance | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| D25 Production and workshops (optional unit, MP-01 4.7a) | 4 | 0 | 0 | 0 | 0 | 0 | 4 |
| **Total** | **210** | **128** | **4** | **119** | **5** | **0** | **82** |

Cross-cutting gaps established in MP-03…MP-06 (all E3-verified absent): document generation / export / print engine;
AI inference, retrieval and tool execution (the AI registry exists); working calendars, resources, cost loading and
P6 / MSP exchange in scheduling (the CPM core exists); CAD, BIM, interior and Autodesk engines; translation framework,
design system, grouped navigation, notification centre and 25 of 26 alert types (approval-pending exists in the
backend only); position catalogue, approved headcount and workforce gap alarm; mobile offline app; portals UI.

## 3. Build plan — releases (proposal; the owner sets the priority)
Each release is a sequence of controlled stages like the 36 delivered so far: implementation → runtime / static /
security / regression tests → fixes → records → owner review. Nothing is announced as available before its release
gate passes.
| Release | Scope | Exit gate (all must hold) |
|---|---|---|
| R1 — Sellable foundation | Arabic / English translation framework and labels; grouped navigation, workspace switcher, global search; design system, data grid and record-page template; notification centre + alerts AL-01…AL-26 (rule engine); export / print engine with the first document set (IPC, subcontract certificate, PO, payment voucher, GRN, daily diary, journal voucher); owner portfolio dashboard v1 (progress, PV / EV / AC, cash, alerts, drill-down) from existing data; position catalogue, approved headcount and gap alarm v1; generalised import (cut-over pattern); report designer with scheduled distribution (competitive parity, COMPETITOR_SCAN_001); bilingual in-app help; revenue output method (F-47, planned Stage 37) | Gate green; browser checks in both languages and directions; every exported figure equals the database value; owner acceptance of the screens |
| R0 — Operations readiness (alongside R1) | Monitoring and alerting of the service, centralised logs, automated backups with restore tests, disaster-recovery runbook, release / rollback procedure, environment separation (test / production) | Restore test passed and timed; runbook rehearsed; production deployment remains an owner decision |
| R2 — Planning and project set-up | Calendars, constraints, resources, cost loading from the execution BOQ, Gantt / network / look-ahead, schedule quality checks, XER / P6 XML / MSPDI exchange (MPXJ service), pre-construction BOQ | P6 parity on the reference set (MP-05 §1); round-trip files without loss |
| R3 — AI layer v1 | Model gateway, per-tenant retrieval with citations, tool layer on the caller's token, draft / review queue, evaluation harness; first agents AG-04 tender study, AG-09 contract review, AG-05 quantity / BOQ check, AG-31 ask-the-business | Each agent passes its evaluation (citation accuracy and numeric fidelity pass / fail) and the AI Governance Committee release |
| R4 — Tender to award complete | Estimating workbench, cost database, indirect costs, bid committee, AG-06 estimating, AG-07 planning, AG-08 risk | End-to-end tender suite (registration → bid decision → award → hand-over) green |
| R5 — Technical office and BIM | Drawing workspace (DXF engine), IFC viewer, clash, model quantities, submittal compliance; AG-15 / 16 / 17 / 18; Revit connector (read, official tech preview) | DXF / IFC round-trip and QTO acceptance tests (MP-05 §7) |
| R6 — Interior studio | MP-05 §5 pipeline with AG-20 | Client-approval flow suite; quantities vs checked take-off |
| R7 — Completion of the enterprise map | Remaining domains and processes (D01, D02, D07 architecture, D10–D11 gaps, D16–D19 gaps, D21 FM, D24, D25), portals, mobile offline app, remaining agents | Every MP-02 process mapped to a Golden Case and RUNTIME, or explicitly deferred by the owner |

**Effort (E4 estimate, not evidence):** by analogy with the stages delivered so far, R1 ≈ 12–16 stages, R2 ≈ 8–12,
R3 ≈ 8–12, R4 ≈ 6–10, R5 ≈ 12–18, R6 ≈ 6–10, R7 ≈ 20–30 — about 72–108 stages for R1–R7 (R0 runs alongside).
The owner's target of one to two months for everything (OVD-001 §3) is therefore not achievable on this estimate;
what fits a short horizon is R1 (and R0). Calendar time follows the pace of stages and owner
reviews; each release is re-estimated at its start and the estimate replaced by the actual count.

## 4. Test plan (applies to every release)
| Layer | What | When |
|---|---|---|
| Runtime API suites | From an empty database, every process path incl. refusals, SoD, races and tenant isolation | Every stage (gate) |
| Static and security checks | Lint, type checks, tenant / phase security scans, money-in-SQL rule, schema-code column checks | Every stage |
| Browser checks | Every workspace, both languages / directions, light / dark | Every stage touching UI |
| Accessibility | WCAG 2.2 AA automated + manual | Each release |
| Performance | Load and interaction budgets measured on reference data volumes (budgets agreed with the owner at R1 start) | Each release |
| AI evaluation | Per-agent evaluation sets; hard pass / fail on citations and numbers | Each agent release and monthly |
| Engine acceptance | P6 parity, DXF / IFC round-trip, QTO and clash reference sets | R2, R5, R6 |
| Data migration rehearsal | Full cut-over rehearsal with real customer data before go-live | Each customer go-live |
| Security | Independent penetration test and configuration review | Before any production deployment |
| Disaster recovery | Backup restore test with timing | Before production and periodically |
| User acceptance | Each MP-01 department signs its module after real use | Each release |

## 5. What may be announced (honesty rules)
**May be stated now (verified at runtime):** an Arabic-first construction management platform under development with
a working, tested commercial and financial core — client and subcontract certificates with advances, retention,
deductions and tax; variations, claims and contractual notices; procurement-to-payment chain; inventory; GL posting;
revenue recognition; go-live data cut-over; approvals with delegation of authority and segregation of duties;
multi-company isolation; MFA. Demonstrations only on these.

**May be stated as roadmap (without dates or "available" wording):** AI agents per role, Primavera-class scheduling,
in-system CAD / BIM, Revit / AutoCAD connectors, interior design studio, owner portfolio cockpit, workforce gap alarm.

**Must not be stated:** that any roadmap capability exists or works; comparisons claiming superiority over named
products; "final", "complete" or "production ready"; any figure (users, savings, accuracy) without evidence.

**Before selling to a customer (owner-only decisions):** production deployment and hosting, penetration test,
customer contract and support terms, data-protection terms (including AI providers), licence compliance of all
components (MP-05 §6), pricing.

## 6. Immediate next step after owner approval of the master plan
Start R1 with its first stage, in this order unless the owner decides otherwise: (1) translation framework and Arabic
labels for all existing screens, (2) grouped navigation and workspace switcher, (3) notification centre with the
existing approval-pending alerts and AL-02, (4) export / print engine with the IPC and subcontract certificate PDFs,
(5) owner portfolio dashboard v1. F-47 (revenue output method, planned Stage 37) is placed within R1 or earlier at
the owner's choice.

## 7. Coverage and review record
**Counts (computed):** 25 domains / 210 processes in the gap map (128 mapped to Golden Cases: 4 with all mapped steps
RUNTIME, 119 partly covered, 5 with all mapped steps ABSENT; 82 not yet assessed); 8 releases (R0–R7); 11 test
layers; estimate 72–108 stages for R1–R7 (sums checked).

**Review log (OQS-001):**
- R3 truth: gate figures taken from CURRENT_STATE (RUN sh5) and the decomposition file (step statuses recounted by
  script: 74 / 52 / 37 / 3 / 1); CI status checked on GitHub — every push of the branch green, latest run 38713172633
  includes CC-065 (the draft's "CC-065 run to verify" was out of date and corrected); verified-capability list in §1
  and §5 restricted to areas with gate suites.
- Hostile pass 1 (delivery): operations readiness (monitoring, logs, backups, DR, release / rollback) was missing —
  R0 added; report designer with scheduled distribution and bilingual help moved into R1 for parity with the
  competitors' visible features.
- Hostile pass 2 (owner expectation and honesty): the estimate total is stated next to the owner's one-to-two-month
  target, with the plain conclusion that only R1 (with R0) fits a short horizon; announcement rules list what may,
  may not and must not be said.
- Residual (stated): the gap map is at Golden Case level; 82 processes are unassessed until cases and suites cover
  them; stage estimates are E4 and are replaced by actuals per release.

**Status:** reviewed (computed gap map, CI verification, two hostile passes); **approved by the owner (Mishel Thabet Halim), 2026-10-15 — R6, approval register A-001.** With MP-07 the
master plan MP-01…MP-07 is the approved reference plan; it records what is planned, not what is built (gap map above).
