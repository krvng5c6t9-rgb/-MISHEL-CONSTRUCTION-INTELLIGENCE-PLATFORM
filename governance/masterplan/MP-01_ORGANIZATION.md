# MP-01 — Value chain and full organization (founder → office boy)

Master Plan part 1 of 7 (OVD-001). Reference organization of a **large multi-project contractor** (buildings,
infrastructure, MEP, fit-out / interiors, design & build). It is a **template**: each customer company switches units
and positions on or off, renames them and sets its own grades, salaries, DOA limits and headcounts — none are set here.

Legend — Authority: **P** prepares · **R** reviews / recommends · **A** approves within the company's DOA (values are
company configuration, never defaults) · **I** informed. **AI** = the agent that supports the role (MP-04 defines each
agent); AI always prepares or checks, never holds A.
Code status (E3, this repo): `departments`, `roles`, `employees`, `attendance`, `payroll_runs/lines`, users / roles /
permissions and DOA exist; **positions, approved headcount, org chart, project staffing plan, vacancy / gap alarm and
role-to-responsibility catalogue do not exist** (to build — MP-07).

## 1. Value chain (level 0)
1. Market & opportunity → 2. Prequalification → 3. Tender study & go/no-go → 4. Estimating & pricing → 5. Bid
submission & negotiation → 6. Award & contract → 7. Mobilisation & project set-up (baseline schedule, budget,
pre-construction BOQ, plans, procurement and submittal registers) → 8. Design / design development / shop drawings →
9. Procurement & logistics → 10. Construction & site execution → 11. Quality, HSE, environment → 12. Progress,
cost, cash, change and claims control → 13. Billing, collection, payments → 14. Testing, commissioning, handover →
15. Defects liability / warranty → 16. Final account & close-out → 17. Lessons learned & knowledge.
Support chain across all: governance & strategy · finance & treasury · HR & payroll · legal · IT & AI · admin &
facilities · internal audit.

## 2. Organization levels
- **L0 Governance:** owners, board and committees. **L1 Executive:** CEO and C-level / directors.
- **L2 HQ departments:** shared services serving all projects. **L3 Project organisations:** one per project
  (matrix: line to project director, functional line to HQ department). **L4 Site workforce:** foremen, trades,
  labour, operators, drivers, guards.

## 3. Governance and executive
| Position | Reports to | Core responsibilities | Main outputs | Authority | AI |
|---|---|---|---|---|---|
| Founder / Chairman | Shareholders | Vision, strategy, capital, top appointments | Strategy, board resolutions | A (top DOA tier) | Portfolio & risk briefings |
| Board of Directors | Shareholders | Oversight, approve budget, major contracts, borrowing | Board minutes, approved budget | A | Board pack preparation |
| Audit Committee | Board | Financial reporting, internal audit, external auditor | Committee reports | A (audit plan) | Control-exception digest |
| Risk / Investment Committee | Board | Major tenders, JV, investments, enterprise risk | Go/no-go decisions on large bids | A | Bid risk scoring |
| CEO / Managing Director | Board | Run the company, targets, portfolio, key clients | Business plan, KPIs, decisions | A (per DOA) | Executive assistant agent, portfolio dashboard |
| Executive Office Manager | CEO | CEO agenda, follow-up of decisions, correspondence | Action log, minutes | P | Meeting minutes & action tracking |
| Executive Assistant / Secretary | CEO | Calendar, letters, filing | Letters, schedules | P | Drafting, translation |
| COO / Operations Director | CEO | All project delivery, resources across projects | Operations report, resource plan | A (operations DOA) | Portfolio health, resource conflict alerts |
| CFO | CEO | Finance, treasury, tax, reporting, funding | Financial statements, cash forecast | A (finance DOA) | Cash forecast, anomaly detection |
| Commercial Director (CCO) | CEO | Tendering, contracts, claims, commercial margin | Margin report, contract strategy | A (commercial DOA) | Contract & claim analysis |
| Business Development Director | CEO | Pipeline, clients, prequalifications, marketing | Pipeline, BD plan | R/A | Opportunity scoring, market scan |
| Technical / Engineering Director | CEO | Technical office, design, BIM, methods, value engineering | Technical standards, method statements | A (technical) | Design / BIM review agents |
| Design Director (Architecture & Interiors) | CEO / Technical Dir. | Design studio, concepts, interiors, client design approvals | Design packages | A (design release) | Layout / interior generation |
| MEP Director | COO / Technical Dir. | MEP engineering, installation, T&C | MEP strategy, T&C plans | A (MEP technical) | MEP coordination / clash |
| QHSE Director | CEO | Quality system, safety, environment, certifications | QHSE plan, audits | A (QHSE policy, stop-work) | Incident trends, inspection analytics |
| Supply Chain Director | COO / CFO | Procurement, logistics, stores, vendors | Procurement strategy, vendor list | A (procurement DOA) | Price benchmarking, vendor risk |
| HR Director (CHRO) | CEO | Organisation, people, pay, training, labour law compliance | Org chart, headcount plan, HR policies | A (HR DOA) | Workforce gap alarm, CV screening |
| General Counsel | CEO / Board | Legal risk, contracts legal review, disputes, company affairs | Legal opinions | R/A (legal) | Clause risk review |
| IT & Digital Director (CIO) | CEO | Systems, MISHEL administration, data, cyber, AI operations | IT plan, access reviews | A (IT) | Agent monitoring |
| Head of Internal Audit | Audit Committee | Independent assurance on controls | Audit reports, findings | R (independent) | Continuous control monitoring |
| Plant & Equipment Director | COO | Fleet, plant, maintenance, utilisation | Fleet plan | A (plant) | Utilisation / breakdown prediction |

## 4. HQ departments (L2)
### 4.1 Business Development & Marketing
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| BD Manager | Pipeline, client meetings, opportunities | Opportunity register, visit reports | P/R | Opportunity extraction from tenders / news |
| Market Research Analyst | Market, competitors, prices of tenders awarded | Market studies | P | Market scan agent |
| Prequalification Coordinator | Company profiles, prequal forms, certificates | Prequal submissions | P | Auto-fill prequal from company data |
| Key Account Manager | Relationship with repeat clients | Account plans, satisfaction | P | Client history summary |
| Marketing & Communications Specialist | Brand, website, social media, brochures | Campaigns, content | P | Content drafting |
| Graphic Designer | Presentations, brochures, bid books | Visual material | P | Layout assistance |

### 4.2 Tendering & Estimation
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Tendering Manager | Bid plan, go/no-go input, bid team, final bid pack | Bid schedule, tender summary, bid pack | R (A by CCO/CEO per DOA) | Tender study agent |
| Senior Estimator (Civil / Arch / MEP) | Pricing method, rate build-up, resources | Priced BOQ, rate analysis | P/R | Item breakdown, rate suggestion from company cost DB |
| Tender Quantity Surveyor | Quantity check vs drawings, BOQ gaps, queries | Quantity check, tender queries | P | BOQ–drawing–spec cross-check |
| Cost Database / Pricing Analyst | Unit rates, supplier quotes, productivity norms, indices | Cost DB, price updates | P | Price trend tracking |
| Tender Planner | Tender programme, duration study | Tender schedule | P | Duration & sequence suggestion |
| Technical Submission Engineer | Method statements, organisation, technical proposal | Technical proposal | P | Proposal drafting from templates |
| Tender Document Controller | Receive, register, distribute tender docs, addenda | Tender register | P | Document classification |

### 4.3 Contracts, Commercial & Claims
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Contracts Manager | Contract review, negotiation, contract data pack, obligations | Contract summary, risk register | R | Contract review agent |
| Contracts Engineer | Notices, letters, time bars, variations | Notices, correspondence | P | Time-bar watch, letter drafting |
| Claims Manager / Engineer | EOT and money claims, delay analysis, substantiation | Claim submissions | P/R | Delay analysis, evidence assembly |
| Commercial Manager (project) | Project commercial position, valuations, variations, forecasts | Cost-value reconciliation, monthly commercial report | R | Variance and margin explanation |
| Quantity Surveyor (project) | Measurement, IPCs, variations valuation, final account | IPCs, valuations | P | Measurement from model / drawings |
| Subcontract Administrator | Subcontract orders, certificates, back-charges, retentions | Subcontract certificates | P | Certificate check vs progress |

### 4.4 Project Controls / PMO
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| PMO Head | Standards, portfolio reporting, controls governance | Portfolio report | R/A (standards) | Portfolio analytics |
| Planning Manager | Planning standards, baseline approval route, delay review | Baseline / updates review | R | Schedule quality check (logic, float, constraints) |
| Planner / Scheduler | Baseline, updates, look-ahead, resource / cost loading | Schedules, look-ahead, S-curves | P | Schedule generation from BOQ and methods |
| Cost Control Manager / Cost Controller | Budget, commitments, actuals, EAC, EVM | Cost reports, EAC | P/R | Forecast and overrun alarms |
| Risk Manager | Risk registers, quantitative risk | Risk reports | P/R | Risk identification from documents |
| Reporting / Data Analyst | Dashboards, KPIs | Dashboards | P | Narrative generation |
| Document Control Manager / Controller | Transmittals, registers, revisions, archive | Document registers | P | Classification, revision checks |

### 4.5 Engineering / Technical Office (HQ and project)
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Technical Office Manager | Technical deliverables, submittals, shop drawings, RFIs | TO plan, submittal / RFI registers | R/A (internal release) | Design package review agent |
| Design Manager (D&B) | Design consultants, design programme, interfaces | Design deliverables tracker | R | Interface / clash review |
| TO Engineer — Architectural / Structural / Infrastructure | Shop drawings, quantity take-off, technical queries | Shop drawings, QTO, RFIs | P | Drafting and QTO agents |
| TO Engineer — Mechanical / Electrical / Plumbing / Fire | MEP shop drawings, coordination, calculations | Coordinated MEP drawings | P | MEP routing and clash |
| BIM Manager | BIM execution plan, standards, model federation | BEP, federated model | R/A (model release) | Model checking |
| BIM Coordinator | Clash detection, coordination meetings | Clash reports | P | Clash detection and grouping |
| BIM Modeller / CAD Draftsman (per discipline) | Models and drawings | Models, drawings | P | Generative drafting |
| Submittals Engineer | Material / method submittals and approvals | Submittals, approval log | P | Spec compliance check |
| Value Engineering Engineer | Alternatives, savings proposals | VE proposals | P | Alternative search |
| Surveyor (land) | Setting out, as-built survey | Survey data, as-built | P | Point-cloud / as-built processing |

### 4.6 Design Studio — Architecture & Interiors
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Architect | Concept, design development | Design drawings | P | Layout generation |
| Interior Designer | As-built check, layouts (several options), style, materials | Interior options, 2D package | P | Furniture layout options, style boards |
| 3D Visualiser | 3D models, renders, walkthroughs | 3D package | P | Render pipeline |
| FF&E Specialist | Furniture, fixtures, equipment schedules | FF&E schedule with BOQ | P | Schedule from model |
| Landscape Architect | External works design | Landscape package | P | Layout options |

### 4.7 Projects / Operations (L3 project organisation)
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Project Director | One or several projects, client, results | Project review, escalations | A (project DOA) | Project health briefing |
| Project Manager | Delivery of scope, time, cost, quality, safety | Monthly report, plans | A/R (project DOA) | Project assistant agent |
| Construction Manager | Site execution across sections | Work plans, look-ahead execution | R | Look-ahead and constraint check |
| Site Manager / Senior Site Engineer | Daily execution of a site or zone | Daily reports, work permits requests | P/R | Daily report drafting from inputs |
| Site Engineer (Civil / Arch / MEP) | Supervise work, quantities, inspections requests | Inspection requests, daily records | P | Checklist and quantity capture |
| Section Engineer | One section / trade package | Section progress | P | Progress capture |
| General Foreman / Foreman | Crews, daily tasks | Crew allocation, timesheets | P | Crew plan suggestion |
| Supervisor (trade) | Workmanship of a trade | Daily output | P | — |
| Site Timekeeper | Attendance, timesheets | Timesheets | P | Attendance validation |
| Site Storekeeper | Site receipts and issues | GRNs, issue notes | P | Stock alerts |
| Site Administrator / Secretary | Site office, correspondence, petty cash | Letters, petty cash | P | Drafting |
| Testing & Commissioning Engineer | T&C plans, records, handover | T&C records | P | Test record checks |
| Handover & Warranty Manager | Snag lists, handover docs, DLP defects | Handover file, defect register | P/R | O&M manual assembly |

### 4.8 Quality (QA/QC)
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| QA/QC Manager | Quality plan, audits, NCR closure | Project quality plan, audit reports | A (quality release) | NCR trend analysis |
| QA Engineer | Procedures, document compliance | Procedures, audits | P | Procedure drafting |
| QC Inspector (Civil / Arch / MEP) | Inspections, ITPs, tests | Inspection reports, NCRs | P | Checklist, photo defect detection |
| Lab Technician / Materials Tester | Material tests | Test reports | P | Result validation |

### 4.9 Health, Safety & Environment
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| HSE Manager | HSE plan, permits, incidents, statistics | HSE plan, reports | A (stop-work, permits) | Risk and trend analysis |
| HSE Engineer / Safety Officer | Inspections, toolbox talks, permits to work | Inspection records, permits | P | Hazard identification from photos |
| Environmental Officer | Waste, noise, dust, permits | Environmental records | P | Monitoring alerts |
| Nurse / First Aider | First aid, medical records | Medical log | P | — |
| Fire Warden | Fire prevention, drills | Drill records | P | — |

### 4.10 Supply Chain — Procurement, Logistics, Stores
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Procurement Manager | Strategy, tenders to vendors, negotiation | Procurement plan, POs | A/R (procurement DOA) | Quote comparison |
| Buyer (local / import) | RFQs, comparisons, POs | Comparisons, POs | P | RFQ drafting, price benchmarking |
| Vendor Management Officer | Prequalification, evaluation of vendors and subcontractors | Approved vendor list | P/R | Vendor scoring |
| Expeditor | Delivery follow-up | Expediting log | P | Delay prediction |
| Logistics / Customs Officer | Shipping, customs clearance | Clearance files | P | Document checks |
| Stores Manager / Storekeeper / Inventory Controller | Receipt, storage, issue, counts | Stock reports, counts | P/R | Reorder suggestions |

### 4.11 Plant & Equipment
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Plant Manager / Equipment Planner | Allocation, hire in/out, utilisation | Equipment plan | R/A | Allocation optimisation |
| Maintenance Planner / Mechanic | Preventive and corrective maintenance | Maintenance records | P | Breakdown prediction |
| Operator (crane, excavator, loader, …) | Operate equipment, daily log | Equipment logbook | P | — |
| Fleet Coordinator / Driver | Vehicles, trips, fuel | Trip and fuel logs | P | Fuel anomaly detection |

### 4.12 Finance & Treasury
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Finance Manager / Chief Accountant | Closing, statements, controls | Monthly accounts | R/A (finance DOA) | Close checklist, reconciliation |
| Accountant — GL / AP / AR / Project | Postings, invoices, receipts, project accounts | Journals, ledgers | P | Invoice capture, matching |
| Cost Accountant | Job costing, overhead allocation | Cost reports | P | Allocation checks |
| Treasury Manager / Cashier | Cash, banks, payments, cash forecast | Cash position, payment runs | P/R | Cash forecast |
| Banking & Guarantees Officer | Letters of guarantee, bonds, facilities | Guarantee register | P | Expiry alerts |
| Tax Manager / Officer | VAT, withholding, e-invoice, returns | Tax returns | P/R | Tax code checks |
| Payroll Accountant | Payroll postings, social insurance | Payroll journals | P | Payroll variance checks |
| FP&A Analyst | Budget, forecast, company commitments | Budget, forecasts, monthly commitments | P | Scenario modelling |

### 4.13 Human Resources & Administration
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Recruitment Specialist | Vacancies, sourcing, interviews | Hiring files | P | CV screening, vacancy from gap alarm |
| HR / Personnel Officer | Contracts, files, leaves, discipline | Employee records | P | Document generation |
| Compensation & Benefits Specialist | Grades, salary scales, allowances | Salary structure | P/R | Market comparison (company data) |
| Payroll Specialist (HR) | Attendance to payroll inputs | Payroll inputs | P | Validation |
| Training & Development Specialist | Training plans, certifications | Training records | P | Skill gap analysis |
| Government Relations Officer | Social insurance, labour office, permits | Government filings | P | Deadline tracking |
| Camp / Housing Coordinator | Workers' housing, transport | Housing records | P | — |
| Administration Manager | Offices, services, contracts of services | Admin reports | R | — |
| Receptionist | Visitors, calls | Visitor log | P | — |
| Messenger / Courier | Documents delivery | Delivery log | P | — |
| Office Boy / Tea Boy | Office service, hospitality | — | — | — |
| Cleaner | Office and site cleanliness | — | — | — |
| Security Guard / Watchman | Access, gate log | Gate log | P | Gate log digitisation |

### 4.14 Legal, IT & Digital, Internal Audit
| Position | Responsibilities | Outputs | Auth. | AI |
|---|---|---|---|---|
| Legal Advisor | Contracts legal review, disputes, notices | Opinions | R | Clause comparison |
| Licensing & Permits Officer | Building permits, authority approvals | Permit register | P | Expiry alerts |
| ERP / MISHEL Administrator | Users, roles, DOA set-up, configuration | Access records | P (A by CIO) | Access review |
| System / Network Administrator | Infrastructure, backups | IT logs | P | Monitoring |
| Data / BI Analyst | Data quality, reports | Reports | P | Query assistant |
| AI Operations Specialist | Agent configuration, prompt / rule versions, AI quality review | Agent review log | P/R | — |
| Cybersecurity Officer | Security, incidents | Security reports | P/R | Threat detection |
| Helpdesk Technician | User support | Tickets | P | Answer bot |
| Internal Auditor / Compliance Officer | Audits, compliance tests | Audit findings | P/R | Exception sampling |

## 5. Workforce planning and gap alarm (design input to MP-06)
- **Position catalogue:** every position above as a record (unit, title, grade, responsibilities, outputs,
  authorities, required qualifications), editable by the company.
- **Approved headcount:** per unit and per project, by position — approved by the company's DOA.
- **Derived requirement:** project staffing plan from the schedule's resource loading and the project org template
  (by size / type set by the company), plus HQ plan.
- **Gap = required − filled (incl. pending hires).** Alarm per unit / project / discipline with date needed, grade
  and the company's salary band; feeds recruitment and the **monthly commitments** view (payroll + subcontract +
  supplier + instalment / facility obligations by month).
- Over-staffing and idle staff shown the same way.

## 6. What this part fixes for the build
New master data to build: position catalogue, approved headcount, project org templates, staffing plan, vacancy
records, gap alarm, commitments view; link positions to roles / permissions / DOA so authority comes from the
position, not the person. AI never receives an approval right.
