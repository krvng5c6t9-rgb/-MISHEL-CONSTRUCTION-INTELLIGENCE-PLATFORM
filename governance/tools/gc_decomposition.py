#!/usr/bin/env python3
"""Golden Case first-principles decomposition (STEP_01 v1.3 §52/§57, GC-01..GC-38).

Each step: activity | actor role | inputs | outputs | rule/decision/calculation | control | AI autonomy | code status | code evidence | links.
Code status (evidence grade in brackets):
  RUNTIME = exercised by tests/e2e chain.mjs or isolation.mjs (E1)
  API     = route + table exist in v0.2 code, never executed (E3)
  SCHEMA  = table exists, no route that performs the step (E3)
  PARTIAL = some of the step exists (E3; detail in evidence)
  ABSENT  = no table/route (E3)
AI autonomy per STEP_01 §AI: L0 inform, L1 recommend, L2 draft, L3 execute with pre-approval,
L4 rule-bound auto-execute, L5 prohibited/external authority. AI is never sole authority on
financial, contractual, engineering or safety decisions (constitution) -> such steps are L1/L2 at most.
Controls cite frozen STEP15 SoD rule ids (governance/reconciliation/STEP15_SOD_RULES_60.csv) and
DOA decision classes (STEP15_DOA_RULE_CLASSES_30.csv); DOA amounts are owner configuration.
Run: python3 governance/tools/gc_decomposition.py -> governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv
"""
import csv, os

GC = {}

def gc(code, title, steps):
    GC[code] = (title, steps)

# ---------------------------------------------------------------- commercial core
gc('GC-01', 'Tender-to-Award', [
    ('Register opportunity / invitation to tender', 'BD manager', 'lead, client, ITT notice', 'opportunity, tender record', 'go/no-go criteria (tenant configured)', 'none', 'L1 summarise ITT', 'RUNTIME', 'crm leads/opportunities, convert-to-tender (chain)', ''),
    ('Ingest tender package and check completeness', 'Estimator', 'ITT documents, drawings, specs, BOQ, contract conditions', 'document register + completeness gaps', 'required-document checklist per tender type', 'none', 'L2 completeness check draft', 'PARTIAL', 'tender_documents route exists; no completeness rules', 'NDC-001'),
    ('Extract contract data and risk clauses', 'Contracts manager', 'conditions of contract, particular conditions', 'Contract Data Pack draft, risk register entries', 'clause library per form (owner/legal input)', 'human validation required', 'L2 clause extraction', 'ABSENT', 'contract_clauses table only post-award', 'NDC-001'),
    ('Quantity take-off / BOQ verification', 'QS / estimator', 'drawings, models, client BOQ', 'verified quantities, discrepancies', 'measurement method (tenant configured)', 'reviewer != preparer', 'L2 QTO assist', 'PARTIAL', 'boq_master; no QTO engine (STEP18 non-claim)', 'DFS-002'),
    ('Rate build-up and pricing', 'Estimator', 'resource library, quotes, productivity norms', 'unit rates with build-up', 'rate = sum(resource qty x cost) + on-costs', 'reviewer != preparer', 'L2 rate suggestion from history', 'RUNTIME', 'boq rate-buildup (chain)', 'DFS-002'),
    ('Subcontract/supplier enquiries for pricing', 'Procurement', 'packages, vendor list', 'quotes, comparison', 'like-for-like normalisation', 'SOD15-021 evaluation vs award', 'L2 normalisation draft', 'PARTIAL', 'rfqs exist for projects, not for tenders', ''),
    ('Tender programme, resources and cash-flow', 'Planner', 'scope, durations, rates', 'tender programme, S-curve', 'CPM; cash-flow from priced programme', 'none', 'L2 programme draft', 'PARTIAL', 'planning/cpm route exists for projects only', 'NDC-010'),
    ('Risk and opportunity assessment, contingency', 'Commercial manager', 'risk register, contract data', 'priced risk, contingency', 'risk quantification method (tenant configured)', 'none', 'L1 risk suggestions', 'ABSENT', 'no risk register table', ''),
    ('Tender review and approval to submit', 'Bid board per DOA', 'tender summary, margin, risk', 'approved bid', 'DOA decision class Contract; margin floor is owner configuration', 'SOD15-021; DOA Contract', 'L0 summary', 'RUNTIME', 'tender submit-approval + DOA + SoD (chain)', ''),
    ('Submission, clarifications and negotiation', 'Commercial manager', 'clarifications, client queries', 'clarification log, revised bid', 'every client query answered with traceable revision', 'none', 'L2 response drafts', 'API', 'tender clarifications routes', ''),
    ('Award / loss decision and lessons', 'BD manager', 'award letter or loss notice', 'won/lost status, lessons', 'win/loss reasons captured', 'none', 'L1 loss analysis', 'PARTIAL', 'tender status; lessons absent', 'NDC-026'),
])
gc('GC-02', 'Award-to-Project', [
    ('Create contract from awarded tender', 'Contracts manager', 'award, final bid', 'contract record', 'contract value = awarded value incl. agreed adjustments', 'SOD15-023 drafting vs execution approval', 'L2', 'RUNTIME', 'contracts create/submit-approval (chain)', ''),
    ('Create project with codes and governance', 'Project director', 'contract', 'project, org units, roles', 'project code uniqueness per tenant', 'projects.create permission', 'L0', 'RUNTIME', 'POST /projects (chain, CC-013)', ''),
    ('Hand over estimating BOQ to execution BOQ', 'QS', 'tender BOQ + rate build-up', 'project_boq lines (contract BOQ)', 'execution BOQ total = contract value, or difference accepted with reason by independent approver', 'preparer != acceptor (CC-015)', 'L2 mapping draft', 'RUNTIME', 'CC-015 wave1_boq_handover 41/41', 'G-001'),
    ('Build WBS/CBS and cost-code mapping', 'Project controls', 'BOQ, programme', 'WBS, CBS, cost codes', 'every BOQ line maps to exactly one CBS node', 'none', 'L2 mapping draft', 'PARTIAL', 'cost_codes read-only route; no WBS entity', ''),
    ('Set control budget from estimate', 'Project controls', 'priced BOQ, risk allowance', 'budget baseline', 'budget = cost estimate + contingency; margin = contract - budget', 'SOD15-011 budget prep vs approval; DOA Budget', 'L2', 'SCHEMA', 'budgets table, no route', 'NDC-011'),
    ('Baseline programme and accepted-programme submission', 'Planner', 'tender programme, contract dates', 'baseline + submission', 'sealed snapshot; response deadline from contract', 'none', 'L2', 'RUNTIME', 'CC-024 wave2_programme 25/25', 'NDC-010'),
    ('Create procurement packages and engineering registers', 'Procurement / technical office', 'BOQ, programme', 'packages, drawing/submittal registers', 'package need-date = activity start - lead time', 'none', 'L2 package plan', 'PARTIAL', 'MR/RFQ exist; package entity absent', ''),
    ('Contract Data Pack and notice matrix activation', 'Contracts manager', 'contract', 'obligations, time-bar calendar', 'deadline per clause from Contract Data Pack', 'author != confirmer (CC-021)', 'L2 extraction', 'PARTIAL', 'CC-021 rules+confirmation; clause library per form + AI extraction pending', 'NDC-001'),
    ('Mobilisation readiness gate', 'Project director', 'permits, insurances, bonds, staff', 'go/no-go', 'all mandatory items closed or risk-accepted', 'gate approver != preparer', 'L0 checklist', 'ABSENT', 'no gate entity', 'NDC-004'),
])
gc('GC-05', 'BOQ/QTO/Estimate', [
    ('Register drawings/models/specs with revision', 'Technical office', 'issued documents', 'controlled document set', 'only current revision usable for QTO', 'none', 'L0', 'API', 'technicalOffice drawings; edms documents/versions', ''),
    ('Measure quantities', 'QS', 'drawings/models', 'quantity sheets', 'measurement rules (method configurable)', 'checker != measurer', 'L2 automated take-off', 'PARTIAL', 'site quantity_sheets (site side only)', 'DFS-002'),
    ('Write BOQ descriptions linked to specs', 'QS', 'specs, quantities', 'BOQ items', 'item description references spec clause', 'none', 'L2', 'RUNTIME', 'boq master (chain)', ''),
    ('Cost build-up per item', 'Estimator', 'resource library', 'rate build-up', 'rate arithmetic in DB', 'none', 'L2', 'RUNTIME', 'rate-buildup (chain)', ''),
    ('Pricing evidence attachment', 'Estimator', 'quotes, historical rates', 'evidence links', 'each rate above materiality has evidence (threshold configured)', 'none', 'L1', 'ABSENT', 'no evidence link on rate', ''),
    ('Estimate review and approval', 'Estimating manager', 'estimate', 'approved estimate version', 'versioned; approved estimate immutable', 'reviewer != preparer', 'L0 variance explanation', 'ABSENT', 'no estimate version entity', ''),
])
gc('GC-06', 'Procurement Package', [
    ('Raise material requisition from approved demand', 'Site/engineer', 'BOQ line, activity', 'MR', 'MR qty <= remaining BOQ qty unless flagged', 'SOD15-001', 'L2', 'RUNTIME', 'MR + approval (chain)', ''),
    ('Vendor prequalification and integrity screening', 'Procurement', 'vendor data', 'approved vendor list', 'only prequalified, active, non-blacklisted vendors can be engaged (DB-enforced)', 'creator != prequalifier; bank change requester != decider (CC-016)', 'L1 screening summary', 'PARTIAL', 'CC-016 vendor master 41/41; integrity screening (beneficial owner, sanctions) still NDC-019', 'G-002,NDC-019'),
    ('RFQ issue', 'Buyer', 'MR, vendors', 'RFQ', 'min number of bidders = tenant configuration', 'none', 'L2', 'RUNTIME', 'RFQ (chain)', ''),
    ('Receive quotations and clarify', 'Buyer', 'quotes', 'quotation records', 'sealed until bid close (configurable)', 'none', 'L2 normalisation', 'RUNTIME', 'vendor-quotations (chain)', ''),
    ('Comparative statement and recommendation', 'Buyer + technical evaluator', 'quotes', 'comparison, recommendation', 'technical compliance before price', 'SOD15-021', 'L2', 'RUNTIME', 'comparative-statements (chain)', ''),
    ('PO / subcontract approval per DOA', 'Approver per DOA', 'recommendation', 'approved PO', 'DOA class Commitment', 'SOD15-003; DOA Commitment', 'L0', 'RUNTIME', 'PO approval, wrong-role rejection (chain)', ''),
    ('PO issue and commitment', 'Buyer', 'approved PO', 'issued PO, committed cost', 'commitment = PO total (DB-computed)', 'none', 'L4 commitment posting', 'RUNTIME', 'PO issue -> committed cost (chain)', ''),
    ('Expediting and logistics', 'Expeditor', 'PO, need-dates', 'expediting log', 'late-delivery forecast vs activity need date', 'none', 'L1 delay prediction', 'ABSENT', 'no expediting entity', ''),
    ('Goods receipt', 'Storekeeper', 'delivery', 'GRN', 'received qty <= ordered qty (tolerance configured)', 'SOD15-005', 'L0', 'RUNTIME', 'GRN + idempotent confirm (chain)', ''),
    ('Invoice 3-way match and approval', 'AP clerk + approver', 'invoice, PO, GRN', 'matched invoice, AP, actual cost', 'price/qty tolerance configured', 'SOD15-005, SOD15-007', 'L2 match suggestion', 'RUNTIME', 'invoice match + approval (chain)', ''),
    ('Vendor performance evaluation', 'Procurement', 'delivery, quality, HSE records', 'vendor score', 'score formula tenant configured', 'none', 'L1', 'ABSENT', '', ''),
])
gc('GC-12', 'Contractor/Subcontractor IPC', [
    ('Subcontractor submits application with measured work', 'Subcontractor (portal)', 'measurement, evidence', 'application', 'cut-off date per subcontract', 'none', 'L2 pre-check', 'RUNTIME', 'CC-020 wave1_subcontract_ipc 22/22 (internal maker; portal path untested)', 'NDC-012'),
    ('Verify quantities against site records', 'Site engineer', 'quantity sheets, inspections', 'verified quantities', 'no quantity without accepted inspection where enforced', 'SOD15-029', 'L1 anomaly flags', 'RUNTIME', 'verify + gross=sum(lines) (CC-020)', 'NDC-012'),
    ('Apply rates, variations, materials on site', 'QS', 'subcontract rates, approved variations', 'gross valuation', 'valuation = sum(qty x rate) + approved variations + MOS', 'none', 'L2', 'RUNTIME', 'certificate lines frozen after draft (CC-020)', 'NDC-012'),
    ('Deduct retention, advance recovery, back-charges, tax', 'QS', 'subcontract terms', 'net amount due', 'retention % and caps from subcontract (no default)', 'none', 'L4 arithmetic', 'PARTIAL', 'retention_ledger table; rules unverified', 'DFS-002'),
    ('Less previous certificates', 'QS', 'certificate history', 'this-period amount', 'cumulative - previous; never negative without credit note', 'none', 'L4', 'API', '', ''),
    ('QS certification', 'QS lead', 'valuation', 'certified certificate', 'certified != paid', 'SOD15-029', 'L0', 'RUNTIME', 'qs-certify with SoD (CC-020 suite)', ''),
    ('Approval per DOA', 'Approver', 'certificate', 'approved certificate', 'DOA class Payment', 'DOA Payment', 'L0', 'RUNTIME', 'submit-approval + SoD (CC-020 suite)', ''),
    ('Post to cost and AP, schedule payment', 'Finance', 'approved certificate', 'actual cost, AP', 'cost posted once; idempotent', 'SOD15-031', 'L4', 'PARTIAL', 'cost posted on approval (basis = net; F-12/DEC-012 OPEN); AP not verified', 'DEC-012'),
])
gc('GC-13', 'Client IPC / Revenue', [
    ('Prepare valuation from approved progress', 'QS', 'measured quantities, BOQ', 'IPC draft', 'qty <= contract qty unless variation', 'SOD15-029', 'L2', 'RUNTIME', 'IPC create (chain)', 'NDC-012'),
    ('Add variations, claims (only agreed), MOS', 'QS', 'variation status', 'gross valuation', 'claims not included until agreed (STEP09)', 'none', 'L2', 'PARTIAL', 'ipc_boq_lines need project_boq (F-01)', 'G-001'),
    ('Retention and advance recovery', 'QS', 'contract terms', 'net certified amount', 'per Contract Data Pack', 'none', 'L4', 'RUNTIME', 'retention in chain (100,000 gross / 95,000 net)', ''),
    ('Internal approval and submission to client', 'Commercial manager', 'IPC', 'submitted IPC', 'DOA', 'DOA Payment', 'L0', 'RUNTIME', 'submit-to-client (chain)', ''),
    ('Client certification', 'Client (external)', 'submitted IPC', 'certified amount', 'certified amount may differ; difference tracked', 'external authority', 'L5', 'RUNTIME', 'client-approve (chain)', ''),
    ('Receivable / contract balance recognition', 'Finance', 'certified IPC', 'AR, retention receivable', 'certification != revenue (STEP09); AR = certified net', 'SOD15-015', 'L4', 'PARTIAL', 'posts net to revenue directly (F-05, DEC-009 OPEN)', 'DEC-009'),
    ('Revenue recognition per adopted policy', 'Financial controller', 'contract, costs, progress', 'revenue entry', 'policy engine (IFRS 15 profile optional); method is owner decision', 'SOD15-015', 'L1', 'ABSENT', 'no recognition engine', 'DEC-009'),
    ('Collection and cash forecast', 'Treasury', 'AR, payment terms', 'receipts, forecast', 'due date from contract payment terms', 'none', 'L1 collection risk', 'PARTIAL', 'payments, cash_flow_forecast tables', ''),
])
gc('GC-14', 'Cost & Forecast', [
    ('Collect budget, commitments, accruals, actuals', 'Project controls', 'ledgers', 'cost report base', 'each amount classified once (no double count accrual/invoice)', 'none', 'L4 aggregation', 'PARTIAL', 'committed+actual only; accruals absent', 'NDC-011'),
    ('Measure progress and earned value', 'Planner/QS', 'progress, budget', 'EV per CBS', 'EV = budget x % complete (method per item)', 'none', 'L4', 'PARTIAL', 'evm_snapshots table; method rules absent', 'NDC-012'),
    ('Estimate cost to complete', 'Cost engineer', 'remaining qty, rates, risks', 'ETC per CBS', 'ETC by remaining qty x forecast rate or by trend; method recorded', 'reviewer != preparer', 'L2 ETC suggestion', 'API', 'cost forecasts route', 'NDC-011'),
    ('Compute EAC and variances', 'Cost engineer', 'actual + ETC', 'EAC, VAC, CPI', 'EAC = AC + ETC; reproducible from stored inputs', 'none', 'L4', 'PARTIAL', 'dashboards cost-control', 'NDC-011'),
    ('Forecast review and approval', 'Project director', 'forecast pack', 'approved forecast', 'unexplained variance blocks approval (threshold configured)', 'SOD15-011', 'L1 variance narrative', 'ABSENT', 'no forecast approval', ''),
])
gc('GC-15', 'Variation / Change', [
    ('Capture instruction/RFI/design change/event', 'Site/technical office', 'instruction, RFI, revision', 'change event', 'every instruction logged with date received; linked, never auto-converted', 'none', 'L1 classify as potential change', 'RUNTIME', 'CC-021 events + CC-023 links', 'NDC-002'),
    ('Notify within contractual period', 'Contracts manager', 'change event, Contract Data Pack', 'notice with proof of delivery', 'deadline from clause; internal approval never delays notice', 'rule author != confirmer (CC-021)', 'L2 notice draft', 'RUNTIME', 'CC-021 wave2_notice_engine 36/36', 'NDC-001'),
    ('Assess scope/qty/cost/time impact', 'QS + planner', 'event, BOQ, programme', 'impact assessment', 'rates from contract, else agreed method', 'none', 'L2', 'PARTIAL', 'variation_boq_lines', 'NDC-006'),
    ('Prepare and submit variation quotation', 'QS', 'assessment', 'variation submission', 'cost impact = lines; lines frozen after submission', 'SOD15-025', 'L2', 'RUNTIME', 'CC-025 sweep_variations 20/20', ''),
    ('Negotiate and agree', 'Commercial manager / client', 'submission', 'agreed valuation', 'internal approval != client agreement (STEP09)', 'DOA Variation; external', 'L1', 'RUNTIME', 'CC-025 client-submission/decision', ''),
    ('Update budget, programme, procurement, forecast', 'Project controls', 'agreed variation', 'revised baselines', 'budget change via controlled transfer', 'SOD15-013', 'L4 propagate', 'PARTIAL', 'CC-025 applies to execution BOQ + contract value; budget/programme/forecast propagation absent', ''),
])
gc('GC-16', 'Claim / EOT Case', [
    ('Notice of claim within time bar', 'Contracts manager', 'event', 'notice + proof', 'time bar from Contract Data Pack', 'rule author != confirmer', 'L2', 'RUNTIME', 'CC-021 wave2_notice_engine 36/36', 'NDC-001'),
    ('Build chronology from contemporaneous records', 'Claims analyst', 'diaries, correspondence, RFIs', 'chronology', 'every entry links to source record', 'none', 'L2 chronology draft with citations', 'PARTIAL', 'CC-030: claim linked to contract event + notice (E1); chronology entity absent', 'NDC-014'),
    ('Contractual entitlement analysis', 'Contracts manager / legal', 'contract, chronology', 'entitlement position', 'clause references; human legal authority', 'L5 legal opinion external', 'L1', 'PARTIAL', 'CC-034: time-bar position recorded by a human before submission; Engineer determination / NOD / DAAB ladder (E1); entitlement analysis entity absent', 'NDC-006'),
    ('Delay analysis against accepted programme', 'Planning expert', 'accepted programme, updates', 'delay analysis', 'method chosen and justified; uses accepted programme', 'none', 'L2', 'ABSENT', 'STEP18 non-claim', 'NDC-006,NDC-010'),
    ('Quantum', 'QS', 'records, rates', 'quantum', 'heads of claim, no double recovery', 'SOD15-027', 'L2', 'ABSENT', '', 'NDC-006'),
    ('Submit, negotiate, determine', 'Commercial director', 'claim', 'determination / settlement', 'settlement never erases original entitlement (STEP09); determination <= claim with reasoning; decision with reason', 'SOD15-027 author != determiner != deciding party', 'L0', 'RUNTIME', 'CC-030 sweep_claims 25/25; EOT propagation absent (NDC-029)', 'NDC-029'),
])
gc('GC-25', 'Corporate Month-End', [
    ('Cut-off and accrual of received-not-invoiced', 'Accountant', 'GRNs, timesheets', 'accrual journals', 'GRNI accrual reverses on invoice', 'SOD15-015', 'L4 proposal', 'ABSENT', 'no accrual logic', 'NDC-011'),
    ('Subledger to GL reconciliation', 'Accountant', 'AP, AR, cost ledger, GL', 'reconciliation with differences', 'control totals equal or explained', 'SOD15-017', 'L2 matching', 'PARTIAL', 'runtime-validation posting-readiness; F71 not built', 'NDC-011'),
    ('Bank reconciliation', 'Treasury', 'bank statements', 'reconciliation', 'unreconciled items aged', 'SOD15-019', 'L2 matching', 'SCHEMA', 'bank_reconciliation table', ''),
    ('Project cost and revenue alignment', 'Financial controller', 'project reports', 'WIP/contract balances', 'revenue policy per DEC-009', 'none', 'L1', 'ABSENT', '', 'DEC-009'),
    ('Management reporting snapshot', 'Financial controller', 'ledgers', 'KPI snapshot', 'data-as-of frozen', 'none', 'L1 narrative', 'PARTIAL', 'reports routes', ''),
    ('Period lock', 'Finance manager', 'checklist', 'locked period', 'no posting into locked or undefined period', 'closer != reopener (CC-022)', 'L0', 'RUNTIME', 'CC-022 hostile_concurrency 17/17', 'G-010'),
])

# ---------------------------------------------------------------- engineering / site / quality
gc('GC-03', 'Drawing/Model Technical Review', [
    ('Register drawing/model and revision context', 'Document controller', 'transmittal', 'controlled revision', 'revision sequence enforced', 'unique doc number per project; versions immutable (CC-029)', 'L0', 'RUNTIME', 'CC-029 sweep_edms 24/24 (edms documents/versions)', ''),
    ('Discipline and interdisciplinary checks', 'Discipline engineer', 'drawing, standards, spec', 'issues with evidence', 'applicable standard from register (not latest by default)', 'SOD15-051', 'L2 check assist (no approval)', 'ABSENT', 'no review-issue entity', 'NDC-027'),
    ('Engineer disposition and markup', 'Responsible engineer', 'issues', 'review status code', 'disposition codes tenant configured', 'SOD15-051 uploader != reviewer (CC-029)', 'L5 professional judgement', 'PARTIAL', 'CC-029 EDMS + CC-031 drawing register decisions with comments, one current approved revision (E1); markup absent', ''),
    ('Issue controlled review report', 'Document controller', 'disposition', 'report/transmittal', 'issued output immutable; for-construction only approved current revisions (CC-029)', 'maker != issuer', 'L2', 'RUNTIME', 'CC-029 sweep_edms transmittals', ''),
])
gc('GC-04', 'Design Revision Impact', [
    ('Detect new revision', 'Document controller', 'revision', 'change event', 'superseded revision flagged everywhere used', 'none', 'L4 notify', 'PARTIAL', 'document_versions', ''),
    ('Trace affected quantities, BOQ, activities, POs, inspections', 'Technical office', 'links graph', 'impact list', 'requires document-to-object links', 'none', 'L1 impact list', 'ABSENT', 'no cross-object link model', 'DFS-006'),
    ('Raise change/variation where entitled', 'Contracts manager', 'impact list', 'change event (GC-15)', 'notice obligations apply', 'none', 'L2', 'ABSENT', '', 'NDC-001'),
])
gc('GC-07', 'Site Daily Control', [
    ('Record manpower, equipment, weather, work fronts', 'Site engineer', 'site observations', 'daily diary', 'mandatory fields enforced at signing', 'none', 'L2 from voice/photos', 'RUNTIME', 'CC-023 structured diary', 'NDC-014'),
    ('Record quantities and progress', 'Site engineer', 'measurements', 'quantity sheets, progress', 'qty linked to BOQ/activity', 'checker != measurer', 'L2', 'API', 'quantity-sheets; planning progress', 'NDC-012'),
    ('Record instructions, constraints, issues', 'Site engineer', 'events', 'instructions/constraints', 'impact flag creates a contract event for commercial review', 'none', 'L1 impact flag', 'RUNTIME', 'CC-023 impact -> contract event', 'NDC-014'),
    ('Sign off and freeze daily report', 'Site manager', 'diary', 'immutable report', 'corrections as amendments', 'signer != preparer (CC-023)', 'L0', 'RUNTIME', 'CC-023 wave2_daily_record_changes 29/29', 'NDC-014'),
])
gc('GC-08', 'QA/QC Inspection', [
    ('Raise inspection request with references', 'Site engineer', 'ITP, drawing rev', 'IR', 'only current revision referenced', 'SOD15-055 requester != result recorder (CC-026)', 'L0', 'RUNTIME', 'CC-026 sweep_quality_hse 20/20', ''),
    ('Inspect/test with accredited lab where needed', 'QC inspector', 'IR, lab results', 'results', 'lab within accredited scope', 'SOD15-055', 'L0', 'PARTIAL', 'no lab register', 'NDC-015'),
    ('Accept / reject / raise NCR', 'QC inspector', 'results', 'status, NCR', 'result immutable once recorded', 'SOD15-057', 'L1', 'RUNTIME', 'CC-026 suite', ''),
    ('Corrective action and verification', 'QC manager', 'NCR', 'closed NCR', 'closure by someone other than raiser', 'SOD15-057', 'L1 root-cause suggestion', 'RUNTIME', 'CC-026 suite', 'NDC-026'),
    ('Consequences to progress/payment/handover', 'QS', 'NCR status', 'blocked quantities', 'open NCR blocks payment of affected qty (configurable)', 'none', 'L4', 'ABSENT', '', 'NDC-012'),
])
gc('GC-09', 'HSE Control', [
    ('Hazard identification and risk assessment', 'HSE engineer', 'method statement, activity', 'risk assessment / JSA', 'workers consulted (ISO 45001)', 'none', 'L2 hazard suggestions', 'PARTIAL', 'method statements; no JSA', 'NDC-016'),
    ('Permit to work', 'Permit issuer', 'JSA, competencies', 'active permit', 'issuer != receiver; not activatable after expiry; competencies valid on date (pending NDC-005)', 'issuer != receiver', 'L0', 'RUNTIME', 'CC-026 suite (competency link absent)', 'NDC-005'),
    ('Inspections, observations, toolbox talks', 'HSE officer', 'site', 'records', 'none', 'none', 'L1', 'API', 'toolbox-talks', ''),
    ('Incident report and investigation', 'HSE manager', 'incident', 'investigation, actions', 'sensitive data restricted; regulator notification flag', 'reporter != closer', 'L1', 'RUNTIME', 'CC-026 suite (restriction/notification flags absent)', ''),
    ('Stop-work and near-miss without retaliation', 'Any worker', 'hazard', 'stop-work record', 'anonymous option', 'none', 'L0', 'ABSENT', '', 'NDC-016'),
])
gc('GC-10', 'Weekly/Monthly Project Report', [
    ('Freeze data-as-of', 'Project controls', 'all modules', 'snapshot', 'snapshot immutable', 'none', 'L4', 'ABSENT', 'reports are live queries', ''),
    ('Reconcile across modules', 'Project controls', 'snapshot', 'exceptions', 'cost vs GL vs progress reconciled', 'none', 'L2', 'ABSENT', '', 'NDC-011'),
    ('Calculate KPIs and explain variances', 'Project manager', 'snapshot', 'KPI + narrative', 'KPI definitions from dictionary', 'none', 'L2 narrative with citations', 'PARTIAL', 'reports weekly-executive', ''),
    ('Approve report pack', 'Project director', 'draft pack', 'approved pack', 'approver != author', 'none', 'L0', 'ABSENT', '', ''),
])
gc('GC-11', 'Delay & Recovery', [
    ('Detect schedule variance', 'Planner', 'updates', 'variance list', 'float erosion thresholds configured', 'none', 'L4 detect', 'PARTIAL', 'planning cpm route (unverified)', ''),
    ('Validate update data quality', 'Planner', 'update', 'schedule health result', 'health checks (logic, constraints, dates)', 'none', 'L2', 'PARTIAL', 'logic loops refused (CC-024); other health checks absent', 'NDC-010'),
    ('Analyse critical path and causes', 'Planner', 'network', 'analysis', 'CPM correctness tested', 'none', 'L2', 'PARTIAL', 'CPM verified vs hand calculation (CC-024); cause analysis absent', 'NDC-006'),
    ('Recovery scenarios with cost/cash impact', 'Planner + cost engineer', 'analysis', 'scenarios', 'scenario never overwrites baseline', 'none', 'L2', 'ABSENT', '', ''),
    ('Management approval and controlled replan', 'Project director', 'scenario', 'approved revision', 'baseline change controlled', 'none', 'L0', 'PARTIAL', 'baseline set-current route', ''),
])
gc('GC-17', 'Material Lifecycle', [
    ('Technical requirement and submittal', 'Engineer', 'spec', 'submittal', 'submittal approved before PO for listed items', 'SOD15-053', 'L2 compliance check', 'PARTIAL', 'CC-031: submittal review cycles with comments/history runtime-tested (E1); approved-submittal-before-PO gate absent', ''),
    ('Procure (GC-06)', 'Procurement', 'approved submittal', 'PO', 'see GC-06', 'see GC-06', 'L2', 'RUNTIME', 'chain', ''),
    ('Receive, inspect, store', 'Storekeeper + QC', 'delivery', 'GRN, MIR, stock', 'stock by warehouse', 'none', 'L0', 'PARTIAL', 'GRN in chain; inventory routes unverified', ''),
    ('Issue to work front and install', 'Storekeeper', 'MR', 'issue transaction', 'issued qty <= stock', 'SOD15-059', 'L0', 'API', 'inventory transactions', ''),
    ('Link to installed asset and handover', 'Engineer', 'installation record', 'asset record', 'traceability to batch/certificate', 'none', 'L0', 'ABSENT', '', ''),
])
gc('GC-20', 'Commissioning-to-Handover', [
    ('Define systems and readiness criteria', 'Commissioning manager', 'design', 'system register', 'gate sequence MC->pre-comm->energise->functional->integrated->performance', 'none', 'L1', 'ABSENT', '', 'NDC-004'),
    ('Execute test packs', 'Commissioning engineer', 'test packs', 'results', 'witness by client where required', 'SOD15-049', 'L0', 'ABSENT', '', 'NDC-004'),
    ('Punch list management', 'Site engineer', 'walkdowns', 'punch items', 'category A blocks handover', 'none', 'L1', 'API', 'punch-list routes', ''),
    ('Handover dossier completeness', 'Document controller', 'as-builts, O&M, warranties', 'dossier', 'completeness checklist per system', 'none', 'L2 completeness check', 'ABSENT', '', 'NDC-023'),
    ('Handover, DLP, final account', 'Project director', 'dossier', 'taking-over, DLP register', 'retention release per contract', 'DOA Payment', 'L0', 'ABSENT', '', ''),
])
gc('GC-28', 'Asset Traceability', [
    ('Select asset/location/model element', 'Any authorised user', 'asset id', 'asset view', 'permissions per object', 'none', 'L0', 'PARTIAL', 'assets_equipment is plant, not installed assets', ''),
    ('Show linked design, material, inspection, cost, warranty history', 'Any authorised user', 'link graph', 'trace view', 'derived read model, not SoT', 'none', 'L0', 'ABSENT', '', 'DFS-006'),
])

# ---------------------------------------------------------------- management / platform
gc('GC-18', 'Executive Portfolio Review', [
    ('Standard KPI semantic layer across projects', 'PMO', 'project snapshots', 'portfolio KPIs', 'one KPI dictionary', 'none', 'L0', 'PARTIAL', 'dashboards executive/portfolio', ''),
    ('Data quality and freshness indicators', 'PMO', 'snapshots', 'quality flags', 'stale data visibly flagged', 'none', 'L4', 'ABSENT', '', ''),
    ('Drill-through and decisions/actions', 'Executive', 'KPIs', 'decisions, actions', 'decision log', 'none', 'L1', 'ABSENT', '', ''),
])
gc('GC-19', 'Resource / Manpower Planning', [
    ('Demand from programmes', 'Resource manager', 'resource-loaded schedules', 'demand curve', 'by skill and period', 'none', 'L2', 'ABSENT', '', ''),
    ('Supply: people, skills, equipment availability', 'HR / plant', 'employees, competencies, equipment', 'supply', 'only valid competencies counted', 'none', 'L0', 'PARTIAL', 'employees, assets', 'NDC-005'),
    ('Allocate, mobilise, track utilisation and cost', 'Resource manager', 'allocation', 'assignments, utilisation', 'time posts to cost', 'none', 'L2', 'PARTIAL', 'timesheets/equipment usage post-cost routes', ''),
])
gc('GC-21', 'Ask-the-Business', [
    ('Resolve identity, tenant, permissions', 'System', 'question', 'scoped context', 'RLS + permissions apply to retrieval', 'none', 'L0', 'PARTIAL', 'knowledge queries table; no permission-scoped retrieval verified', ''),
    ('Retrieve authoritative records and cite', 'System', 'records, knowledge chunks', 'answer with citations', 'facts vs calculations vs inference labelled', 'none', 'L0', 'PARTIAL', 'knowledge sources/chunks/queries routes', 'DFS-006'),
    ('Offer permitted next action', 'System', 'answer', 'action proposal', 'action executes through normal approval path', 'per action', 'L1-L3', 'ABSENT', '', 'DFS-005'),
])
gc('GC-22', 'Create/Modify a Business Process', [
    ('Describe form/workflow/rules', 'Process admin', 'requirement', 'process definition draft', 'cannot weaken protected controls (SoD, DOA, audit)', 'SOD15-039 analogue', 'L2', 'ABSENT', 'automation workflows are a registry only', ''),
    ('Sandbox test, approve, publish version, rollback', 'Process owner', 'draft', 'published version', 'versioned; rollback available', 'author != approver', 'L0', 'ABSENT', '', ''),
])
gc('GC-23', 'Create a Specialized AI Skill/Agent', [
    ('Define agent scope, tools, permissions, evaluation', 'AI owner', 'need', 'agent manifest', 'tools limited to caller permissions', 'author != approver', 'L2', 'PARTIAL', 'ai_agents, ai_tools, agent-tools route', 'NDC-009'),
    ('Benchmark evaluation and governance review', 'Independent verifier', 'manifest, benchmark', 'evaluation result', 'pass criteria defined before test', 'SOD15-049', 'L0', 'PARTIAL', 'ai_evaluations route', 'NDC-009'),
    ('Publish, monitor, rollback', 'AI owner', 'approved agent', 'live version', 'cost/quality/latency monitored', 'none', 'L4 monitoring', 'ABSENT', '', 'NDC-009'),
])
gc('GC-24', 'Import Legacy Data', [
    ('Profile and map source', 'Implementation consultant', 'source files', 'mapping', 'mapping versioned', 'none', 'L2 mapping suggestion', 'ABSENT', '', ''),
    ('Validate, match master data, preview errors', 'Implementation consultant', 'mapped data', 'error report', 'no import with blocking errors', 'none', 'L2', 'ABSENT', '', ''),
    ('Controlled import and reconciliation with lineage', 'Data owner', 'validated data', 'imported records + control totals', 'control totals source = target', 'loader != approver', 'L3', 'ABSENT', '', 'NDC-011'),
])
gc('GC-26', 'Risk-to-Action', [
    ('Identify and assess risk/opportunity', 'Risk owner', 'project data', 'risk register entry', 'probability/impact scales configured', 'none', 'L1 risk suggestions', 'ABSENT', 'no risk table', ''),
    ('Response, owner, due date, links', 'Risk owner', 'risk', 'actions', 'linked to cost/schedule/contract', 'none', 'L1', 'ABSENT', '', ''),
    ('Monitor triggers, escalate, close, lesson', 'PM', 'triggers', 'closure + lesson', 'lesson feeds knowledge loop', 'none', 'L1', 'ABSENT', '', 'NDC-026'),
])
gc('GC-27', 'Field-to-Office Offline Workflow', [
    ('Download authorised field package', 'Field user', 'assignment', 'offline package', 'only permitted data', 'none', 'L0', 'ABSENT', 'no offline client', ''),
    ('Capture offline, queue signed operations', 'Field user', 'observations', 'queued ops', 'ops signed and ordered', 'none', 'L0', 'ABSENT', '', ''),
    ('Reconnect, resolve conflicts, update with audit', 'System + user', 'queue', 'authoritative records', 'conflict never silently overwrites', 'none', 'L4', 'ABSENT', 'STEP18 offline_reconnect contract available as reference', ''),
])
gc('GC-29', 'Company Configuration (Mishel DNA)', [
    ('Configure terminology, templates, checklists, formulas, workflows', 'Tenant admin', 'company standards', 'config version', 'five configuration layers; precedence from STEP03', 'author != approver', 'L2', 'PARTIAL', 'system_settings, roles, DOA rows', 'DFS-003'),
    ('Test, publish, apply by company/project/jurisdiction, track exceptions', 'Tenant admin', 'config', 'active config', 'exceptions recorded', 'none', 'L0', 'ABSENT', '', ''),
])
gc('GC-30', 'New Jurisdiction / Client Configuration', [
    ('Create jurisdiction/client pack (tax, units, language, templates, authority rules)', 'Tenant admin + legal', 'references', 'pack draft', 'no invented legal values; sources cited', 'author != approver', 'L2 with citations', 'ABSENT', 'currencies/exchange_rates only', 'NDC-003,NDC-027'),
    ('Validate, approve, apply to projects', 'Compliance owner', 'pack', 'active pack', 'effective-dated', 'none', 'L0', 'ABSENT', '', ''),
])
gc('GC-31', 'Tenant Onboarding-to-Go-Live', [
    ('Commercial entitlement (plan, subscription)', 'Vendor sales ops', 'contract', 'entitlement', 'pricing is owner decision', 'Owner', 'L0', 'PARTIAL', 'subscription_plans, tenant_subscriptions', 'DFS-004'),
    ('Provision tenant with templates (roles, CoA, GL rules, cost codes, periods, DOA structure)', 'Vendor ops', 'entitlement', 'ready tenant', 'not via global bootstrap token (F-08)', 'provisioner != approver', 'L4 scripted', 'ABSENT', 'F-03/F-08', 'G-003,G-006'),
    ('Identity, configuration, migration, integrations', 'Customer admin', 'tenant', 'configured tenant', 'see GC-29/24/36', 'none', 'L2', 'PARTIAL', 'users/roles routes', ''),
    ('Go/no-go, cutover, hypercare', 'Customer + vendor', 'readiness', 'live tenant', 'readiness checklist', 'none', 'L0', 'ABSENT', 'customer_onboarding table', ''),
])
gc('GC-32', 'Security Incident-to-Recovery', [
    ('Detect and triage', 'Security operations', 'signals', 'incident', 'severity matrix', 'none', 'L1', 'ABSENT', 'audit_log only', ''),
    ('Contain: revoke tokens/keys/sessions', 'Incident authority', 'incident', 'containment record', 'token revocation per tenant/user', 'SOD15-041', 'L3', 'PARTIAL', 'user/role deactivation takes effect on next request (authenticate.ts reloads user each call); no per-session token revocation or signing-key rotation', 'G-013'),
    ('Forensics, legal assessment, recovery, review', 'Incident authority', 'evidence', 'post-incident report', 'evidence preserved', 'none', 'L1', 'ABSENT', '', ''),
])
gc('GC-33', 'Product Change-to-Release-to-Rollback', [
    ('Change with impact and tests', 'Engineering', 'requirement', 'PR + evidence', 'CI runtime gate must pass', 'SOD15-047', 'L2', 'RUNTIME', 'runtime-gate CI PG16/17 (CC-014)', ''),
    ('Release, verify, rollback', 'Release manager', 'candidate', 'deployed version', 'forward migrations only; rollback plan per CC', 'SOD15-045', 'L0', 'ABSENT', 'no deployment pipeline', ''),
])
gc('GC-34', 'Disaster-Recovery-to-Reopening', [
    ('Restore authoritative store', 'Ops', 'backups', 'restored DB', 'RPO/RTO are owner-approved targets', 'SOD15-043', 'L3', 'ABSENT', 'no backup/restore', ''),
    ('Reconcile, replay checks, duplicate-effect scan, reopen', 'Ops + business', 'restored data', 'reopening decision', 'idempotency keys prevent duplicate effects', 'none', 'L1', 'ABSENT', '', ''),
])
gc('GC-35', 'Privacy / Retention Lifecycle', [
    ('Classify processing purpose and data', 'Data protection owner', 'data inventory', 'ROPA', 'lawful basis recorded', 'none', 'L1', 'ABSENT', '', ''),
    ('Retention, legal hold, data-subject requests, export/deletion', 'Data protection owner', 'request', 'fulfilment evidence', 'no false erasure claims; legal hold wins', 'none', 'L2', 'ABSENT', '', 'NDC-023'),
])
gc('GC-36', 'Connector Lifecycle', [
    ('Contract, sandbox, certify connector', 'Integration owner', 'need', 'certified connector', 'schema + security scope', 'none', 'L2', 'PARTIAL', 'integration_connections, webhook_subscriptions', ''),
    ('Monitor, version, revoke', 'Integration owner', 'connector', 'health/revocation', 'reconciliation after incident', 'none', 'L4', 'ABSENT', '', ''),
])
gc('GC-37', 'Recruit-to-Develop-to-Exit', [
    ('Approved demand and recruitment', 'HR', 'requisition', 'candidate pipeline', 'fair recruitment checks', 'none', 'L2 screening (human decides)', 'PARTIAL', 'recruitment table', 'NDC-021'),
    ('Hire without duplicate identity, onboard', 'HR', 'offer', 'employee', 'one person = one identity', 'SOD15-035', 'L0', 'PARTIAL', 'CC-028: employee create/terminate runtime-tested (E1); duplicate-identity (national id) check absent', ''),
    ('Competency, learning, performance', 'HR + manager', 'records', 'competency/performance records', 'calibration and appeal', 'none', 'L1', 'ABSENT', '', 'NDC-005,NDC-022'),
    ('Time, payroll, cost', 'Payroll', 'timesheets', 'payroll run, cost', 'payroll posts to project cost (basis DEC-013 open); lines frozen after submission; employed same-org staff only', 'SOD15-033 submitter != approver', 'L4', 'RUNTIME', 'CC-028 sweep_hr_payroll 43/43 (timesheets, payroll, approval, post-cost)', ''),
    ('Exit with access revocation and final settlement', 'HR + IT', 'resignation', 'exit record', 'access removed same day', 'SOD15-037', 'L4', 'PARTIAL', 'user status route', ''),
])
gc('GC-38', 'Enterprise Architecture Transformation', [
    ('Capability need and application inventory', 'Enterprise architect', 'strategy', 'inventory, assessment', 'no duplicate of CMDB', 'none', 'L1', 'ABSENT', '', ''),
    ('Target architecture, roadmap, waivers, conformance review', 'Architecture board', 'assessment', 'roadmap', 'waivers recorded', 'none', 'L1', 'ABSENT', '', ''),
])

COLS = ['gc', 'gc_title', 'step', 'activity', 'actor_role', 'inputs', 'outputs', 'rule_decision_calc', 'control', 'ai_autonomy', 'code_status', 'code_evidence', 'links', 'test_id']

def main():
    os.makedirs('governance/decomposition', exist_ok=True)
    rows = []
    for code in sorted(GC):
        title, steps = GC[code]
        for i, s in enumerate(steps, 1):
            rows.append(dict(zip(COLS, [code, title, i, *s, f'T-{code}-{i:02d}'])))
    with open('governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    from collections import Counter
    print(len(GC), 'cases', len(rows), 'steps', Counter(r['code_status'] for r in rows))

if __name__ == '__main__':
    main()
