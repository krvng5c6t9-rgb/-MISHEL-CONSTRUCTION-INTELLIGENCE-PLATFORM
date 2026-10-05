# R02 — contractor_os_manual v2.3 Activation Pack (operating model)

Sources read (content): 01, 02, 03, 14, 15, 30 and 36 in full; 04 and 34 parsed in full (159 rows each); all 30 SOPs parsed; SOP-02 and SOP-16 read in full.

## What is valuable (adopt as input baseline)
- **Enterprise structure.** Board → Chairman → CEO → COO/CFO/CTO/CCO/CBO/CHRO/CIO/GC + Corporate QA/QC, HSE, Risk/IA → BUs → Projects → Sites. Project governance roles: PD accountable, PM executes, Technical, Commercial, Controls, and QA/QC + HSE with independent stop-work.
- **Discipline catalog.** About 70 disciplines in 4 groups: Buildings, MEP/ELV, Infrastructure, Delivery & Controls. The rule for omitted disciplines is "keep the competence as a discipline responsibility with an approved reviewer".
- **Position taxonomy.** 159 positions, 9 families, 5 levels (Board, C-suite/Director, Manager, Professional, Operational), with reporting lines.
- **Value chain.** Lead → Qualify → Bid/No-Bid → Estimate → Tender approval → Contract review → Mobilize → Plan → Design/Procure/Build → Test → Handover → Final account → Lessons learned.
- **Committees.** 9: Tender, Contract Review, CCB, Project Review, Quality Review, HSE, Capex, Audit & Risk, Knowledge/AI.
- **DOA structure** (deliberately without amounts).
  - Each decision row records: requestor, technical, commercial, legal and finance reviewers, approver, second signatory, threshold currency/amount, emergency rule, evidence and audit trail.
  - It covers 16 decision families.
  - Rules: no request splitting, emergency approval still requires post-review, and overrides are reported monthly.
  - **This matches the owner decision on DOA and is adopted as the DOA data model target.**
- **Controls, KPIs and RACI.**
  - 12-control library (C-001…C-012), each with objective, activity, owner, frequency, evidence, test method and escalation.
  - KPI record schema plus core formula definitions.
  - Baseline RACI with 10 activities × 10 roles and the rule of a single "A" per activity.
- **Process skeleton.** 30 SOPs → 166 named steps, extracted to `SOP_STEP_SKELETON_166.csv`.
- **Templates.** 15 governed artefacts: charter, contract summary, risk register, RFI, submittal, method statement, ITP, NCR/CAR, variation, claim/EOT, procurement log, monthly report, incident, commissioning pack, document register.

## What is templated (not usable as work specification) (E1)
| Artefact | Distinct texts across 159 job descriptions |
|---|---|
| Daily duties | 4 |
| Weekly/monthly duties, authority, interfaces, competencies, risks/controls, career path | 1 each |
| Deliverables and KPIs | 9 each (one per family) |

- Example: Estimator, QS, Senior QS and Lead QS have identical deliverables.
- All 30 SOPs share identical inputs, control points, outputs, exceptions, KPIs and acceptance checklist; only the step titles differ.

## Cross-document gaps found (→ discovery register)
- **Disciplines without positions.** The discipline catalog names disciplines with no position in the 159-position catalog. Examples: Façade, Geotechnical (one engineer only), Vertical Transportation, Acoustics, Bridges, Rail/Transit, Tunnelling, Traffic, GIS/Geomatics (survey assistant only), Utilities, Pump stations/treatment plants, Sustainability/energy modelling, Temporary Works, Testing & Commissioning per MEP system.
- **Operational and financial roles missing from the positions catalog.** Land surveyor, crane/plant operators, riggers, scaffolders, welders, mechanics/plant maintenance, payroll, AP/AR/tax accountants, credit control, camp/medical, drivers.
- **RACI and DOA mismatch.** The RACI covers 10 activities, while the DOA lists 16 decision families and the SOPs 30 processes. The RACI needs extending to every SOP step that has a decision.

## Consequence
Use this pack as the **organisational skeleton**: structure, positions, disciplines, value chain, committees, the DOA and control data models, KPI governance and the template list. The **work content** for each position and step (inputs, calculations, decisions, outputs, tools, data, controls, agents) must be produced by first-principles decomposition (task 4), with each item traced to this skeleton.
