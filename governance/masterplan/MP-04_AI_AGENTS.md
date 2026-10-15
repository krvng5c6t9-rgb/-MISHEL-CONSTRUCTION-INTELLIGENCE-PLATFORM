# MP-04 — AI agents: roles, data, tools, limits, quality and governance

Master Plan part 4 of 7 (OVD-001, OQS-001). Agents serve MP-01 positions, act inside MP-02 processes and draft MP-03
documents.

Code status (E3, verified 2026-10-15): migration `033_ai_platform_core.sql` creates a registry — `ai_models`,
`ai_prompts`, `ai_tools`, `ai_agents`, `ai_agent_tools`, `ai_workflows`, `ai_runs`, `ai_run_steps`,
`ai_evaluations` — and `backend/src/modules/aiPlatform/aiPlatform.routes.ts` exposes create / list / update of these
records, run records and evaluations. **No model is called** (no provider SDK, no outbound HTTP call in
`backend/src`), **no document retrieval**, **no tool execution** exists. The registry is the foundation; everything
else in this part is to build (MP-07).

## 1. Non-negotiable rules
1. **AI never approves.** No agent holds A in any process; no tool exposed to an agent can approve, certify, post,
   pay, sign or change a DOA, and nothing is sent to a third party except as an L3 action that a named human
   approved for that specific instance (e.g. an RFQ the Procurement Manager approved). Those remain human actions
   through the existing workflow.
2. **Autonomy levels** (same scale as the Golden Case decomposition): L0 inform · L1 recommend · L2 draft ·
   L3 execute a reversible, pre-approved action (e.g. send an RFQ a buyer approved) · L4 rule-bound automatic
   execution — **reserved for deterministic database rules, never for an agent** · L5 prohibited / external
   authority. **Agent ceiling: L3.**
3. **Caller's permissions only.** An agent acts with the token of the user who invoked it (or of the workflow owner
   for scheduled runs): row-level security, permissions and segregation-of-duties checks in the database apply to the
   agent exactly as to the person.
4. **No invented numbers.** Money, quantities, dates and rates come from the database or from a cited source; every
   calculation is done by a database function or deterministic code, never by the language model. A figure without a
   source is shown as missing, not guessed.
5. **Cite or abstain.** Every finding carries its sources (document, page / clause / cell, record id). If evidence is
   insufficient the agent says so.
6. **Drafts are marked.** Every agent output is a draft with the "DRAFT" watermark (MP-03 §1) until a named human
   accepts or edits it; acceptance, edits and rejections are recorded.
7. **Documents are data, not instructions.** Text inside uploaded files, e-mails or web pages can never change an
   agent's instructions, permissions or tools (prompt-injection defence).
8. **Traceability.** Each run stores agent / prompt / model / tool versions, input references and hashes, output,
   cost and the human decision (tables `ai_runs` / `ai_run_steps`).
9. **Classification follows the data.** An agent output carries the highest confidentiality class of the sources it
    used; it can be seen, exported or printed only by users entitled to all those sources.
10. **Kill switch.** Each agent can be suspended instantly per company by the AI Governance Committee; a suspended
   agent never blocks the manual process.

## 2. Agent catalogue
Columns: **Serves** (MP-01 positions, `;`-separated) · **Processes** (MP-02) · **Reads** · **Drafts** (MP-03 codes or
outputs) · **Max** (autonomy ceiling) · **Human gate** (who accepts the draft) · **Quality measure** (release and
monitoring metric; thresholds set by the AI Governance Committee).
| ID | Agent | Serves | Processes | Reads | Drafts | Max | Human gate | Quality measure |
|---|---|---|---|---|---|---|---|---|
| AG-01 | Executive briefing | CEO / Managing Director; CFO; COO / Operations Director | D01.01, D01.07, D23.01, D23.02, D23.03 | Portfolio KPIs, cost, cash, risks, gaps | DOC-23-001, DOC-23-002, board pack narrative | L2 | Executive reading it | Every figure traceable to a record; zero unsourced statements |
| AG-02 | Opportunity and market | Business Development Director; BD Manager; Market Research Analyst | D02.01, D02.02, D02.04, D02.05, D02.06, D02.07, D03.13 | Tender portals and news (allowed sources), client history, bid results | DOC-02-001, DOC-02-003 scoring, DOC-03-015 | L2 | BD Manager | Precision of opportunities kept; scoring vs actual go / no-go |
| AG-03 | Prequalification | Prequalification Coordinator | D02.03 | Company profile, certificates, projects, financials | DOC-02-002 | L2 | Prequalification Coordinator | Fields filled correctly; expired certificates flagged |
| AG-04 | Tender study | Tendering Manager; Tender Document Controller | D03.01, D03.02, D03.03, D03.11, D03.12, D04.05 | Tender documents (contract, specs, BOQ, drawings, addenda), company standards | DOC-03-001, DOC-03-002, DOC-03-004 queries, DOC-03-013, DOC-03-017, DOC-04-006 | L2 | Tendering Manager | Recall of seeded gaps / conflicts in test tenders; citation accuracy |
| AG-05 | Quantity and BOQ check | Tender Quantity Surveyor; Quantity Surveyor (project); TO Engineer — Architectural / Structural / Infrastructure | D03.04, D05.03, D06.11, D12.06 | BOQ, drawings / models, specs, measurement method | DOC-03-005, DOC-05-003, DOC-06-011, DOC-12-006 | L2 | Quantity Surveyor (project) | Quantity deviation vs checked take-off; missed items |
| AG-06 | Estimating | Senior Estimator (Civil / Arch / MEP); Cost Database / Pricing Analyst; Tender Enquiry Coordinator | D03.05, D03.06, D03.07, D03.14 | Cost database, quotes, productivity norms, indices, history | DOC-03-006, DOC-03-007, DOC-03-008, DOC-03-009, DOC-03-016 | L2 | Senior Estimator (Civil / Arch / MEP) | Every rate sourced and dated; estimate vs actual cost on closed projects |
| AG-07 | Planning | Planner / Scheduler; Tender Planner; Construction Manager | D03.08, D05.04, D08.02, D08.03, D12.02 | Scope, execution BOQ, methods, calendars, productivity, progress | DOC-03-010, DOC-05-004, DOC-08-002, DOC-08-003, DOC-12-002 | L2 | Planning Manager | Schedule quality checks passed; logic errors found in seeded schedules |
| AG-08 | Risk | Risk Manager; Tender Risk & Contingency Analyst | D01.05, D03.09, D03.10, D08.07 | Documents, risk history, schedule and cost data | DOC-01-005, DOC-03-011, DOC-08-006, sensitivity analysis | L2 | Risk Manager | Risks later realised that were identified; false-alarm rate |
| AG-09 | Contract and clause review | Contracts Manager; Legal Advisor; Contract Administrator (project) | D04.01, D04.02, D09.08, D19.01 | Contract, subcontract, company clause library | DOC-04-001, DOC-04-003, DOC-19-001 draft | L2 | Contracts Manager (legal sign-off by General Counsel) | Recall of seeded risky clauses; obligation dates correct |
| AG-10 | Correspondence and meetings | Contracts Engineer; Contract Administrator (project); Project Engineer / Project Coordinator | D12.07, D15.10, D15.11 | Correspondence, minutes, obligations calendar | DOC-15-010, DOC-15-011, DOC-12-007 | L2 | Contracts Manager | Letters with correct references and clauses; time-bar dates correct |
| AG-11 | Variations, claims and delay | Change / Variation Manager; Claims Manager / Engineer; Forensic Delay Analyst | D08.08, D08.09, D12.05, D15.02, D15.06, D15.07, D15.12, D19.02 | Instructions, diaries, schedules, correspondence, contract | DOC-15-006, DOC-15-007, DOC-08-007, DOC-08-008, DOC-15-002, DOC-15-012 | L2 | Claims Manager / Engineer | Notices detected within time bar; evidence completeness |
| AG-12 | Client billing check | Quantity Surveyor (project); Commercial Manager (project); Final Account QS | D15.01, D15.03, D15.08, D15.09 | Measurements, variations, MOS, previous certificates, contract terms | DOC-15-001 checks, DOC-15-003, DOC-15-008, DOC-15-009 | L2 | Commercial Manager (project) | Anomalies found in seeded IPCs; zero recomputed amounts (database values only) |
| AG-13 | Subcontract certificate check | Subcontract Administrator | D15.04, D15.05 | Subcontract, site records, previous certificates, NCRs | DOC-15-004 checks, DOC-15-005 | L2 | Commercial Manager (project) | Over-claims found in seeded certificates |
| AG-14 | Cost, cash and forecast | Cost Control Manager / Cost Controller; FP&A Analyst; Treasury Manager / Cashier | D01.02, D05.01, D05.02, D05.05, D08.04, D08.05, D08.06, D16.07, D16.08, D16.17 | Budget, commitments, actuals, progress, billing, payment terms | DOC-05-001, DOC-05-002, DOC-05-005, DOC-08-004, DOC-08-005, DOC-08-011, DOC-16-008, DOC-16-009, DOC-16-018 narrative | L2 | Cost Control Manager / Cost Controller | Forecast error vs outturn; narrative matches figures |
| AG-15 | Design package review | Technical Office Manager; Design Manager (D&B); TO Engineer — Mechanical / Electrical / Plumbing / Fire | D06.01, D06.02, D06.03, D06.04, D06.10 | Drawings, models, specs, standards, previous comments | DOC-06-002, DOC-06-003, DOC-06-004, DOC-06-010 | L2 | Technical Office Manager | Recall of seeded design errors; false-positive rate |
| AG-16 | BIM coordination and interfaces | BIM Coordinator; BIM Manager; Interface Manager | D06.08, D08.11 | Federated models (IFC), interface register | DOC-06-008, DOC-08-010 | L2 | BIM Manager | Clash grouping accuracy; duplicate clash reduction |
| AG-17 | Drafting and survey processing | BIM Modeller / CAD Draftsman (per discipline); As-built Engineer; Temporary Works Engineer; Surveyor (land) | D05.08, D06.05, D06.09, D06.12, D07.01, D07.07, D12.10, D25.03 | Approved design, standards, families / blocks, survey data | DOC-06-005, DOC-06-009 checks, DOC-06-012, DOC-07-001, DOC-07-008, DOC-12-009, DOC-25-003 | L2 | Technical Office Manager (engineering checks by licensed engineer) | Drawing check pass rate; dimensional accuracy vs source (MP-05) |
| AG-18 | Submittal compliance | Submittals Engineer | D06.06 | Specs, product data, approved samples | DOC-06-006 compliance statement | L2 | Technical Office Manager | Non-compliances found in seeded submittals |
| AG-19 | Plans, methods and procedures | Method Statement Engineer; QA Engineer; HSE Manager; Project Manager | D05.06, D06.07, D13.01, D14.01 | Templates, history, specs, legal register (as provided) | DOC-05-006, DOC-06-007, DOC-13-001, DOC-14-001 | L2 | Section owner (PM / QA/QC Manager / HSE Manager) | Mandatory sections complete; reviewer edit rate |
| AG-20 | Interior and architectural design | Interior Designer; Architect; 3D Visualiser; FF&E Specialist | D07.02, D07.03, D07.04, D07.05, D07.06, D07.08 | Brief, verified base, style library, material library, codes and standards as provided | DOC-07-002, DOC-07-003, DOC-07-004, DOC-07-005, DOC-07-006, DOC-07-007 | L2 | Design Director (Architecture & Interiors) | Options meeting the brief's hard constraints; client selection rate |
| AG-21 | Procurement | Buyer (local / import); Procurement Manager; Vendor Management Officer; Expeditor; Logistics / Customs Officer; Plant Manager / Equipment Planner | D09.01, D09.02, D09.03, D09.04, D09.05, D09.06, D09.07, D11.02 | Requisitions, vendor history, prices, delivery records | DOC-09-001, DOC-09-002, DOC-09-003, DOC-09-004 draft, DOC-09-006, DOC-09-007, DOC-09-008 checks, DOC-11-002 | L3 (sends only RFQs the Procurement Manager approved) | Procurement Manager | Levelling errors in seeded offers; delivery-delay prediction accuracy |
| AG-22 | Materials, stores and production | Stores Manager / Storekeeper / Inventory Controller; Material Planner; Production Planner; Batching Plant Manager / Operator | D10.01, D10.03, D10.04, D10.05, D25.01, D25.02, D25.04 | Stock, issues, execution BOQ, schedule, pour requests | DOC-10-001 capture, DOC-10-005 analysis, DOC-10-006, DOC-25-001, DOC-25-002, DOC-25-004 | L2 | Stores Manager / Storekeeper / Inventory Controller | Wastage anomalies confirmed; stock-out predictions |
| AG-23 | Plant | Plant Manager / Equipment Planner; Maintenance Planner / Mechanic | D11.01, D11.03, D11.04, D11.06 | Equipment plan, logbooks, fuel, maintenance history | DOC-11-001, DOC-11-003 checks, DOC-11-004, DOC-11-006 analysis | L2 | Plant Manager / Equipment Planner | Breakdown prediction precision; fuel anomalies confirmed |
| AG-24 | Site assistant | Site Engineer (Civil / Arch / MEP); Site Manager / Senior Site Engineer; Progress Measurement Engineer | D08.01, D12.03, D12.04, D12.08 | Voice / text notes, photos, timesheets, plans | DOC-12-004, DOC-12-003, DOC-08-001, DOC-08-012, DOC-12-008 | L2 | Site Manager / Senior Site Engineer | Diary fields correctly filled; progress-from-photo error |
| AG-25 | Quality | QA/QC Manager; QC Inspector (Civil / Arch / MEP); Lab Technician / Materials Tester; Management System Representative (ISO 9001 / 14001 / 45001) | D01.04, D13.02, D13.03, D13.04, D13.05, D13.07 | Inspections, tests, photos, NCRs, procedures | DOC-01-004, DOC-13-002 validation, DOC-13-003, DOC-13-004, DOC-13-005, DOC-13-007 | L2 | QA/QC Manager | Defect detection precision / recall on labelled photos |
| AG-26 | HSE | HSE Manager; HSE Engineer / Safety Officer; Environmental Officer; Security Manager / Site Security Supervisor | D12.01, D14.02, D14.04, D14.05, D14.07, D14.08, D14.10 | Permits, risk assessments, photos, incidents, monitoring, CCTV events (where lawful) | DOC-12-001 hazard check, DOC-14-002, DOC-14-004, DOC-14-005, DOC-14-007, DOC-14-008 | L2 | HSE Manager | Hazard detection precision / recall on labelled photos; trend alerts confirmed |
| AG-27 | Finance operations | Finance Manager / Chief Accountant; Accountant — GL / AP / AR / Project; Treasury Manager / Cashier; Credit Control / Collections Officer; Fixed Assets Accountant; Site Accountant / Petty Cash Custodian; Payroll Accountant | D16.01, D16.02, D16.04, D16.05, D16.06, D16.10, D16.13, D16.14, D16.15, D16.19 | Invoices, POs, GRNs, bank statements, ledgers | DOC-16-002 capture / match, DOC-16-005, DOC-16-007 matching, DOC-16-011, DOC-16-014, DOC-16-015 checks, DOC-16-020 support | L2 | Finance Manager / Chief Accountant | Matching precision; duplicate / anomalous payments found in seeded data |
| AG-28 | Tax check | Tax Manager / Officer | D16.12 | Transactions, tax codes (owner-provided), e-documents | DOC-16-013 checks | L1 | Tax Manager / Officer | Tax-code mismatches found in seeded data |
| AG-29 | HR and workforce | HR Director (CHRO); Organisation Development Specialist; Recruitment Specialist; HR / Personnel Officer; Site Timekeeper; Payroll Specialist (HR); Performance Management Specialist; Training & Development Specialist; Camp / Housing Coordinator; Project Manager | D05.07, D17.01, D17.02, D17.03, D17.04, D17.05, D17.07, D17.08, D17.09, D18.02 | Positions, staffing plans, employees, timesheets, CVs (with consent) | DOC-05-007, DOC-17-001, DOC-17-002, DOC-17-003 shortlist notes, DOC-17-004, DOC-17-005 checks, DOC-17-007 checks, DOC-17-008 evidence, DOC-17-009, DOC-18-003 | L2 (candidate screening L1: recommend only, never automatic rejection) | HR Director (CHRO) | Gap figures equal the database; screening audited for bias by protected attributes |
| AG-30 | Document control and hand-over files | Document Control Manager / Controller; Archive / Records Officer; Handover & Warranty Manager; Testing & Commissioning Engineer | D05.09, D05.10, D18.03, D20.01, D20.02, D20.04 | Documents, registers, revisions, test records | DOC-05-009, DOC-05-010, DOC-18-001, DOC-20-001 checks, DOC-20-004 | L2 | Document Control Manager / Controller | Classification accuracy; superseded-revision leaks = 0 |
| AG-31 | Ask-the-business and reporting | Data / BI Analyst; Reporting / Data Analyst; Project Manager | D08.10, D22.08, D22.09 | Any data the caller may see | Answers with citations, DOC-08-009 narrative, DOC-22-008 | L2 (answers L0) | The asking user | Answer correctness on a question bank; zero answers using data outside the caller's rights |
| AG-32 | Data import and mapping | Application Developer / Integrator; Financial Controller | D16.18, D22.04 | Source files, target schema | Column mapping, row checks, DOC-22-004, DOC-16-019 support | L2 | Financial Controller / IT & Digital Director (CIO) | Mapping accuracy on sample files; refused rows explained |
| AG-33 | Knowledge, lessons and ESG | Knowledge Management Officer; Sustainability / ESG Manager | D01.09, D20.07 | Close-out reports, lessons, cost database, material quantities | DOC-20-007 lessons, DOC-01-008 calculations | L2 | Knowledge Management Officer | Lessons reused in later bids; carbon figures traceable to quantities |
| AG-34 | Configuration, access and security | ERP / MISHEL Administrator; Cybersecurity Officer; Data Protection Officer | D01.03, D01.06, D22.01, D22.02, D22.06, D22.07 | DOA matrix, configuration, access logs, security events, data inventory | DOC-01-003 conflict check, DOC-01-009, DOC-22-001, DOC-22-002, DOC-22-006, DOC-22-007 | L2 | IT & Digital Director (CIO) | Seeded DOA conflicts / SoD breaches found |
| AG-35 | Audit and control monitoring | Head of Internal Audit; Internal Auditor / Compliance Officer | D01.08, D24.01 | Exception logs, approvals, overrides | DOC-01-007 sampling, DOC-24-001 | L1 | Head of Internal Audit | Exceptions confirmed by auditors |
| AG-36 | Expiry and obligations watch | Banking & Guarantees Officer; Insurance Officer; Calibration Controller; Work Permits / Expatriate Officer; Corporate Affairs Officer; Licensing & Permits Officer; Authorities & Utilities Liaison | D04.03, D04.04, D13.06, D16.09, D16.11, D17.13, D19.03, D19.04, D20.03, D24.02 | Registers with dates (guarantees, policies, permits, licences, certificates) | Reminders, renewal request drafts, cover-gap notes | L2 (reminders are date rules) | Register owner | Missed expiries = 0 (deterministic date rules; agent drafts the follow-up only) |
| AG-37 | Customer and FM service | Customer Care Officer (end-user units); FM Helpdesk Operator; FM Manager; Maintenance Engineer (MEP / civil); Handover & Warranty Manager | D20.05, D20.08, D21.01, D21.02, D21.03 | Tickets, assets, SLAs, maintenance history | Ticket triage, DOC-20-005, DOC-21-001, DOC-21-002, DOC-21-003 SLA narrative | L2 | FM Manager | Triage accuracy; SLA breach prediction precision |

## 3. Architecture
- **Agent definition (registry, exists; maintained by the AI Operations Specialist, MP-01):** model profile, prompt
  version, tool list, workflow, evaluation set — all
  versioned; a change is a D22.03 release approved by the AI Governance Committee.
- **Tool layer:** the system's own API endpoints, called with the invoking user's token, so row-level security,
  permissions and SoD apply; read tools by default; write tools create **drafts only**; no approval / posting /
  payment / issue tool exists for agents.
- **Deterministic calculators:** every number comes from SQL functions or code already used by the processes (the
  same rule that keeps money computed in SQL today).
- **Retrieval:** company documents indexed per tenant (text, tables, drawings metadata); answers cite page / clause /
  cell; nothing from one tenant is retrievable by another.
- **Structured outputs:** each agent returns JSON validated against a schema before anything is shown or saved.
- **Engineering engines:** CAD / BIM / scheduling engines and Revit / AutoCAD connectors are tools (MP-05); the agent
  produces structured geometry or schedule data, the engine draws / computes / checks it.
- **Human review queue:** drafts appear in the owner's task list with sources, diffs and confidence; accept / edit /
  reject is recorded and feeds evaluation.
- **Scheduled runs:** watchers (e.g. AG-36) run on schedules under a named workflow owner's rights.

## 4. Models, data protection and cost
- **Provider-agnostic gateway:** each agent's model is chosen by evaluation results, not by brand; switching a model
  is a versioned release that must pass the same evaluation set.
- **Data protection:** contractual assurance from any external model provider that company data is not used for
  training and is processed in agreed regions — a legal / owner input (contracts, data residency). Option of
  self-hosted open-weight models for restricted data, chosen by evaluation.
- **Personal data:** CVs, payroll, medical and CCTV data only for the purpose and with the legal basis the company
  defines; minimised before any model call; DPO review (D22.07).
- **Cost control:** per-company budgets, per-agent rate limits, cost per run stored; alerts at company-set thresholds.

## 5. Quality, evaluation and release
- **Evaluation sets per agent:** built from the company's own history (past tenders, contracts, IPCs, drawings,
  photos) plus seeded faults; the metric in section 2 is measured before release and continuously after.
- **Bilingual:** agents read and write Arabic and English; evaluation sets contain both languages and results are
  reported per language.
- **Hard requirements for every agent:** citation accuracy (every cited source exists and supports the statement) and
  numeric fidelity (every number equals its database / source value) are pass / fail, not averages.
- **Release gate:** an agent goes live per company only when the AI Governance Committee accepts its evaluation;
  results recorded in `ai_evaluations`.
- **Monitoring:** acceptance / edit / rejection rates, drift against the evaluation set, incidents; automatic
  suspension proposal when a hard requirement fails in production.

## 6. "Experience of the Egyptian market"
Comes only from data the company owns or cites: its cost database and closed-project actuals, supplier quotations,
productivity records, bid results, and published price indices recorded with source and date. The agent states the
source and date of every rate; with no source it reports a gap. It never claims market knowledge it cannot cite.

## 7. Inputs the owner / company provides
Cost database and closed-project history · supplier and subcontractor price history · productivity norms ·
templates (method statements, plans, letters, reports) · clause library and contract positions · drawing standards,
families and blocks (MP-05) · approved style and material libraries (interiors) · tax codes (OI-2 / tax advisor) ·
data-protection basis and provider terms (legal) · thresholds for each agent's release (AI Governance Committee).

## 8. Coverage and review record
**Counts (computed by script):** 37 agents; they cover all 186 MP-02 processes that have an AI role, each process
by exactly one agent; the 24 processes without an AI role are untouched. Autonomy ceilings: 31 agents L2, 2 agents
L1 (tax check, audit monitoring), 3 agents L2 with a lower level for a sensitive sub-task (answers L0, candidate
screening L1, reminders by date rules), 1 agent L3 (procurement: sends only RFQs a named manager approved). No agent
above L3.

**Automated checks (scratchpad `check_mp04.py` + table check):** every row has its header's column count; agent IDs
consecutive; every served position and human gate is an MP-01 position (or a named generic gate); every process
exists in MP-02 and has an AI role there; every drafted document exists in MP-03; no autonomy level above L3; every
AI-role process covered, none twice.

**Review log (OQS-001):**
- R3 truth: code status verified — the AI registry (migration 033, nine tables, routes for records, runs and
  evaluations) exists; no provider SDK and no outbound HTTP call in `backend/src`, so no inference, retrieval or tool
  execution exists. Data-protection terms, provider choice and thresholds are stated as owner / legal / committee
  inputs, not set here.
- Automated check: 7 "human gate" failures were a checker defect (titles containing parentheses were cut); the
  checker was fixed, not the document, and re-run clean.
- Hostile pass 1: 9 agents that draft documents were set to "inform / recommend" — raised to L2 (drafting) with the
  sensitive sub-task kept lower; rule 1 forbade any issue to third parties while the procurement agent sends RFQs —
  rule 1 now allows only an L3 action a named human approved for that instance; bilingual (Arabic / English)
  evaluation added.
- Hostile pass 2 (security / data leakage): an agent output could mix sources of different confidentiality — rule 9
  added (output takes the highest class of its sources); registry ownership assigned to the AI Operations Specialist.
- Residual (stated): agent quality cannot be proven before the agents and their evaluation sets exist; the release
  gate (section 5) is the control, and no agent capability is to be announced before it passes.

**Status:** reviewed (automated checks + two hostile passes); **approved by the owner (Mishel Thabet Halim), 2026-10-15 — R6, approval register A-001.**
