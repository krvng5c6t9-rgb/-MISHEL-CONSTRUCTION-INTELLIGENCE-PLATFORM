# MP-02 — Process architecture: every department's processes, cycles, steps and links

Master Plan part 2 of 7 (OVD-001, OQS-001). Builds on MP-01 (owners are MP-01 positions).

## 0. How to read
- **ID** `Dnn.mm` = domain.process. **Owner** = accountable MP-01 position. **Steps** use P (prepare) → R (review /
  recommend) → A (approve within the company's DOA); "sys" = deterministic system rule; "AI" = agent draft / check
  (never A).
- **Feeds →** lists the processes whose data changes when this one completes (the propagation graph, section 26).
- **GC** = the Golden Case in `governance/decomposition/GOLDEN_CASE_DECOMPOSITION.csv` covering the process; its
  step statuses (RUNTIME / PARTIAL / ABSENT …) are gate-checked by `gc_status_check.py` (E1/E2). "—" = no Golden Case
  yet: **code coverage not yet assessed** (assessment and build order are MP-07); no claim either way is made here.
- Values (DOA limits, rates, percentages, periods, thresholds) are company or contract configuration, never set here.

## 1. D01 Governance, strategy and policy
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D01.01 | Strategic plan | CEO / Managing Director | Annual / strategy cycle | Strategy Mgr P → CEO R → Board A | Strategy, targets | Board approval | D01.02, D23.01 | Market & portfolio analysis | — |
| D01.02 | Annual budget and business plan | CFO | Fiscal year start | FP&A P (by unit / project) → CFO R → CEO R → Board A | Approved budget | Approved version locked; actuals compared to it | D16.17, D23.01 | Scenario modelling | — |
| D01.03 | Delegation of authority (DOA) set-up and change | CEO / Managing Director | New company / policy change | MISHEL Admin P → CFO & General Counsel R → Board A | DOA matrix version | Versioned, SoD: proposer ≠ confirmer | All approval steps | Conflict / gap check of the matrix | GC-29 |
| D01.04 | Policy and procedure management | QHSE Director | New / revised policy | Owner unit P → QA Engineer R → Director A | Controlled procedures | Version + distribution record | All processes using the procedure | Drafting, gap check vs ISO | GC-22 |
| D01.05 | Enterprise risk management | Board Risk Committee | Quarterly / major event | Risk Mgr P → CEO R → Board Risk Committee A | Enterprise risk register | Owner + due date per risk | D23.01 | Risk extraction from portfolio data | GC-26 |
| D01.06 | Company configuration (entities, branches, calendars, numbering, currencies, taxes) | IT & Digital Director (CIO) | Onboarding / change | MISHEL Admin P → owner unit R → CIO A | Configuration version | Exceptions recorded, rollback | Everything | Configuration check | GC-29, GC-30, GC-31 |
| D01.07 | Board and general assembly cycle | Board Secretary / Company Secretary | Calendar | Secretary P → Chairman R → Board / GA A | Minutes, resolutions | Statutory registers | D01.02 | Board pack | — |
| D01.08 | Internal audit plan and audits | Head of Internal Audit | Annual plan / risk | Auditor P → Head R → Audit Committee A | Audit reports, findings | Independence | D24.01 | Exception sampling | — |
| D01.09 | Sustainability / ESG and green-building reporting | Sustainability / ESG Manager | Project requirement / annual | ESG Mgr P → QHSE Director R → CEO A | Green submittals, ESG report | Data from operational records only | D06.06, D23.01 | Carbon and material impact calc | — |

## 2. D02 Business development and CRM
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D02.01 | Lead / opportunity capture | BD Manager | Tender notice, client contact, portal | BD P → BD Director R | Opportunity record | Duplicate check | D02.04 | Extraction from tender portals / news | GC-01 |
| D02.02 | Client, consultant and partner master data | BD Manager | New party | BD P → Finance R (credit) → A per DOA | Party record | Unique identity, sanctions / credit check | D03.*, D15.*, D16.* | Data enrichment | — |
| D02.03 | Prequalification submission | Prequalification Coordinator | Prequal request | Coordinator P → BD Director R → CEO A (signature) | Prequal pack | Certificates valid | D02.04 | Auto-fill from company data | — |
| D02.04 | Initial go / no-go | Business Development Director | Opportunity qualified | BD P → Tender / Bid Committee A | Decision record | Criteria per company | D03.01 | Opportunity scoring | GC-01 |
| D02.05 | Key account and relationship management | Key Account Manager | Ongoing | KAM P → BD Director R | Account plan, visits | — | D23.01 | Client history summary | — |
| D02.06 | Marketing and communications | Marketing & Communications Specialist | Plan / campaign | P → BD Director A | Campaigns, content | Brand rules | D02.01 | Content drafting | — |
| D02.07 | JV / consortium formation | Strategy & Corporate Development Manager | Tender requires partner | Strategy P → General Counsel R → Board A | JV agreement | Legal review | D01.06, D03.* | Partner analysis | — |

## 3. D03 Tendering and estimating
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D03.01 | Tender receipt and registration | Tender Document Controller | Tender documents received | Controller P (register, completeness) → Tendering Mgr R | Tender register, document set | Completeness check | D03.02 | Classification, completeness gaps | GC-01 |
| D03.02 | Tender study (documents, contract, specs, BOQ, drawings, site) | Tendering Manager | Registered tender | Team P (section reviews, site visit report) → Tendering Mgr R | Tender study report, risk list | Every section reviewed and signed | D03.03–D03.11 | Tender study agent: gaps, conflicts, risks | GC-01 |
| D03.03 | Tender queries and addenda | Tendering Manager | Gap / ambiguity | QS / Estimator P query → Tendering Mgr A send; addenda logged | Query log, addenda register | Every query answered with traceable revision | D03.04, D03.05, D03.06 | Query drafting | GC-01 |
| D03.04 | Quantity check and take-off | Tender Quantity Surveyor | BOQ / drawings | QS P → Senior Estimator R | Quantity check, BOQ gaps | Method per contract | D03.06 | BOQ–drawing–spec cross-check, QTO | GC-05 |
| D03.05 | Enquiries to subcontractors and suppliers | Tender Enquiry Coordinator | Packages defined | Coordinator P RFQs → quotes levelled → Estimator R | Quote comparison | Equal-basis levelling | D03.06 | RFQ packaging, bid levelling | GC-06 |
| D03.06 | Rate build-up (materials, labour, plant, subcontract) | Senior Estimator (Civil / Arch / MEP) | Quantities + quotes | Estimator P → Tendering Mgr R | Rate analysis, priced BOQ | Rates from cost DB / quotes, source cited | D03.09 | Item breakdown, rate suggestion with sources | GC-05 |
| D03.07 | Indirect costs (site overheads, preliminaries, bonds, insurances, financing) | Senior Estimator (Civil / Arch / MEP) | Duration + organisation | Estimator P → Tendering Mgr R | Indirect cost sheet | Staffing from MP-01 templates | D03.09 | Overhead estimation from history | GC-05 |
| D03.08 | Tender programme and duration study | Tender Planner | Scope + methods | Planner P → Tendering Mgr R | Tender schedule, duration | Logic check | D03.07, D03.09 | Duration and sequence suggestion | GC-01 |
| D03.09 | Risk, contingency, escalation, currency | Tender Risk & Contingency Analyst | Draft estimate | Analyst P → Tendering Mgr R | Risk-priced contingency | Method per company | D03.10 | Risk extraction | GC-01 |
| D03.10 | Mark-up and bid decision | Tendering Manager | Complete estimate | Tendering Mgr P → Tender / Bid Committee A | Final price, margin, decision record | Committee + DOA | D03.11 | Sensitivity analysis | GC-01 |
| D03.11 | Bid submission (technical, commercial, bid bond) | Tendering Manager | Bid decision | Team P → CCO R → CEO A (signature) | Submitted bid, bid bond | Checklist, deadline | D03.12, D16.09 | Proposal assembly, checklist | GC-01 |
| D03.12 | Post-bid clarification and negotiation | Commercial Director (CCO) | Client clarification | Tendering Mgr P → CCO A | Clarification letters, revised offer | Price change via committee | D04.01 | Response drafting | GC-01 |
| D03.13 | Bid result and loss / win analysis | Tendering Manager | Award / loss notice | Tendering Mgr P → CCO R | Result record, lessons | — | D03.14, D02.05 | Competitor price analysis | GC-01 |
| D03.14 | Cost database maintenance | Cost Database / Pricing Analyst | Quotes, actuals, indices | Analyst P → Senior Estimator A | Unit rates, productivity norms | Source and date on every rate | D03.06, D05.03 | Price trend tracking | — |

## 4. D04 Award, contract and project hand-over
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D04.01 | Contract review and signing | Contracts Manager | Letter of award | Contracts Mgr P → General Counsel R → CEO A (DOA) | Signed contract | DOA, legal review | D04.02–D04.05 | Contract review agent | GC-01, GC-02 |
| D04.02 | Contract data pack and obligations calendar | Contract Administrator (project) | Signed contract | P → Contracts Mgr R | Contract data, notice / time-bar calendar | Every obligation has owner + date | D15.06, D15.07 | Obligation extraction | GC-02 |
| D04.03 | Performance bond, advance payment guarantee | Banking & Guarantees Officer | Contract requirement | Officer P → Treasury R → CFO A | Guarantees issued | Expiry tracking | D16.09 | Expiry alerts | — |
| D04.04 | Project insurances | Insurance Officer | Contract requirement | Officer P → CFO A | Policies | Cover vs contract check | D16.11 | Cover-gap check | — |
| D04.05 | Tender-to-project hand-over (kick-off) | Project Director | Contract signed | Tendering Mgr P hand-over pack → PD R → PM accepts | Hand-over pack, assumptions list | All tender assumptions carried | D05.* | Hand-over pack assembly | GC-02 |
| D04.06 | Client advance payment | Commercial Manager (project) | Guarantee accepted | QS P claim → PM R → client pays; Finance records | Advance receivable / receipt | Recovery schedule per contract | D15.01, D16.04 | — | GC-13 |

## 5. D05 Project set-up and mobilisation
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D05.01 | Project creation, WBS / CBS / cost codes | Project Manager | Hand-over | Project Engineer P → Cost Controller R → PM A | Project, WBS, CBS | Every BOQ line maps to one CBS node | All project processes | Mapping draft | GC-02 |
| D05.02 | Control budget (tender estimate → buy-out) | Cost Control Manager / Cost Controller | WBS ready | Cost Controller P → Commercial Mgr R → PD A | Control budget | Budget = tender estimate ± recorded transfers | D08.05, D09.01 | Budget mapping | GC-02, GC-14 |
| D05.03 | Pre-construction BOQ (execution BOQ by steps, materials, codes) | Technical Office Manager | Budget + drawings | TO Engineers P → Senior Estimator R → PM A | Execution BOQ with material codes | Quantities reconcile to contract BOQ (differences explained) | D05.04, D09.01, D10.01 | Execution BOQ generation | GC-05 |
| D05.04 | Baseline schedule (cost- and resource-loaded) | Planner / Scheduler | WBS + methods + execution BOQ | Planner P → Planning Mgr R → PM A → client approval | Baseline | Schedule quality checks (logic, float, constraints) | D05.05, D05.07, D08.* | Schedule generation | GC-11 |
| D05.05 | Cash-flow plan | FP&A Analyst | Baseline + payment terms | FP&A P → CFO R | Project cash-flow | Uses contract payment terms | D16.07, D23.02 | Cash curve from schedule | GC-13 |
| D05.06 | Project execution plan and sub-plans (quality, HSE, logistics, procurement, documents, BIM) | Project Manager | Mobilisation | Each owner P → PM R → PD A | PEP and sub-plans | Mandatory sections per template | D13.01, D14.01, D09.01 | Plan drafting from templates | GC-02 |
| D05.07 | Project staffing plan | Project Manager | Baseline + org template | PM P → HR R → Recruitment / Headcount Committee A | Staffing plan | Template + resource loading | D17.02 | Staffing derivation | GC-19 |
| D05.08 | Site mobilisation (facilities, utilities, permits) | Site Logistics Manager | Possession of site | Logistics P → PM A | Site layout, permits | Permits before work | D12.01 | Layout check | — |
| D05.09 | Registers set-up (drawings, submittals, RFIs, procurement) | Document Control Manager / Controller | Mobilisation | DC P → TO Manager R | Registers | Numbering rules | D06.*, D09.* | Register generation from specs / drawings | GC-03 |
| D05.10 | Transmittals and document distribution | Document Control Manager / Controller | Document issued / received | DC P transmittal → recipient acknowledges | Transmittals, distribution matrix | Only current revision distributed | D06.*, D12.* | Classification, revision checks | — |

## 6. D06 Design management and technical office
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D06.01 | Design management (design & build) | Design Manager (D&B) | Design programme | Designers P → Design Mgr R → client approval | Design deliverables | Design programme tracking | D06.02 | Interface review | GC-03 |
| D06.02 | Drawing / model technical review | Technical Office Manager | Drawing / model received | TO Engineer P review → TO Manager R | Review comments, issues | Reviewer ≠ author | D06.03, D06.04 | Design package review agent | GC-03 |
| D06.03 | RFI (request for information) | TO Engineer — Architectural / Structural / Infrastructure | Missing / conflicting information | Engineer P → TO Manager A send | RFI log, responses | Response time tracked | D06.04, D15.06 | RFI drafting | GC-03 |
| D06.04 | Design revision impact | Technical Office Manager | New revision | TO P impact list → PM R | Impact list (drawings, BOQ, orders, schedule) | Superseded revisions blocked | D06.05, D05.03, D09.04, D08.03, D15.06 | Revision comparison | GC-04 |
| D06.05 | Shop drawings (all disciplines) | Technical Office Manager | Approved design + submittals | Draftsman / Engineer P → TO Manager R → consultant approval | Shop drawings | Status codes (A / B / C), revision control | D12.03, D09.01, D09.04, D25.03 | Generative drafting (MP-05) | GC-03 |
| D06.06 | Material and method submittals, samples and mock-ups | Submittals Engineer | Procurement / method need | Engineer P → TO Manager R → consultant approval | Submittal + approval | Spec compliance | D09.04, D12.03 | Spec compliance check | GC-03 |
| D06.07 | Method statements | Method Statement Engineer | Activity start | Engineer P → TO / HSE / QA R → consultant approval | Method statement | HSE and QA sign-off | D12.03, D14.02 | Drafting from history | — |
| D06.08 | BIM coordination and clash | BIM Coordinator | Models federated | Coordinator P clash run → BIM Manager R | Clash reports | Clashes closed before shop drawings | D06.05 | Clash detection and grouping | GC-03 |
| D06.09 | Temporary works design | Temporary Works Engineer | Activity planning | TW Engineer P → TW coordinator A | TW designs, lifting plans | Checked before use | D12.01, D14.02 | Load checks | — |
| D06.10 | Value engineering | Value Engineering Engineer | Opportunity | Engineer P → TO Manager R → client approval | VE proposal | Cost / quality impact | D15.06 | Alternative search | — |
| D06.11 | Quantity take-off for execution and billing | TO Engineer — Architectural / Structural / Infrastructure | Approved drawings / model | Engineer P → QS R | QTO | Traceable to drawing revision | D05.03, D15.01 | QTO from model / drawings | GC-05 |
| D06.12 | As-built drawings and models | As-built Engineer | Work completed | Engineer P → TO Manager R → consultant | As-built package | Matches inspections | D20.04 | Redline-to-model | GC-20 |

## 7. D07 Design studio: interiors and architecture
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D07.01 | As-built verification and correction | Interior Designer | Interior scope | Surveyor P measure → Designer P correct → TO R | Verified as-built base | Survey traceable | D07.02 | Point-cloud / photo to plan | — |
| D07.02 | Layout options (furniture, space planning) | Interior Designer | Brief + base | Designer P options (company sets number, e.g. 5) → Design Director R → client selects | Option set, client choice | Brief compliance checks | D07.03 | Layout option generation | — |
| D07.03 | Style and concept development (classic, modern, semi-classic, ultra-modern, …) | Interior Designer | Selected layout | Designer P → Design Director R → client approval | Mood / style boards | Client approval recorded | D07.04 | Style boards | — |
| D07.04 | 3D package and renders | 3D Visualiser | Approved concept | Visualiser P → Design Director R | 3D model, renders | Model = 2D basis | D07.05, D07.06 | Render pipeline | — |
| D07.05 | FF&E schedule and interior BOQ (materials, quantities, codes) | FF&E Specialist | 3D model | FF&E P → Estimator R | Interior BOQ, FF&E schedule | Quantities from model | D03.06, D09.01 | Schedule from model | — |
| D07.06 | 2D design package | Interior Designer | 3D approved | Designer P → Design Director R → client approval | 2D package | Revision control | D07.07 | Drawing generation | — |
| D07.07 | Interior shop drawings and execution hand-over | Technical Office Manager | Client approval | TO P shop drawings → consultant approval | Shop drawings | As D06.05 | D12.*, D09.* | Generative drafting | — |
| D07.08 | Architectural concept and design development (in-house design) | Architect | Design-and-build or design scope | Architect P → Design Director R → client approval | Design drawings, design reports | Licensed engineer signs where the law requires | D06.01, D06.02 | Layout generation | — |

## 8. D08 Planning, controls and reporting
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D08.01 | Progress measurement | Progress Measurement Engineer | Period end / daily | Engineer P → Planner R | Measured progress | Rules of credit per activity | D08.02, D08.05, D15.01 | Progress from photos / quantities | GC-10 |
| D08.02 | Schedule update | Planner / Scheduler | Period end | Planner P → Planning Mgr R → PM A | Updated schedule | Baseline unchanged without CCB | D08.03, D08.08, D05.07, D10.01 | Schedule quality check | GC-11 |
| D08.03 | Look-ahead planning | Construction Manager | Weekly | Planner P → Construction Mgr R | Look-ahead with constraints | Constraints (drawings, materials, permits, manpower) checked | D12.02, D09.01 | Constraint check | GC-11 |
| D08.04 | Earned value | Cost Control Manager / Cost Controller | Period end | Cost Controller P → PM R | EV, SPI / CPI | Same cut-off for all data | D08.05, D23.01 | Variance narrative | GC-14 |
| D08.05 | Cost report and EAC | Cost Control Manager / Cost Controller | Period end | Cost Controller P → Commercial Mgr R → PM A | Cost report, EAC | Each amount classified once | D16.15, D23.01 | Forecast, overrun alarms | GC-14 |
| D08.06 | Cash-flow forecast update | FP&A Analyst | Period end | FP&A P → CFO R | Updated cash forecast | Uses certified / expected billing | D16.07, D23.02 | Forecast model | GC-13 |
| D08.07 | Project risk register | Risk Manager | Continuous | Owner P → Risk Mgr R → PM A | Risk register, responses | Owner + due date, overdue flagged | D08.05, D23.01 | Risk identification | GC-26 |
| D08.08 | Delay analysis and recovery | Planning Manager | Slippage / event | Planner P → Planning Mgr R → PM A | Delay analysis, recovery plan | Method per contract | D15.07, D08.02 | Delay analysis | GC-11 |
| D08.09 | Change control board | Project Manager | Change request | Requester P → CCB A | Change decisions, baseline changes | Budget change via controlled transfer | D05.02, D05.04, D15.06 | Impact analysis | GC-15 |
| D08.10 | Weekly / monthly project report | Project Manager | Calendar | Reporting Analyst P → PM A | Report | Data cut-off consistent | D23.01 | Narrative generation | GC-10 |
| D08.11 | Interface management | Interface Manager | Interface points | Manager P → PM R | Interface register | Owner per interface | D08.03 | Interface detection | — |

## 9. D09 Procurement and subcontracting
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D09.01 | Material requirement planning and requisitions | Material Planner | Schedule + execution BOQ | Planner P → Site Manager R → PM A | Requisitions | Within budget line | D09.02 | MRP from schedule | GC-06 |
| D09.02 | Sourcing: RFQ / tender to vendors | Buyer (local / import) | Approved requisition | Buyer P → Procurement Mgr R | RFQs, offers | Minimum offers per policy | D09.03 | RFQ drafting | GC-06 |
| D09.03 | Comparison and award | Procurement Manager | Offers received | Buyer P comparison → technical R → Procurement Committee / DOA A | Award decision | Requester ≠ buyer ≠ approver | D09.04 | Bid levelling, price benchmarking | GC-06 |
| D09.04 | Purchase order, subcontract agreement, work order (labour-only / small packages) | Procurement Manager | Award | Buyer P → Procurement Mgr R → A per DOA | PO / subcontract | Commitment posted to budget | D08.05, D10.01, D15.04 | Contract drafting | GC-06 |
| D09.05 | Vendor and subcontractor prequalification and evaluation | Vendor Management Officer | New vendor / periodic | Officer P → Procurement Mgr A | Approved vendor list, scores | Creator ≠ prequalifier; bank change requester ≠ decider | D09.02 | Vendor scoring | GC-06 |
| D09.06 | Expediting | Expeditor | PO issued | Expeditor P status | Expediting log | Dates vs schedule need | D08.03 | Delay prediction | GC-06 |
| D09.07 | Import logistics and customs | Logistics / Customs Officer | Import PO | Officer P → Procurement Mgr R | Clearance file, landed cost | Landed cost to item cost | D10.01, D16.02 | Document checks | — |
| D09.08 | Subcontract variations and termination | Subcontract Administrator | Change / default | Administrator P → Commercial Mgr R → A per DOA | Subcontract variation / termination | Notices per subcontract | D15.04, D08.05 | Clause analysis | GC-12 |

## 10. D10 Stores and materials
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D10.01 | Goods receipt and inspection | Stores Manager / Storekeeper / Inventory Controller | Delivery | Storekeeper P GRN → QC Inspector R (if required) | GRN, inspection | Receiver ≠ buyer; qty vs PO | D10.03, D16.02 | Delivery note capture | GC-17 |
| D10.02 | Storage, transfers between stores / projects | Stores Manager / Storekeeper / Inventory Controller | Need | Storekeeper P → Stores Mgr A | Transfer notes | Valuation carried | D10.05 | — | GC-17 |
| D10.03 | Issue to activity / cost code | Site Storekeeper | Site request | Storekeeper P → Site Engineer A request | Issue notes | Issued against cost code | D08.05, D10.05 | Stock alerts | GC-17 |
| D10.04 | Stock count and adjustments | Stores Manager / Storekeeper / Inventory Controller | Periodic | Counter P → Stores Mgr R → Finance A adjustment | Count sheets, adjustments | Counter ≠ approver | D16.15 | Discrepancy analysis | — |
| D10.05 | Material reconciliation (theoretical vs actual, wastage) | Cost Control Manager / Cost Controller | Period end | Cost Controller P → PM R | Reconciliation, wastage | Theoretical from execution BOQ | D08.05 | Wastage anomaly | — |
| D10.06 | Materials on site for billing | Quantity Surveyor (project) | Billing period | QS P → Commercial Mgr R | MOS list | Per contract terms | D15.01 | — | GC-13 |
| D10.07 | Surplus and scrap disposal | Stores Manager / Storekeeper / Inventory Controller | Project end / surplus | Stores P → Procurement R → A per DOA | Disposal records | Valuation, approval | D16.15 | — | — |
| D10.08 | Returns to vendor and rejected material | Stores Manager / Storekeeper / Inventory Controller | Rejected at inspection / excess | Storekeeper P → QC R (if quality) → Procurement A | Return notes, debit notes | Linked to GRN and PO | D16.02, D09.05 | — | — |

## 11. D11 Plant and equipment
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D11.01 | Equipment planning and allocation | Plant Manager / Equipment Planner | Schedule resource needs | Planner P → Plant Mgr A | Equipment plan | Conflicts across projects flagged | D11.02, D08.05 | Allocation optimisation | GC-19 |
| D11.02 | Hire-in / hire-out | Plant Manager / Equipment Planner | Shortage / surplus | Planner P → Procurement R → A per DOA | Hire orders | Commitment posted | D08.05, D16.02 | Hire vs own analysis | — |
| D11.03 | Daily logs, utilisation, fuel | Operator (crane, excavator, loader, …) | Daily | Operator P log → Site Engineer A | Logbook, fuel issue | Hours vs fuel check | D11.05, D08.05 | Fuel anomaly | GC-19 |
| D11.04 | Preventive and corrective maintenance | Maintenance Planner / Mechanic | Hours / breakdown | Mechanic P job card → Plant Mgr R | Maintenance records | Out-of-service status blocks allocation | D11.01 | Breakdown prediction | — |
| D11.05 | Internal plant cost recovery | Cost Accountant | Period end | Cost Accountant P → Finance Mgr A | Plant charges to projects | Company internal rates | D08.05 | — | — |
| D11.06 | Plant purchase / disposal | Plant & Equipment Director | Capex need | Plant Dir P → Capex / Plant Investment Committee A | Capex decision | Hire vs buy analysis | D16.10 | Utilisation analysis | — |

## 12. D12 Site execution
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D12.01 | Permit to work | HSE Engineer / Safety Officer | Risky activity | Site Engineer P → Site Manager R → HSE Engineer issues → HSE Manager A (high-risk work) | Permit | No work without valid permit | D12.02 | Hazard check | GC-09 |
| D12.02 | Daily and weekly work planning | Construction Manager | Look-ahead | Site Manager P → Construction Mgr R | Daily plan, crew allocation | Constraints cleared | D12.03 | Crew plan suggestion | GC-07 |
| D12.03 | Execution and inspection requests (hold points) | Site Engineer (Civil / Arch / MEP) | Work ready | Engineer P IR → QC Inspector R → consultant inspection | IR, inspection result | No covering before hold point release | D08.01, D13.03 | Checklist | GC-08 |
| D12.04 | Daily diary (manpower, plant, weather, work, events) | Site Manager / Senior Site Engineer | Daily | Site Engineer P → Site Manager A sign | Signed daily diary | Mandatory fields at signing | D08.01, D15.07, D17.05 | Diary drafting | GC-07 |
| D12.05 | Site instructions and consultant directions | Site Manager / Senior Site Engineer | Instruction received | Site Mgr P register → Contracts Engineer R | Instruction register | Possible variation / notice flagged | D15.06 | Variation detection | GC-15 |
| D12.06 | Site measurement (quantities executed) | Quantity Surveyor (project) | Work done | Site Engineer P → QS R | Measurement sheets | Per method of measurement | D15.01, D15.04 | Measurement from model / photos | GC-12, GC-13 |
| D12.07 | Subcontractor coordination and site meetings | Construction Manager | Weekly | Construction Mgr P minutes | Minutes, actions | Actions with owner + date | D08.03 | Minutes and actions | — |
| D12.08 | Productivity tracking | Construction Manager | Daily | Foreman P quantities + hours → Site Mgr R | Productivity records | Same cost codes as budget | D03.14, D08.05 | Productivity benchmarks | GC-07 |
| D12.09 | Offline field capture and sync | Site Engineer (Civil / Arch / MEP) | No connectivity | Capture offline → sync with conflict rules | Synced records | Idempotent sync | D12.03, D12.04 | — | GC-27 |
| D12.10 | Setting-out and survey records | Surveyor (land) | Activity start / completion | Surveyor P → Site Engineer R → consultant check | Setting-out and survey records | Survey traceable to benchmarks | D12.03, D06.12 | Point-cloud processing | — |

## 13. D13 Quality
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D13.01 | Project quality plan and ITPs | QA/QC Manager | Mobilisation / activity | QA Engineer P → QA/QC Mgr R → consultant approval | PQP, ITPs | Hold / witness points defined | D12.03 | Drafting | GC-08 |
| D13.02 | Material testing | Lab Technician / Materials Tester | Delivery / pour | Tester P → QC Inspector R | Test reports | Failing result → NCR | D13.04, D10.01 | Result validation | GC-08 |
| D13.03 | Inspection and test | QC Inspector (Civil / Arch / MEP) | IR | Inspector P → consultant | Inspection records | Independent of production | D08.01 | Photo defect detection | GC-08 |
| D13.04 | Non-conformance and corrective action | QA/QC Manager | Defect / failure | Inspector P NCR → QA/QC Mgr A disposition | NCR, CAR | Hold until closed | D08.02, D15.05 | Root-cause patterns | GC-08 |
| D13.05 | Quality audits (project and supplier) | Management System Representative (ISO 9001 / 14001 / 45001) | Plan | MSR P → QHSE Director R | Audit reports | Findings closed with evidence | D01.04 | Gap checks | — |
| D13.06 | Calibration | Calibration Controller | Due date | Controller P | Calibration register | Expired instrument blocked | D13.02 | Expiry alerts | — |
| D13.07 | Snagging | QC Inspector (Civil / Arch / MEP) | Pre-handover | Inspector P snag list → Site Mgr closes → QC verifies | Snag list | Closure verified | D20.02 | Photo-based snag capture | GC-20 |

## 14. D14 Health, safety and environment
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D14.01 | HSE plan | HSE Manager | Mobilisation | HSE Mgr P → PM R → QHSE Director A | HSE plan | Legal requirements register | D14.* | Drafting | GC-09 |
| D14.02 | Risk assessment / JSA | HSE Engineer / Safety Officer | Activity / method statement | HSE Eng P → HSE Mgr A | Risk assessments | Before activity start | D12.01 | Hazard suggestions | GC-09 |
| D14.03 | Induction and training | HSE Engineer / Safety Officer | New worker / activity | HSE P → records | Training records | No site access without induction | D17.05 | — | GC-09 |
| D14.04 | HSE inspections | HSE Engineer / Safety Officer | Daily / weekly | HSE P → Site Mgr closes actions | Inspection records | Actions with owner + date | D14.07 | Hazard detection from photos | GC-09 |
| D14.05 | Incident reporting and investigation | HSE Manager | Incident / near miss | Reporter P → HSE Eng investigation → HSE Mgr A | Incident report, root cause | Notifiable incidents to authorities per law | D14.07, D16.11, D08.08 | Pattern analysis | GC-09 |
| D14.06 | Stop-work and restart | HSE Manager | Imminent danger | HSE P stop → corrective action → HSE Mgr A restart | Stop-work record | Restart only by HSE | D08.02 | — | GC-09 |
| D14.07 | HSE statistics and HSE committee | HSE Manager | Monthly | HSE Mgr P → HSE Committee | Statistics, actions | Same definitions company-wide | D23.01 | Trend analysis | GC-09 |
| D14.08 | Environmental monitoring and waste | Environmental Officer | Plan | Officer P → HSE Mgr R | Monitoring records | Permit limits | D14.07 | Monitoring alerts | — |
| D14.09 | Emergency preparedness and drills | Fire Warden | Plan | Warden P → HSE Mgr R | Drill records | — | D14.07 | — | — |
| D14.10 | Site security and access | Security Manager / Site Security Supervisor | Daily | Guard P gate log → Security Mgr R | Gate log, incidents | Only inducted persons enter | D17.05 | CCTV event review | — |

## 15. D15 Commercial: billing, variations, claims, subcontracts
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D15.01 | Client interim payment certificate (IPC) | Quantity Surveyor (project) | Billing period | QS P (measured qty × rate + variations + MOS − retention − advance recovery − previous) → Commercial Mgr R → submit → client certifies | IPC, certified amount | Preparer ≠ certifier; caps per contract | D16.03, D16.16, D08.06 | Measurement check, anomaly flags | GC-13 |
| D15.02 | IPC certification difference and dispute | Commercial Manager (project) | Certified ≠ submitted | QS P reconciliation → Commercial Mgr R | Difference log | Each difference classified | D15.07, D16.03 | Difference explanation | GC-13 |
| D15.03 | Price escalation / adjustment | Commercial Manager (project) | Index publication / contract formula | QS P → Commercial Mgr R → client | Escalation claim | Contract formula only | D15.01 | Index tracking | — |
| D15.04 | Subcontractor payment certificate | Subcontract Administrator | Subcontractor application | Administrator P (cumulative valuation − retention − advance recovery − back-charges) → Site Mgr verify → Commercial Mgr A | Subcontract certificate, payable | Valuation = Σ qty × rate + approved variations + MOS; site verification | D16.02, D08.05 | Pre-check, anomaly flags | GC-12 |
| D15.05 | Back-charges | Subcontract Administrator | Subcontractor default / NCR | Administrator P → Commercial Mgr A → notice to subcontractor | Back-charge | Evidence attached, notice served | D15.04 | Evidence assembly | GC-12 |
| D15.06 | Variations (instruction → notice → valuation → agreement) | Change / Variation Manager | Instruction / change | Contracts Eng P notice → QS P valuation → Commercial Mgr R → client agreement | Variation register, agreed value | Never auto-converted; notice within time bar | D05.02, D15.01, D08.09 | Notice drafting, impact | GC-15 |
| D15.07 | Claims and extension of time | Claims Manager / Engineer | Event / delay | Claims Eng P notice → substantiation → Claims & Disputes Committee A submit | Claim, EOT submission | Author ≠ determiner; time-bars tracked | D08.08, D16.16 | Delay analysis, evidence | GC-16 |
| D15.08 | Cost-value reconciliation | Commercial Manager (project) | Period end | Commercial Mgr P → PD R | CVR, margin | Same cut-off as cost report | D23.01 | Margin explanation | GC-14 |
| D15.09 | Final account (client and subcontractors) | Final Account QS | Completion | QS P → Commercial Mgr R → CCO A | Final accounts | All certificates reconciled | D20.06, D16.03 | Reconciliation | GC-13 |
| D15.10 | Correspondence and notices | Contracts Engineer | Event / obligation | Engineer P → Contracts Mgr A | Letters, notices register | Time-bar calendar | D15.06, D15.07 | Letter drafting | GC-15 |
| D15.11 | Client / engineer progress meetings and minutes | Contract Administrator (project) | Meeting calendar | Administrator P minutes → PM R → circulated; objections recorded | Minutes, action log | Minutes challenged within the contract period | D15.10, D08.03 | Minutes and action tracking | — |
| D15.12 | Liquidated damages and penalty exposure | Commercial Manager (project) | Forecast completion vs contract dates | QS P exposure → Commercial Mgr R → PD | LD exposure, mitigation (EOT) | LD rate and cap from contract data only | D08.05, D15.07, D16.16 | Exposure forecast | — |
| D15.13 | Subcontractor advance payment | Subcontract Administrator | Subcontract advance terms | Administrator P → Commercial Mgr R → A per DOA; paid only through posted payments | Subcontract advance payable, recovery schedule | Advance within the subcontract limit; advance guarantee where required | D16.05, D15.04 | — | — |

## 16. D16 Finance, treasury and tax
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D16.01 | Chart of accounts and posting rules | Financial Controller | Set-up / change | Chief Accountant P → Financial Controller A | COA, posting rules | Balanced batches; rule per source | All postings | Mapping check | — |
| D16.02 | Accounts payable (3-way match) | Accountant — GL / AP / AR / Project | Supplier invoice | AP P (PO × GRN × invoice) → Finance Mgr A | Payable, posting | Match tolerance per policy | D16.05 | Invoice capture, matching | GC-06 |
| D16.03 | Accounts receivable from certified IPCs | Accountant — GL / AP / AR / Project | IPC certified | AR P → Finance Mgr R | Receivable, invoice | AR = certified amount | D16.04, D16.12 | — | GC-13 |
| D16.04 | Receipts and collections | Credit Control / Collections Officer | Due date / receipt | Collections P plan; Cashier P receipt → Treasury R | Receipts, aging | Receipt allocation rules | D16.07, D23.02 | Collection risk | GC-13 |
| D16.05 | Payments (runs and approvals) | Treasury Manager / Cashier | Due payables | Treasury P payment run → CFO A per DOA | Payments | Payer ≠ approver; bank detail change control | D16.07, D08.05 | Duplicate / anomaly detection | — |
| D16.06 | Bank reconciliation | Accountant — GL / AP / AR / Project | Statement | Accountant P → Chief Accountant R | Reconciliation | Unreconciled items aged | D16.15 | Auto-matching | GC-25 |
| D16.07 | Treasury and cash forecast | Treasury Manager / Cashier | Weekly | Treasury P → CFO R | Cash position, forecast | Sources: schedule, billing, commitments | D23.02 | Forecast | GC-13 |
| D16.08 | Monthly commitments view (payroll, subcontract, supplier, instalments, facilities) | FP&A Analyst | Monthly | FP&A P → CFO R | Commitments by month | From approved records only | D23.02 | Trend / gap alerts | — |
| D16.09 | Guarantees and bonds | Banking & Guarantees Officer | Issue / expiry / release | Officer P → CFO A | Guarantee register | Expiry and release dates tracked | D16.07 | Expiry alerts | — |
| D16.10 | Fixed assets | Fixed Assets Accountant | Purchase / disposal / period | Accountant P → Finance Mgr R | Asset register, depreciation | Tag ↔ register | D16.15 | Reconciliation | — |
| D16.11 | Insurance policies and claims | Insurance Officer | Policy / loss event | Officer P → CFO A | Policies, insurance claims | Notification deadlines | D16.04 | Cover-gap check | — |
| D16.12 | Tax: VAT, withholding, e-invoice / e-receipt, returns | Tax Manager / Officer | Transaction / period | Tax Officer P → Tax Manager R → CFO A filing | Tax postings, e-documents, returns | Tax codes from the tax advisor (owner input) | D16.15 | Tax code checks | — |
| D16.13 | Petty cash and site expenses | Site Accountant / Petty Cash Custodian | Expense | Custodian P → Site Manager R → Finance A replenishment | Petty cash reports | Limits per policy | D08.05 | Receipt capture | — |
| D16.14 | Payroll accounting | Payroll Accountant | Payroll approved | Payroll Accountant P → Finance Mgr R | Payroll journals, social insurance | Payroll to project cost basis per company policy | D08.05 | Variance checks | GC-37 |
| D16.15 | Period close and financial statements | Finance Manager / Chief Accountant | Period end | Accountants P → Chief Accountant R → CFO A | Closed period, statements | Period lock, control totals | D16.17, D23.01 | Close checklist | GC-25 |
| D16.16 | Revenue recognition (over time) | Financial Controller | Period end | Accountant P run → Financial Controller A | Revenue run, contract asset / liability | Run author ≠ approver; onerous provision | D16.15, D23.01 | — | GC-13 |
| D16.17 | Budget vs actual and consolidation | Financial Controller | Period end | FP&A P → Financial Controller R | Variance, consolidated statements | Inter-company eliminations | D23.01 | Variance narrative | GC-25 |
| D16.18 | Go-live cut-over (opening balances) | Financial Controller | Go-live | Preparer P load → reconcile → other person A | Opening journal, opening positions | Reconciliation clean, preparer ≠ approver | D16.*, D15.* | Row-level validation | GC-24 |
| D16.19 | Manual journal entries (accruals, reclassifications, corrections) | Finance Manager / Chief Accountant | Period end / correction | Accountant P with support → Chief Accountant A | Journal voucher | Preparer ≠ approver; balanced; open period only | D16.15 | Anomaly detection | GC-25 |

## 17. D17 Human resources and payroll
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D17.01 | Organisation and position management | Organisation Development Specialist | Change | OD P → CHRO R → CEO A | Position catalogue, org chart | Versioned | D17.02 | JD drafting | — |
| D17.02 | Headcount plan and workforce gap alarm | HR Director (CHRO) | Staffing plans / exits | OD P gap report → Recruitment / Headcount Committee A | Approved vacancies | Gap = required − (filled + accepted offers) | D17.03, D16.08 | Gap alarm | GC-19 |
| D17.03 | Recruitment and selection | Recruitment Specialist | Approved vacancy | Recruiter P shortlist → hiring manager R → A per DOA offer | Offer, hire | Approved vacancy required | D17.04 | CV screening | GC-37 |
| D17.04 | Onboarding and employment contract | HR / Personnel Officer | Accepted offer | HR P → HR Mgr A | Contract, file, accesses | Documents complete; system access by position | D17.05, D22.01 | Document generation | GC-37 |
| D17.05 | Attendance and site timekeeping | Site Timekeeper | Daily | Timekeeper P → Site Manager A | Timesheets | Cross-check with gate log / diary | D17.07, D08.05 | Attendance validation | GC-37 |
| D17.06 | Leave and absence | HR / Personnel Officer | Request | Employee P → manager A → HR records | Leave records | Balance rules | D17.02, D17.07 | — | GC-37 |
| D17.07 | Payroll (staff, daily / piece-rate workers, social insurance, income tax) | Payroll Specialist (HR) | Period end | Payroll P → HR Mgr R → CFO A | Payroll run | Lines frozen after submission; employed same-org staff only | D16.14, D16.05 | Validation | GC-37 |
| D17.08 | Performance management | Performance Management Specialist | Cycle | Manager P → HR R | Appraisals | Evidence from system KPIs | D17.09 | KPI evidence | — |
| D17.09 | Training and certification | Training & Development Specialist | Plan / gap | Trainer P → HR Mgr A | Training records, certificates | Expiry tracking | D14.03 | Skill gap analysis | — |
| D17.10 | Transfers between projects | HR / Personnel Officer | Staffing change | PM P → HR R → A | Transfer record | Cost centre changes from date | D08.05, D17.02 | — | — |
| D17.11 | Discipline and grievances | HR / Personnel Officer | Case | Manager P → HR R → A | Case file | Labour law procedure | — | — | — |
| D17.12 | Exit and end-of-service settlement | HR / Personnel Officer | Resignation / end of contract | HR P → Payroll R → CFO A | Settlement, clearance | Assets and accesses returned | D16.05, D22.01, D17.02 | — | GC-37 |
| D17.13 | Work permits and expatriates | Work Permits / Expatriate Officer | Hire / renewal | Officer P → HR Mgr A | Permits | Expiry tracking | D17.02 | Expiry alerts | — |
| D17.14 | Medical insurance and welfare | Employee Welfare / Medical Insurance Officer | Enrolment / claim | Officer P | Welfare records | — | D16.08 | — | — |

## 18. D18 Administration and facilities
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D18.01 | Office services and supplies | Administration Manager | Request | Admin P → Admin Mgr A | Service records | Budget line | D16.02 | — | — |
| D18.02 | Housing and camps | Camp / Housing Coordinator | Staffing plan | Coordinator P → Admin Mgr A | Allocation records | Capacity vs staffing | D16.08 | Capacity planning | — |
| D18.03 | Incoming / outgoing correspondence and archive | Archive / Records Officer | Document | Officer P register → owner | Correspondence register, archive | Retention periods | D15.10 | Classification, indexing | GC-35 |
| D18.04 | Vehicles and drivers pool | Fleet Coordinator / Driver | Request | Coordinator P | Trip logs | Fuel and km check | D11.03 | — | — |

## 19. D19 Legal and corporate affairs
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D19.01 | Legal review (contracts, subcontracts, letters) | Legal Advisor | Request | Legal P → General Counsel A | Opinion | — | D04.01, D09.04 | Clause comparison | — |
| D19.02 | Disputes, arbitration, litigation | Arbitration / Disputes Counsel | Dispute | Counsel P → Claims & Disputes Committee A | Pleadings, settlements | Legal hold on records | D16.16 | Evidence assembly | GC-16 |
| D19.03 | Corporate registrations, contractor classification, licences | Corporate Affairs Officer | Expiry / change | Officer P → General Counsel A | Corporate documents register | Renewal before expiry | D02.03 | Renewal alerts | — |
| D19.04 | Building permits and authority approvals | Licensing & Permits Officer | Project need | Officer P → PM R | Permits | No work without permit | D05.08 | Expiry alerts | — |
| D19.05 | Powers of attorney | General Counsel | Need | Legal P → CEO A | POA register | Scope and expiry | D01.03 | — | — |

## 20. D20 Handover, warranty and close-out
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D20.01 | Testing and commissioning | Testing & Commissioning Engineer | System complete | T&C P → consultant witness | T&C records | All tests passed / accepted | D20.02 | Test record checks | GC-20 |
| D20.02 | Snag closure and taking-over | Handover & Warranty Manager | Substantial completion | Manager P → client inspection → certificate | Taking-over certificate | Snags closed or listed | D20.05, D15.01 | Hand-over file assembly | GC-20 |
| D20.03 | Authority approvals for occupancy (incl. civil defence) | Authorities & Utilities Liaison | Completion | Liaison P → authority | Approvals | Required before hand-over | D20.02 | Deadline tracking | — |
| D20.04 | O&M manuals, as-built and hand-over file | Handover & Warranty Manager | Pre-handover | TO / T&C P → Manager R → client | Hand-over file | Complete per checklist | D20.02 | O&M manual assembly | GC-20, GC-28 |
| D20.05 | Defects liability period | Handover & Warranty Manager | Defect notice | Manager P → site team closes → client verifies | Defect register | Response time per contract | D20.06 | Ticket triage | GC-20 |
| D20.06 | Retention release (client and subcontract) and bond release | Commercial Manager (project) | Certificates | QS P → Commercial Mgr R → client releases | Released retention, released bonds | Per contract milestones | D16.03, D16.09 | — | GC-20 |
| D20.07 | Project close-out (financial close, demobilisation, lessons learned) | Project Director | Final account agreed | PM P → PD A | Close-out report, lessons | All registers closed; cost codes locked | D03.14, D23.01 | Lessons extraction | — |
| D20.08 | End-user unit hand-over and customer care | Customer Care Officer (end-user units) | Unit ready | Officer P → end user signs | Unit hand-over records, tickets | — | D20.05 | Ticket triage | — |

## 21. D21 Facility management (optional unit)
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D21.01 | Service request handling | FM Helpdesk Operator | Request | Helpdesk P → Technician executes → FM Mgr closes | Work orders | SLA timers | D21.03 | Ticket triage | — |
| D21.02 | Planned preventive maintenance | Maintenance Engineer (MEP / civil) | Schedule | Engineer P → Technician executes | PPM records | Missed PPM flagged | D21.03 | Failure prediction | — |
| D21.03 | SLA reporting and FM billing | FM Manager | Period end | FM Mgr P → client | SLA report, invoice | Penalties per contract | D16.03 | SLA breach prediction | — |

## 22. D22 IT, data and AI
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D22.01 | User access lifecycle (joiner, mover, leaver) | ERP / MISHEL Administrator | HR event | Admin P → CIO A | Access records | Access by position; MFA where required | All | Access review | GC-29 |
| D22.02 | Configuration and business-process change | IT & Digital Director (CIO) | Change request | Admin P → owner R → CIO A | Configuration version | Versioned, rollback | All | Impact check | GC-22, GC-33 |
| D22.03 | AI agent lifecycle (scope, data, tools, release, review) | AI Operations Specialist | New / changed agent | AI Ops P → AI Governance Committee A | Agent register entry | Tools limited to caller permissions; never approval rights | MP-04 | — | GC-23 |
| D22.04 | Data import and integration connectors | Application Developer / Integrator | New source | Developer P → CIO A | Connector, import logs | Row-level validation | Target processes | Mapping suggestion | GC-24, GC-36 |
| D22.05 | Backup and disaster recovery | System / Network Administrator | Schedule / incident | Admin P → CIO R | Backups, restore tests | Restore tested | All | — | GC-34 |
| D22.06 | Security incident response | Cybersecurity Officer | Alert | Officer P → CIO A | Incident record | Evidence preserved | D01.05 | Threat detection | GC-32 |
| D22.07 | Privacy and retention | Data Protection Officer | Request / schedule | DPO P → General Counsel R | Privacy register, erasure records | Legal hold wins; no false erasure | All | Data classification | GC-35 |
| D22.08 | Ask-the-business (natural-language questions) | Data / BI Analyst | User question | User asks → system answers with sources within permissions | Answers with citations | Caller permissions only | — | Query assistant | GC-21 |
| D22.09 | Report design and scheduled distribution | Data / BI Analyst | Report request | Analyst P → requesting owner R → CIO A (publication) | Reports, schedules, exports | Report shows only data within the viewer's permissions | D23.01 | Report drafting from questions | — |

## 23. D23 Executive portfolio management
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D23.01 | Portfolio dashboard and monthly management review | CEO / Managing Director | Monthly / live | PMO P → executives review → CEO decisions | Portfolio view (phases, KPIs, PV / EV / AC, progress, issues), decisions | Data cut-off consistent; drill-down to source | Decisions → owners | Executive briefing | GC-18 |
| D23.02 | Company cash and commitments review | CFO | Weekly / monthly | Treasury + FP&A P → CFO → CEO | Cash, commitments, funding needs | — | D16.07 | Scenario | GC-13 |
| D23.03 | Workforce gap review | HR Director (CHRO) | Monthly | OD P → Recruitment / Headcount Committee | Gap decisions | — | D17.03 | Gap alarm | GC-19 |

## 24. D24 Audit and compliance
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D24.01 | Continuous control monitoring | Head of Internal Audit | Continuous | System flags exceptions (SoD breaches attempted, overrides, late approvals) → Internal Auditor R | Exception log | Independence | D01.08 | Exception sampling | — |
| D24.02 | Compliance calendar (statutory filings, licences, permits) | Internal Auditor / Compliance Officer | Calendar | Officer P → owners | Compliance status | Overdue escalation | D19.03, D16.12 | Deadline tracking | — |

## 25. D25 Production and workshops (optional unit, MP-01 4.7a)
| ID | Process | Owner | Trigger | Steps | Outputs | Controls | Feeds → | AI | GC |
|---|---|---|---|---|---|---|---|---|---|
| D25.01 | Concrete orders and batching | Batching Plant Manager / Operator | Pour request from site | Site Engineer P pour request → Plant Mgr A schedule → batch tickets | Batch tickets, delivery records | Approved mix design only; cubes sampled | D13.02, D10.03, D25.04 | Demand from pour schedule | — |
| D25.02 | Precast production | Precast Plant Manager | Approved shop drawings | Planner P production order → Plant Mgr A | Production records, yard stock | QC release before dispatch | D13.03, D25.04 | Production sequencing | — |
| D25.03 | Fabrication orders (steel / carpentry / aluminium) | Workshop Manager (steel / carpentry / aluminium) | Approved shop drawings | Workshop P cut lists → Workshop Mgr A | Fabricated items, cut lists | Only approved revision fabricated | D12.03, D25.04 | Cut-list optimisation | — |
| D25.04 | Production planning and internal costing | Production Planner | Site needs | Planner P → Production & Workshops Director A | Production schedule, internal charges | Company internal transfer prices | D08.05 | Capacity planning | — |

## 26. Propagation map — "a change here updates that"
Deterministic rules (database / engine, exact, auditable) unless marked **AI** (draft / alert for human review).
| # | Change | Recomputed / updated | Rule type |
|---|---|---|---|
| 1 | Contract BOQ quantity or rate (agreed variation) | Contract value → control budget (via controlled transfer) → IPC caps → revenue run inputs → cash forecast | Deterministic |
| 2 | Execution BOQ quantity | Material requirements → requisitions due → procurement plan → budget lines → EAC | Deterministic |
| 3 | Schedule update (dates, progress) | Look-ahead → material need dates → expediting priorities → staffing plan → gap alarm → plant plan → cash forecast → EV | Deterministic |
| 4 | Design revision | Impact list: superseded drawings blocked, affected shop drawings / submittals / orders / BOQ items / activities flagged | Deterministic + **AI** comparison |
| 5 | Approved shop drawing | Fabrication / procurement release, QTO update, inspection checklist | Deterministic |
| 6 | Award / PO / subcontract | Commitment → EAC → monthly commitments → cash forecast | Deterministic |
| 7 | Delivery delay (expediting) | Activity risk flag → look-ahead constraint → schedule what-if | Deterministic + **AI** delay prediction |
| 8 | Goods receipt | Stock → available for issue → AP 3-way match → MOS list | Deterministic |
| 9 | Issue to cost code | Actual cost → EAC → material reconciliation | Deterministic |
| 10 | Inspection rejected / NCR | Progress credit withheld → hold on covering work → back-charge candidate | Deterministic |
| 11 | Incident / stop-work | Activities stopped → schedule update → insurance notification task → HSE statistics | Deterministic |
| 12 | Daily diary signed | Manpower and plant actuals → productivity → evidence for claims → payroll cross-check | Deterministic |
| 13 | Site instruction registered | Variation / notice candidate → time-bar clock starts | Deterministic + **AI** detection |
| 14 | Client IPC certified | Receivable → collection plan → cash forecast → revenue billings → retention ledger → advance recovered | Deterministic |
| 15 | Subcontract certificate approved | Payable → payment run → commitment consumed → subcontract retention / advance positions | Deterministic |
| 16 | Payment / receipt posted | Bank balance → cash position → aging → commitments consumed | Deterministic |
| 17 | Price index / exchange rate published | Escalation claim draft, revaluation of foreign-currency balances | Deterministic (contract formula) |
| 18 | Approved headcount or staffing plan change | Gap alarm → vacancies → payroll commitments | Deterministic |
| 19 | Employee hire / exit / transfer | Filled positions → gap → payroll → access rights → cost centre | Deterministic |
| 20 | Guarantee / insurance / permit nearing expiry | Alert to owner → task → calendar | Deterministic |
| 21 | Period close | Lock of postings → statements → consolidation → dashboards | Deterministic |
| 22 | Risk raised / changed | Risk exposure → contingency draw-down proposal → EAC | Deterministic + **AI** identification |
| 23 | Claim / EOT agreed | Contract dates → baseline (via CCB) → LD exposure → revenue estimate | Deterministic |
| 24 | Tender lost / won | Cost DB lessons, pipeline, competitor price data | Deterministic + **AI** analysis |
| 25 | Close-out | Cost codes locked, actual productivity and rates fed back to cost database | Deterministic |
| 26 | Interior option approved by client | 3D package → interior BOQ → estimate → procurement plan | Deterministic + **AI** generation |

## 27. Cross-cutting services every process uses
Approval / workflow engine (DOA, SoD, delegation) · numbering and document control · notifications and tasks with
owner + due date · audit trail (who / what / when, before / after) · period and record locking · attachments with
version · comments and mentions · bilingual labels · offline capture for site processes · AI assistant in context
(MP-04) · export / print templates (MP-03) · multi-entity and multi-currency context.


## 28. Coverage and review record
**Counts (computed from this file by script):** 210 processes in 25 domains — D01 9 · D02 7 · D03 14 · D04 6 ·
D05 10 · D06 12 · D07 8 · D08 11 · D09 8 · D10 8 · D11 6 · D12 10 · D13 7 · D14 10 · D15 13 · D16 19 · D17 14 ·
D18 4 · D19 5 · D20 8 · D21 3 · D22 9 · D23 3 · D24 2 · D25 4; 26 propagation chains (section 26). 128 processes
map to a Golden Case (37 of the 38 cases used; GC-38 "Enterprise architecture transformation" is a product-engineering
case, not a company process); 82 have none yet — their code coverage is assessed in MP-07, not claimed here.

**Automated checks (script, scratchpad `check_mp02.py` + table check):** every table row has its header's column
count; IDs unique and consecutive per domain; every reference `Dnn.mm` / `Dnn.*` in steps and "Feeds →" resolves;
every owner is a position or body in MP-01 v1.3; every GC id is within GC-01…GC-38.

**Review log (OQS-001):**
- v1.0 draft → R2 numbering: finance IDs had a gap (D16.06 → D16.10) — renumbered consecutively, all references
  updated by script.
- R3 truth: 13 Golden Case mappings did not match the case's actual steps (payments, plant logs and maintenance,
  fixed assets, stock count, material reconciliation, chart of accounts, tax, annual budget, cash-flow processes) —
  corrected against the decomposition file (payments / tax / COA / budget / count now "—"; cash-flow processes →
  GC-13 step 8; plant logs → GC-19 step 3; hand-over file → GC-28).
- R4 hostile pass 1 — errors fixed: malformed domain references (D02.02, D02.07); budget control wording; tender
  addenda did not feed quantities and rates; shop drawings fed "issue to cost code" instead of requisitions and
  fabrication; temporary works fed induction instead of risk assessment; surplus disposal fed fixed assets; permit
  to work approval contradicted MP-01 (HSE holds permit authority); committee name mismatch with MP-01. Gaps
  added: ESG reporting, transmittals, samples and mock-ups, labour-only work orders, returns to vendor, setting-out
  and survey, client / engineer meetings, liquidated damages exposure, the whole production and workshops unit (D25).
- R4 hostile pass 2 (coverage against MP-01 units and against engines already in the code) — gaps added: in-house
  architectural design (D07.08), subcontractor advance payment (D15.13), subcontract retention release (D20.06),
  report design and scheduled distribution (D22.09).
- Residual (stated, not hidden): steps describe the reference practice of a large Egyptian / Gulf contractor;
  each company adapts approval chains through its DOA configuration. Legal obligations named (notifiable incidents,
  licensed-engineer signatures, labour-law procedure) are referenced, not quoted — the applicable texts are an owner /
  legal-advisor input, never invented.

- v1.1 (found while reviewing MP-03): manual journal entries had no process although the GL source `manual_journal` exists in the code (migrations 006, 007, 013) — D16.19 added (GC-25).

**Status:** reviewed (two hostile passes + automated checks); awaiting owner approval.
