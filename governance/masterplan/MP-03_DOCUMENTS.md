# MP-03 — Documents, forms, registers and reports: catalogue, standards, export and print

Master Plan part 3 of 7 (OVD-001, OQS-001). Every document is produced by an MP-02 process and prepared / approved
by MP-01 positions.

Code status (E3, verified 2026-10-15): the backend and frontend have **no document-generation or export library**
(no PDF, XLSX, DOCX or PPTX dependency in `backend/package.json` / `frontend/package.json`) and **no download
endpoint** (no `Content-Disposition` / file response in `backend/src`). Screens show data tables only. Everything in
this part is therefore **to build** (order in MP-07), except the data each document draws from, which exists where
the MP-02 process is covered.

## 1. Document standards (apply to every document)
| Standard | Rule |
|---|---|
| Identity | Unique number `{entity}-{project}-{doc type}-{discipline}-{serial}`; segments and separators configurable per company; numbers never reused, gaps explained (cancelled numbers kept) |
| Revision | Revision letter / number per company convention; every issue keeps all previous revisions; only the current revision is distributable |
| Status | Draft → Submitted → Reviewed → Approved / Approved with comments / Rejected → Superseded / Cancelled; consultant status codes (e.g. A / B / C / D) mapped per contract |
| Draft marking | Any document not approved — and every AI-drafted document until a human approves it — prints with a "DRAFT" watermark and the drafter's identity (human or agent) |
| Approval block | Prepared / reviewed / approved names, positions, dates and method (system approval, e-signature or wet signature scan) taken from the workflow record, never typed; the legal effect of electronic signatures for each document type is a legal input |
| Verification | QR code / link on every issued document resolving to the system record (number, revision, status, hash of the issued file) so a printed copy can be checked |
| Integrity | SHA-256 of each issued file stored; re-issue creates a new revision, never overwrites |
| Language | Arabic, English or bilingual per document type and company setting; Arabic right-to-left layout with Arabic-capable fonts; numbers and dates per locale; amounts in words (Arabic and English) on financial documents |
| Calendar | Gregorian; Hijri shown in addition where a company or jurisdiction requires it |
| Branding | Company / entity letterhead, logo, address, commercial registration and tax numbers from configuration; project title block from project data |
| Page | A4 / A3 (drawings up to A0), portrait / landscape per template; page x of y; confidentiality class in footer |
| Confidentiality | Public / internal / confidential / restricted — controls who can view, export and print |
| Retention | Class per section 3 (periods are legal / company inputs, never set here) |
| Audit | Every view of a restricted document, every export and every print logged (who, when, which revision) |

## 2. Document catalogue
Columns: **Code** · **Document** · **Process** (MP-02) · **Prepared by** / **Approved by** (MP-01, or an external
party) · **Key content** · **Formats** (PDF = print / issue; XLSX / DOCX / PPTX = editable export; DWG / DXF / IFC =
drawings / models; XER / XML = schedule exchange) · **Ret.** (retention class, section 3). External or generic
parties used as preparer / approver: Client, Consultant / Engineer, Authority, End user, Line manager (the
employee's manager in the org chart), Employee (self-service).

### 2.1 Governance, BD and tendering
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-01-001 | Strategic plan | D01.01 | Strategy & Corporate Development Manager | Board of Directors | Objectives, targets, initiatives | PDF, PPTX | PERM |
| DOC-01-002 | Annual budget | D01.02 | FP&A Analyst | Board of Directors | Budget by unit / project, assumptions | PDF, XLSX | FIN |
| DOC-01-003 | DOA matrix (version) | D01.03 | ERP / MISHEL Administrator | Board of Directors | Authority by process, amount band, position | PDF, XLSX | PERM |
| DOC-01-004 | Policy / procedure | D01.04 | QA Engineer | QHSE Director | Purpose, scope, steps, records, revision history | PDF, DOCX | PERM |
| DOC-01-005 | Enterprise risk register | D01.05 | Risk Manager | Board Risk Committee | Risks, owners, ratings, responses | PDF, XLSX | OPS |
| DOC-01-006 | Board / assembly minutes and resolutions | D01.07 | Board Secretary / Company Secretary | Founder / Chairman | Attendance, resolutions, votes | PDF | PERM |
| DOC-01-007 | Internal audit report | D01.08 | Internal Auditor / Compliance Officer | Head of Internal Audit | Scope, findings, ratings, actions | PDF | FIN |
| DOC-01-008 | ESG / green-building report | D01.09 | Sustainability / ESG Manager | CEO / Managing Director | Indicators, sources, green submittals | PDF, XLSX | OPS |
| DOC-01-009 | Company configuration record (entities, branches, calendars, numbering, currencies, taxes) | D01.06 | ERP / MISHEL Administrator | IT & Digital Director (CIO) | Configuration version, changes, exceptions | PDF, XLSX | PERM |
| DOC-02-001 | Opportunity record | D02.01 | BD Manager | Business Development Director | Client, scope, value range, dates, source | PDF | OPS |
| DOC-02-002 | Prequalification pack | D02.03 | Prequalification Coordinator | CEO / Managing Director | Profile, certificates, experience, financials | PDF | CONTRACT |
| DOC-02-003 | Go / no-go decision record | D02.04 | BD Manager | Tender / Bid Committee | Criteria scores, decision, reasons | PDF | CONTRACT |
| DOC-02-004 | JV / consortium agreement | D02.07 | Strategy & Corporate Development Manager | Board of Directors | Shares, roles, liabilities | PDF | PERM |
| DOC-02-005 | Party registration and credit check (client / consultant / partner) | D02.02 | BD Manager | Finance Manager / Chief Accountant | Identity, registrations, credit and sanctions check | PDF | OPS |
| DOC-02-006 | Key account plan and visit report | D02.05 | Key Account Manager | Business Development Director | Account goals, contacts, visits, actions | PDF | OPS |
| DOC-02-007 | Marketing plan and company profile | D02.06 | Marketing & Communications Specialist | Business Development Director | Campaigns, profile, references | PDF, PPTX | OPS |
| DOC-03-001 | Tender register and document transmittal | D03.01 | Tender Document Controller | Tendering Manager | Documents, revisions, addenda, completeness | PDF, XLSX | CONTRACT |
| DOC-03-002 | Tender study report | D03.02 | Tendering Manager | Commercial Director (CCO) | Scope, contract risks, spec / BOQ / drawing conflicts, site visit, recommendation | PDF, DOCX | CONTRACT |
| DOC-03-003 | Site visit report | D03.02 | Senior Estimator (Civil / Arch / MEP) | Tendering Manager | Access, soil, utilities, photos, constraints | PDF | CONTRACT |
| DOC-03-004 | Tender query log and addenda register | D03.03 | Tender Quantity Surveyor | Tendering Manager | Query, answer, revision impact | PDF, XLSX | CONTRACT |
| DOC-03-005 | Quantity check report | D03.04 | Tender Quantity Surveyor | Senior Estimator (Civil / Arch / MEP) | BOQ vs drawings differences, missing items | PDF, XLSX | CONTRACT |
| DOC-03-006 | RFQ package and quote comparison (tender stage) | D03.05 | Tender Enquiry Coordinator | Tendering Manager | Scope per package, levelled quotes | PDF, XLSX | CONTRACT |
| DOC-03-007 | Rate analysis (item breakdown) | D03.06 | Senior Estimator (Civil / Arch / MEP) | Tendering Manager | Materials, labour, plant, subcontract, wastage, productivity, sources | PDF, XLSX | CONTRACT |
| DOC-03-008 | Priced BOQ | D03.06 | Senior Estimator (Civil / Arch / MEP) | Tendering Manager | Items, quantities, rates, totals | PDF, XLSX | CONTRACT |
| DOC-03-009 | Indirect cost sheet | D03.07 | Senior Estimator (Civil / Arch / MEP) | Tendering Manager | Site staff, facilities, plant, bonds, insurances, financing | PDF, XLSX | CONTRACT |
| DOC-03-010 | Tender programme | D03.08 | Tender Planner | Tendering Manager | Activities, durations, logic, milestones | PDF, XER / XML | CONTRACT |
| DOC-03-011 | Tender risk and contingency register | D03.09 | Tender Risk & Contingency Analyst | Tendering Manager | Risks, probability, impact, priced contingency | PDF, XLSX | CONTRACT |
| DOC-03-012 | Bid summary and decision record | D03.10 | Tendering Manager | Tender / Bid Committee | Direct cost, indirect, contingency, mark-up, price, cash profile, decision | PDF | CONTRACT |
| DOC-03-013 | Technical proposal | D03.11 | Technical Submission Engineer | Commercial Director (CCO) | Method, organisation, programme, experience | PDF, DOCX | CONTRACT |
| DOC-03-014 | Commercial proposal / form of tender | D03.11 | Tendering Manager | CEO / Managing Director | Price, validity, conditions, bid bond reference | PDF | CONTRACT |
| DOC-03-015 | Bid result and loss / win analysis | D03.13 | Tendering Manager | Commercial Director (CCO) | Ranking, competitor prices, lessons | PDF | OPS |
| DOC-03-016 | Unit rate / cost database extract | D03.14 | Cost Database / Pricing Analyst | Senior Estimator (Civil / Arch / MEP) | Rates with source and date | XLSX | OPS |
| DOC-03-017 | Post-bid clarification / revised offer letter | D03.12 | Tendering Manager | Commercial Director (CCO) | Clarifications, revised price or terms | PDF, DOCX | CONTRACT |

### 2.2 Contract, set-up and planning
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-04-001 | Contract review report | D04.01 | Contracts Manager | General Counsel | Clause risks, deviations, negotiation points | PDF, DOCX | CONTRACT |
| DOC-04-002 | Signed contract and amendments | D04.01 | Contracts Manager | CEO / Managing Director | Agreement, conditions, appendices | PDF | PERM |
| DOC-04-003 | Contract data pack and obligations calendar | D04.02 | Contract Administrator (project) | Contracts Manager | Key data, notices, time bars, owners, dates | PDF, XLSX | CONTRACT |
| DOC-04-004 | Guarantee / bond request and register | D04.03 | Banking & Guarantees Officer | CFO | Type, amount, beneficiary, expiry, release condition | PDF, XLSX | CONTRACT |
| DOC-04-005 | Insurance schedule | D04.04 | Insurance Officer | CFO | Policies, cover, limits, deductibles, expiry | PDF, XLSX | CONTRACT |
| DOC-04-006 | Tender-to-project hand-over pack | D04.05 | Tendering Manager | Project Director | Estimate, assumptions, risks, quotes, programme | PDF | CONTRACT |
| DOC-04-007 | Advance payment application | D04.06 | Quantity Surveyor (project) | Commercial Manager (project) | Amount, guarantee, recovery schedule | PDF | FIN |
| DOC-04-008 | Letter of award / notice to commence (received) | D04.01 | Client | Contracts Manager | Award, dates, conditions; acknowledgement | PDF | PERM |
| DOC-05-001 | WBS / CBS / cost code structure | D05.01 | Project Engineer / Project Coordinator | Project Manager | Hierarchy, codes, BOQ mapping | PDF, XLSX | CONTRACT |
| DOC-05-002 | Control budget | D05.02 | Cost Control Manager / Cost Controller | Project Director | Budget by cost code, transfers log | PDF, XLSX | CONTRACT |
| DOC-05-003 | Pre-construction (execution) BOQ | D05.03 | Technical Office Manager | Project Manager | Execution steps, materials, types, codes, quantities, reconciliation to contract BOQ | PDF, XLSX | CONTRACT |
| DOC-05-004 | Baseline schedule and narrative | D05.04 | Planner / Scheduler | Project Manager | Gantt, critical path, resources, cost loading, assumptions | PDF, XER / XML, XLSX | CONTRACT |
| DOC-05-005 | Project cash-flow plan | D05.05 | FP&A Analyst | CFO | Monthly in / out, net, cumulative | PDF, XLSX | FIN |
| DOC-05-006 | Project execution plan and sub-plans | D05.06 | Project Manager | Project Director | Scope, organisation, quality, HSE, logistics, procurement, documents, BIM | PDF, DOCX | CONTRACT |
| DOC-05-007 | Project staffing plan | D05.07 | Project Manager | Recruitment / Headcount Committee | Positions by month, grades, dates needed | PDF, XLSX | OPS |
| DOC-05-008 | Site logistics layout | D05.08 | Site Logistics Manager | Project Manager | Facilities, cranes, access, laydown | PDF, DWG / DXF | OPS |
| DOC-05-009 | Document, drawing, submittal and RFI registers | D05.09 | Document Control Manager / Controller | Technical Office Manager | Number, title, revision, status, dates | PDF, XLSX | CONTRACT |
| DOC-05-010 | Transmittal | D05.10 | Document Control Manager / Controller | Technical Office Manager | Documents issued, revisions, purpose, recipients | PDF | CONTRACT |
| DOC-05-011 | Site possession / hand-over-of-site record | D05.08 | Site Logistics Manager | Project Manager | Date, boundaries, existing conditions, photos, utilities | PDF | CONTRACT |
| DOC-08-001 | Progress measurement sheet | D08.01 | Progress Measurement Engineer | Planner / Scheduler | Activity, rule of credit, % complete, evidence | PDF, XLSX | CONTRACT |
| DOC-08-002 | Schedule update and narrative | D08.02 | Planner / Scheduler | Project Manager | Progress, forecast dates, critical path, variances | PDF, XER / XML | CONTRACT |
| DOC-08-003 | Look-ahead plan (e.g. 3 / 6 weeks) with constraints | D08.03 | Planner / Scheduler | Construction Manager | Activities, constraints, owners | PDF, XLSX | OPS |
| DOC-08-004 | Earned value report | D08.04 | Cost Control Manager / Cost Controller | Project Manager | PV, EV, AC, SPI, CPI, S-curves | PDF, XLSX | CONTRACT |
| DOC-08-005 | Cost report and EAC | D08.05 | Cost Control Manager / Cost Controller | Project Manager | Budget, commitments, actual, ETC, EAC, variance | PDF, XLSX | CONTRACT |
| DOC-08-006 | Project risk register | D08.07 | Risk Manager | Project Manager | Risks, ratings, responses, owners, due dates | PDF, XLSX | CONTRACT |
| DOC-08-007 | Delay analysis and recovery plan | D08.08 | Planning Manager | Project Manager | Method, events, impact, recovery measures | PDF, XER / XML | CONTRACT |
| DOC-08-008 | Change request and CCB decision | D08.09 | Project Engineer / Project Coordinator | Project Manager | Change, impact (cost / time), decision | PDF | CONTRACT |
| DOC-08-009 | Weekly / monthly project report | D08.10 | Reporting / Data Analyst | Project Manager | Progress, photos, cost, cash, HSE, quality, risks, issues | PDF, PPTX | CONTRACT |
| DOC-08-010 | Interface register | D08.11 | Interface Manager | Project Manager | Interfaces, parties, status | PDF, XLSX | OPS |
| DOC-08-011 | Project cash-flow forecast update | D08.06 | FP&A Analyst | CFO | Actual vs plan, forecast by month | PDF, XLSX | FIN |
| DOC-08-012 | Progress photo log | D08.01 | Site Engineer (Civil / Arch / MEP) | Progress Measurement Engineer | Photos with date, location, activity | PDF | CONTRACT |

### 2.3 Design, technical office and interiors
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-06-001 | Design deliverables tracker | D06.01 | Design Manager (D&B) | Project Manager | Deliverable, designer, due, status | PDF, XLSX | CONTRACT |
| DOC-06-002 | Drawing / model review comment sheet | D06.02 | TO Engineer — Architectural / Structural / Infrastructure | Technical Office Manager | Comment, location, discipline, response, closure | PDF, XLSX | CONTRACT |
| DOC-06-003 | Request for information (RFI) | D06.03 | TO Engineer — Architectural / Structural / Infrastructure | Technical Office Manager | Question, references, proposed solution, response | PDF | CONTRACT |
| DOC-06-004 | Design revision impact list | D06.04 | Technical Office Manager | Project Manager | Changed items, affected drawings / orders / BOQ / activities | PDF, XLSX | CONTRACT |
| DOC-06-005 | Shop drawing (per discipline) | D06.05 | BIM Modeller / CAD Draftsman (per discipline) | Consultant / Engineer | Title block, revision, status stamp | PDF, DWG / DXF, IFC | PERM |
| DOC-06-006 | Material submittal | D06.06 | Submittals Engineer | Consultant / Engineer | Product data, compliance statement, samples, mock-up record | PDF | CONTRACT |
| DOC-06-007 | Method statement | D06.07 | Method Statement Engineer | Consultant / Engineer | Sequence, resources, HSE, quality, ITP references | PDF, DOCX | CONTRACT |
| DOC-06-008 | Clash report | D06.08 | BIM Coordinator | BIM Manager | Clash groups, location, owners, status | PDF, XLSX, IFC | OPS |
| DOC-06-009 | Temporary works design and lifting plan | D06.09 | Temporary Works Engineer | Technical Office Manager | Loads, design check, drawings, lift plan | PDF, DWG / DXF | CONTRACT |
| DOC-06-010 | Value engineering proposal | D06.10 | Value Engineering Engineer | Consultant / Engineer | Alternative, cost / time / quality impact | PDF | CONTRACT |
| DOC-06-011 | Quantity take-off sheet | D06.11 | TO Engineer — Architectural / Structural / Infrastructure | Quantity Surveyor (project) | Item, drawing / model reference, dimensions, quantity | PDF, XLSX | CONTRACT |
| DOC-06-012 | As-built drawings / model | D06.12 | As-built Engineer | Consultant / Engineer | As-built geometry, revisions | PDF, DWG / DXF, IFC | PERM |
| DOC-07-001 | Verified as-built base (interiors) | D07.01 | Interior Designer | Technical Office Manager | Measured base plans | PDF, DWG / DXF | CONTRACT |
| DOC-07-002 | Layout options set and client selection | D07.02 | Interior Designer | Client | Options, comparison, client choice | PDF | CONTRACT |
| DOC-07-003 | Style / concept boards | D07.03 | Interior Designer | Client | Style, palette, materials, references | PDF, PPTX | CONTRACT |
| DOC-07-004 | 3D package and renders | D07.04 | 3D Visualiser | Design Director (Architecture & Interiors) | Views, walkthrough, material callouts | PDF, PNG / JPG, GLB / IFC | CONTRACT |
| DOC-07-005 | Interior BOQ and FF&E schedule | D07.05 | FF&E Specialist | Design Director (Architecture & Interiors) | Items, materials, codes, quantities, suppliers | PDF, XLSX | CONTRACT |
| DOC-07-006 | 2D interior design package | D07.06 | Interior Designer | Client | Plans, elevations, sections, details, schedules | PDF, DWG / DXF | PERM |
| DOC-07-007 | Architectural design package | D07.08 | Architect | Client | Plans, elevations, sections, reports | PDF, DWG / DXF, IFC | PERM |
| DOC-07-008 | Interior shop drawings | D07.07 | BIM Modeller / CAD Draftsman (per discipline) | Consultant / Engineer | Title block, revision, status stamp, details | PDF, DWG / DXF | PERM |

### 2.4 Procurement, stores, plant and production
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-09-001 | Material requisition | D09.01 | Material Planner | Project Manager | Item codes, quantities, need date, budget line | PDF | FIN |
| DOC-09-002 | Request for quotation | D09.02 | Buyer (local / import) | Procurement Manager | Scope, specs, terms, deadline | PDF, DOCX | FIN |
| DOC-09-003 | Comparative statement and recommendation | D09.03 | Buyer (local / import) | Procurement Committee | Offers levelled, technical evaluation, recommendation | PDF, XLSX | FIN |
| DOC-09-004 | Purchase order | D09.04 | Buyer (local / import) | Procurement Manager | Items, prices, delivery, terms, tax | PDF | FIN |
| DOC-09-005 | Subcontract agreement / work order | D09.04 | Subcontract Procurement Manager | Procurement Manager | Scope, rates, retention, advance, terms, back-to-back clauses | PDF, DOCX | CONTRACT |
| DOC-09-006 | Vendor prequalification and evaluation form | D09.05 | Vendor Management Officer | Procurement Manager | Criteria, scores, documents, decision | PDF | OPS |
| DOC-09-007 | Expediting report | D09.06 | Expeditor | Procurement Manager | Order, promised vs need date, status | PDF, XLSX | OPS |
| DOC-09-008 | Import / customs clearance file and landed cost | D09.07 | Logistics / Customs Officer | Procurement Manager | Shipping documents, duties, landed cost | PDF, XLSX | FIN |
| DOC-09-009 | Subcontract variation / termination notice | D09.08 | Subcontract Administrator | Commercial Manager (project) | Change / default, value, notice period | PDF | CONTRACT |
| DOC-10-001 | Goods received note (GRN) | D10.01 | Site Storekeeper | Stores Manager / Storekeeper / Inventory Controller | PO, items, quantities, condition, inspection reference | PDF | FIN |
| DOC-10-002 | Material inspection report | D10.01 | QC Inspector (Civil / Arch / MEP) | QA/QC Manager | Compliance with approved submittal | PDF | CONTRACT |
| DOC-10-003 | Store transfer note | D10.02 | Site Storekeeper | Stores Manager / Storekeeper / Inventory Controller | From / to, items, valuation | PDF | FIN |
| DOC-10-004 | Material issue note | D10.03 | Site Storekeeper | Site Engineer (Civil / Arch / MEP) | Items, quantities, cost code, activity | PDF | FIN |
| DOC-10-005 | Stock count sheet and adjustment | D10.04 | Stores Manager / Storekeeper / Inventory Controller | Finance Manager / Chief Accountant | Counted vs book, variance, approval | PDF, XLSX | FIN |
| DOC-10-006 | Material reconciliation report | D10.05 | Cost Control Manager / Cost Controller | Project Manager | Theoretical vs actual, wastage | PDF, XLSX | OPS |
| DOC-10-007 | Materials-on-site list | D10.06 | Quantity Surveyor (project) | Commercial Manager (project) | Items, quantities, value, evidence | PDF, XLSX | FIN |
| DOC-10-008 | Disposal record | D10.07 | Stores Manager / Storekeeper / Inventory Controller | Procurement Manager | Items, value, method, approval | PDF | FIN |
| DOC-10-009 | Return to vendor / debit note | D10.08 | Stores Manager / Storekeeper / Inventory Controller | Procurement Manager | GRN / PO link, quantities, reason | PDF | FIN |
| DOC-11-001 | Equipment plan | D11.01 | Plant Manager / Equipment Planner | Plant & Equipment Director | Equipment by project and period | PDF, XLSX | OPS |
| DOC-11-002 | Equipment hire order | D11.02 | Plant Manager / Equipment Planner | Plant & Equipment Director | Equipment, rate, period, terms | PDF | FIN |
| DOC-11-003 | Equipment logbook / fuel issue log | D11.03 | Operator (crane, excavator, loader, …) | Site Engineer (Civil / Arch / MEP) | Hours, work, fuel, breakdowns | PDF, XLSX | OPS |
| DOC-11-004 | Maintenance job card | D11.04 | Maintenance Planner / Mechanic | Plant Manager / Equipment Planner | Fault, work done, parts, hours | PDF | OPS |
| DOC-11-005 | Plant charge statement | D11.05 | Cost Accountant | Finance Manager / Chief Accountant | Equipment, hours, internal rate, project | PDF, XLSX | FIN |
| DOC-11-006 | Capex request | D11.06 | Plant & Equipment Director | Capex / Plant Investment Committee | Need, options, hire-vs-buy, cost | PDF | FIN |
| DOC-25-001 | Pour request and batch ticket | D25.01 | Site Engineer (Civil / Arch / MEP) | Batching Plant Manager / Operator | Mix, quantity, time, delivery, samples | PDF | CONTRACT |
| DOC-25-002 | Precast production record | D25.02 | Precast Plant Manager | QA/QC Manager | Element, cast date, tests, release | PDF | CONTRACT |
| DOC-25-003 | Fabrication order and cut list | D25.03 | Production Planner | Workshop Manager (steel / carpentry / aluminium) | Shop drawing revision, parts, cut list | PDF, XLSX | OPS |
| DOC-25-004 | Production schedule and internal charges | D25.04 | Production Planner | Production & Workshops Director (if owned) | Orders, capacity, internal prices | PDF, XLSX | FIN |

### 2.5 Site, quality and HSE
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-12-001 | Permit to work | D12.01 | Site Engineer (Civil / Arch / MEP) | HSE Manager | Work, hazards, controls, validity, sign-off | PDF | HSE |
| DOC-12-002 | Daily work plan / crew allocation | D12.02 | Site Manager / Senior Site Engineer | Construction Manager | Activities, crews, plant, constraints | PDF | OPS |
| DOC-12-003 | Inspection request (IR) | D12.03 | Site Engineer (Civil / Arch / MEP) | Consultant / Engineer | Work, location, drawing ref, result | PDF | CONTRACT |
| DOC-12-004 | Daily diary / daily report | D12.04 | Site Engineer (Civil / Arch / MEP) | Site Manager / Senior Site Engineer | Manpower, plant, weather, work done, events, photos, visitors | PDF | CONTRACT |
| DOC-12-005 | Site instruction register | D12.05 | Site Manager / Senior Site Engineer | Contracts Engineer | Instruction, source, date, variation / notice flag | PDF, XLSX | CONTRACT |
| DOC-12-006 | Measurement sheet | D12.06 | Site Engineer (Civil / Arch / MEP) | Quantity Surveyor (project) | Item, location, dimensions, quantity, drawing ref | PDF, XLSX | CONTRACT |
| DOC-12-007 | Site meeting minutes | D12.07 | Project Engineer / Project Coordinator | Construction Manager | Attendees, decisions, actions, owners, dates | PDF | CONTRACT |
| DOC-12-008 | Productivity report | D12.08 | Construction Manager | Project Manager | Output vs hours by cost code | PDF, XLSX | OPS |
| DOC-12-009 | Setting-out / survey record | D12.10 | Surveyor (land) | Site Engineer (Civil / Arch / MEP) | Points, levels, benchmarks, instrument | PDF, DWG / DXF | CONTRACT |
| DOC-12-010 | Offline sync conflict log | D12.09 | Site Engineer (Civil / Arch / MEP) | Site Manager / Senior Site Engineer | Record, device, conflict, resolution | PDF | OPS |
| DOC-12-011 | Daywork sheet | D12.06 | Site Engineer (Civil / Arch / MEP) | Consultant / Engineer | Labour, plant, materials on daywork, instruction reference | PDF | CONTRACT |
| DOC-13-001 | Project quality plan and ITPs | D13.01 | QA Engineer | Consultant / Engineer | Procedures, hold / witness points, records | PDF, DOCX | CONTRACT |
| DOC-13-002 | Material test report | D13.02 | Lab Technician / Materials Tester | QC Inspector (Civil / Arch / MEP) | Sample, standard, results, pass / fail | PDF | CONTRACT |
| DOC-13-003 | Inspection and test record / checklist | D13.03 | QC Inspector (Civil / Arch / MEP) | Consultant / Engineer | Checklist items, results, photos | PDF | CONTRACT |
| DOC-13-004 | Non-conformance report and corrective action | D13.04 | QC Inspector (Civil / Arch / MEP) | QA/QC Manager | Defect, disposition, root cause, closure | PDF | CONTRACT |
| DOC-13-005 | Quality audit report | D13.05 | Management System Representative (ISO 9001 / 14001 / 45001) | QHSE Director | Findings, evidence, actions | PDF | OPS |
| DOC-13-006 | Calibration certificate register | D13.06 | Calibration Controller | QA/QC Manager | Instrument, date, due, certificate | PDF, XLSX | OPS |
| DOC-13-007 | Snag list | D13.07 | QC Inspector (Civil / Arch / MEP) | Handover & Warranty Manager | Location, defect, photo, owner, closure | PDF, XLSX | CONTRACT |
| DOC-14-001 | HSE plan | D14.01 | HSE Manager | QHSE Director | Organisation, hazards, controls, legal register | PDF, DOCX | HSE |
| DOC-14-002 | Risk assessment / JSA | D14.02 | HSE Engineer / Safety Officer | HSE Manager | Steps, hazards, controls, residual risk | PDF | HSE |
| DOC-14-003 | Induction and training record | D14.03 | HSE Engineer / Safety Officer | HSE Manager | Person, topic, date, trainer | PDF | HR |
| DOC-14-004 | HSE inspection report | D14.04 | HSE Engineer / Safety Officer | HSE Manager | Observations, photos, actions | PDF | HSE |
| DOC-14-005 | Incident report and investigation | D14.05 | HSE Engineer / Safety Officer | HSE Manager | Facts, injuries, root cause, actions, notifications | PDF | HSE |
| DOC-14-006 | Stop-work order and restart authorisation | D14.06 | HSE Engineer / Safety Officer | HSE Manager | Reason, scope, corrective actions, restart | PDF | HSE |
| DOC-14-007 | Monthly HSE statistics report | D14.07 | HSE Manager | QHSE Director | Hours worked, incidents, rates, leading indicators | PDF, XLSX | HSE |
| DOC-14-008 | Environmental monitoring record | D14.08 | Environmental Officer | HSE Manager | Parameter, limit, reading, action | PDF, XLSX | HSE |
| DOC-14-009 | Emergency drill record | D14.09 | Fire Warden | HSE Manager | Scenario, time, findings | PDF | HSE |
| DOC-14-010 | Gate log / security incident report | D14.10 | Security Guard / Watchman (reports to Security Manager, 4.9) | Security Manager / Site Security Supervisor | Entries, vehicles, incidents | PDF | OPS |

### 2.6 Commercial and finance
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-15-001 | Client interim payment certificate (IPC) / application | D15.01 | Quantity Surveyor (project) | Commercial Manager (project) | Cumulative / previous / current; variations; MOS; retention; advance recovery; tax; amount in words | PDF, XLSX | FIN |
| DOC-15-002 | Certification difference log | D15.02 | Quantity Surveyor (project) | Commercial Manager (project) | Submitted vs certified per item, reason | PDF, XLSX | FIN |
| DOC-15-003 | Price escalation claim | D15.03 | Quantity Surveyor (project) | Commercial Manager (project) | Formula, indices, base / current, amount | PDF, XLSX | FIN |
| DOC-15-004 | Subcontractor payment certificate | D15.04 | Subcontract Administrator | Commercial Manager (project) | Cumulative valuation, retention, advance recovery, back-charges, tax, net | PDF, XLSX | FIN |
| DOC-15-005 | Back-charge notice | D15.05 | Subcontract Administrator | Commercial Manager (project) | Default, evidence, amount | PDF | CONTRACT |
| DOC-15-006 | Variation notice / order / valuation | D15.06 | Contracts Engineer | Commercial Manager (project) | Instruction, notice date, valuation basis, agreed value | PDF | CONTRACT |
| DOC-15-007 | Claim / EOT submission | D15.07 | Claims Manager / Engineer | Claims & Disputes Committee | Event, notice, delay analysis, cost, evidence | PDF, DOCX | CONTRACT |
| DOC-15-008 | Cost-value reconciliation (CVR) | D15.08 | Commercial Manager (project) | Project Director | Value, cost, margin, risks / opportunities | PDF, XLSX | FIN |
| DOC-15-009 | Final account statement | D15.09 | Final Account QS | Commercial Director (CCO) | Contract sum, variations, claims, certificates, balance | PDF, XLSX | PERM |
| DOC-15-010 | Letter / notice | D15.10 | Contracts Engineer | Contracts Manager | Reference, subject, clause, content | PDF, DOCX | CONTRACT |
| DOC-15-011 | Meeting minutes (client / engineer) | D15.11 | Contract Administrator (project) | Project Manager | Attendees, discussions, decisions, actions | PDF | CONTRACT |
| DOC-15-012 | Liquidated damages exposure report | D15.12 | Quantity Surveyor (project) | Commercial Manager (project) | Contract dates, forecast, rate, cap, exposure | PDF | CONTRACT |
| DOC-15-013 | Subcontract advance payment certificate | D15.13 | Subcontract Administrator | Commercial Manager (project) | Amount, limit, guarantee, recovery | PDF | FIN |
| DOC-16-001 | Chart of accounts and posting rules listing | D16.01 | Finance Manager / Chief Accountant | Financial Controller | Accounts, rules by source | PDF, XLSX | FIN |
| DOC-16-002 | Supplier invoice voucher (3-way match) | D16.02 | Accountant — GL / AP / AR / Project | Finance Manager / Chief Accountant | PO, GRN, invoice, tax, posting | PDF | FIN |
| DOC-16-003 | Tax invoice / e-invoice to client | D16.03 | Accountant — GL / AP / AR / Project | Finance Manager / Chief Accountant | Certified amount, tax, e-invoice identifiers | PDF, JSON (e-invoice) | FIN |
| DOC-16-004 | Receipt voucher | D16.04 | Treasury Manager / Cashier | Finance Manager / Chief Accountant | Payer, amount, allocation, bank | PDF | FIN |
| DOC-16-005 | Aging and collection plan | D16.04 | Credit Control / Collections Officer | CFO | Receivables by age, actions | PDF, XLSX | FIN |
| DOC-16-006 | Payment voucher and payment run | D16.05 | Treasury Manager / Cashier | CFO | Payee, invoices, amount in words, approvals | PDF | FIN |
| DOC-16-007 | Bank reconciliation statement | D16.06 | Accountant — GL / AP / AR / Project | Finance Manager / Chief Accountant | Book vs bank, reconciling items | PDF, XLSX | FIN |
| DOC-16-008 | Cash position and cash forecast | D16.07 | Treasury Manager / Cashier | CFO | Balances, inflows, outflows by week / month | PDF, XLSX | FIN |
| DOC-16-009 | Monthly commitments report | D16.08 | FP&A Analyst | CFO | Payroll, subcontract, supplier, instalments, facilities by month | PDF, XLSX | FIN |
| DOC-16-010 | Guarantee register | D16.09 | Banking & Guarantees Officer | CFO | Guarantees, amounts, expiry, release | PDF, XLSX | CONTRACT |
| DOC-16-011 | Fixed asset register and depreciation schedule | D16.10 | Fixed Assets Accountant | Finance Manager / Chief Accountant | Assets, tags, cost, depreciation | PDF, XLSX | FIN |
| DOC-16-012 | Insurance claim file | D16.11 | Insurance Officer | CFO | Event, notification, loss, recovery | PDF | CONTRACT |
| DOC-16-013 | Tax returns and tax reports | D16.12 | Tax Manager / Officer | CFO | VAT, withholding, e-documents summary | PDF, XLSX | FIN |
| DOC-16-014 | Petty cash report | D16.13 | Site Accountant / Petty Cash Custodian | Finance Manager / Chief Accountant | Expenses, receipts, replenishment | PDF | FIN |
| DOC-16-015 | Payroll journal | D16.14 | Payroll Accountant | Finance Manager / Chief Accountant | Gross, deductions, contributions, cost allocation | PDF, XLSX | FIN |
| DOC-16-016 | Financial statements and trial balance | D16.15 | Finance Manager / Chief Accountant | CFO | Statements, notes, trial balance | PDF, XLSX | PERM |
| DOC-16-017 | Revenue recognition run report | D16.16 | Accountant — GL / AP / AR / Project | Financial Controller | Progress, revenue to date, contract asset / liability, provision | PDF, XLSX | FIN |
| DOC-16-018 | Budget vs actual and consolidation pack | D16.17 | FP&A Analyst | Financial Controller | Variances, eliminations, consolidated statements | PDF, XLSX | FIN |
| DOC-16-019 | Cut-over reconciliation report | D16.18 | Financial Controller | CFO | Control accounts vs detail, differences, hash | PDF, XLSX | PERM |
| DOC-16-020 | Journal voucher | D16.19 | Accountant — GL / AP / AR / Project | Finance Manager / Chief Accountant | Lines, accounts, cost codes, source, approvals | PDF | FIN |

### 2.7 HR, administration, legal, hand-over, FM, IT and executive
| Code | Document | Process | Prepared by | Approved by | Key content | Formats | Ret. |
|---|---|---|---|---|---|---|---|
| DOC-17-001 | Organisation chart and job descriptions | D17.01 | Organisation Development Specialist | CEO / Managing Director | Positions, reporting lines, JDs | PDF, PPTX, DOCX | HR |
| DOC-17-002 | Workforce gap report | D17.02 | Organisation Development Specialist | Recruitment / Headcount Committee | Required vs filled by unit / project / discipline, grade, date needed, salary band | PDF, XLSX | HR |
| DOC-17-003 | Vacancy approval and job offer | D17.03 | Recruitment Specialist | HR Director (CHRO) | Position, grade, package, start date | PDF | HR |
| DOC-17-004 | Employment contract | D17.04 | HR / Personnel Officer | HR Director (CHRO) | Terms per labour law and company policy | PDF, DOCX | HR |
| DOC-17-005 | Timesheet / attendance sheet | D17.05 | Site Timekeeper | Site Manager / Senior Site Engineer | Days, hours, overtime, project, cost code | PDF, XLSX | HR |
| DOC-17-006 | Leave request and approval | D17.06 | Employee (self-service) | Line manager | Type, dates, balance | PDF | HR |
| DOC-17-007 | Payroll register and payslips | D17.07 | Payroll Specialist (HR) | CFO | Earnings, deductions, social insurance, tax, net | PDF, XLSX | HR |
| DOC-17-008 | Performance appraisal | D17.08 | Performance Management Specialist | HR Director (CHRO) | Objectives, KPIs, rating, development | PDF | HR |
| DOC-17-009 | Training record and certificate | D17.09 | Training & Development Specialist | HR Director (CHRO) | Course, date, result, expiry | PDF | HR |
| DOC-17-010 | Transfer order | D17.10 | HR / Personnel Officer | HR Director (CHRO) | From / to project, date, cost centre | PDF | HR |
| DOC-17-011 | Disciplinary / grievance file | D17.11 | HR / Personnel Officer | HR Director (CHRO) | Facts, hearing, decision | PDF | HR |
| DOC-17-012 | End-of-service settlement and clearance | D17.12 | HR / Personnel Officer | CFO | Entitlements, deductions, clearance sign-offs | PDF | HR |
| DOC-17-013 | Work permit register | D17.13 | Work Permits / Expatriate Officer | HR Director (CHRO) | Person, permit, expiry | PDF, XLSX | HR |
| DOC-17-014 | Medical insurance enrolment and claims record | D17.14 | Employee Welfare / Medical Insurance Officer | HR Director (CHRO) | Member, cover, claims | PDF | HR |
| DOC-18-001 | Correspondence register | D18.03 | Archive / Records Officer | Administration Manager | In / out, reference, subject, owner | PDF, XLSX | CONTRACT |
| DOC-18-002 | Office service / supplies request | D18.01 | Employee (self-service) | Administration Manager | Request, cost, budget line | PDF | OPS |
| DOC-18-003 | Housing / camp allocation record | D18.02 | Camp / Housing Coordinator | Administration Manager | Person, unit, dates, capacity | PDF, XLSX | OPS |
| DOC-18-004 | Vehicle request and trip log | D18.04 | Fleet Coordinator / Driver | Administration Manager | Trip, vehicle, km, fuel | PDF, XLSX | OPS |
| DOC-19-001 | Legal opinion | D19.01 | Legal Advisor | General Counsel | Question, analysis, opinion | PDF | PERM |
| DOC-19-002 | Dispute / arbitration file index | D19.02 | Arbitration / Disputes Counsel | General Counsel | Pleadings, evidence, awards | PDF | PERM |
| DOC-19-003 | Corporate documents and licences register | D19.03 | Corporate Affairs Officer | General Counsel | Registrations, classification, licences, expiry | PDF, XLSX | PERM |
| DOC-19-004 | Permit register | D19.04 | Licensing & Permits Officer | Project Manager | Permit, authority, validity | PDF, XLSX | CONTRACT |
| DOC-19-005 | Power of attorney register | D19.05 | Legal Advisor | General Counsel | Holder, scope, expiry | PDF | PERM |
| DOC-20-001 | Testing and commissioning record | D20.01 | Testing & Commissioning Engineer | Consultant / Engineer | System, test, results, witnesses | PDF | PERM |
| DOC-20-002 | Taking-over certificate | D20.02 | Handover & Warranty Manager | Client | Scope, date, outstanding works | PDF | PERM |
| DOC-20-003 | Authority occupancy approvals | D20.03 | Authorities & Utilities Liaison | Authority | Approval, conditions | PDF | PERM |
| DOC-20-004 | Hand-over file (O&M manuals, warranties, as-built index) | D20.04 | Handover & Warranty Manager | Client | Index, manuals, warranties, spares, training | PDF | PERM |
| DOC-20-005 | Defects register (DLP) | D20.05 | Handover & Warranty Manager | Client | Defect, date, response, closure | PDF, XLSX | CONTRACT |
| DOC-20-006 | Retention / bond release request | D20.06 | Quantity Surveyor (project) | Commercial Manager (project) | Certificate reference, amount, guarantee to release | PDF | FIN |
| DOC-20-007 | Project close-out report and lessons learned | D20.07 | Project Manager | Project Director | Final cost, margin, time, lessons, rates feedback | PDF, PPTX | PERM |
| DOC-20-008 | End-user unit hand-over form | D20.08 | Customer Care Officer (end-user units) | End user | Unit, condition, meter readings, keys, signature | PDF | CONTRACT |
| DOC-21-001 | FM work order | D21.01 | FM Helpdesk Operator | FM Manager | Request, priority, SLA, completion | PDF | OPS |
| DOC-21-002 | PPM schedule and record | D21.02 | Maintenance Engineer (MEP / civil) | FM Manager | Asset, task, frequency, done date | PDF, XLSX | OPS |
| DOC-21-003 | SLA report and FM invoice | D21.03 | FM Manager | Finance Manager / Chief Accountant | SLA results, penalties, invoice | PDF | FIN |
| DOC-22-001 | Access review report | D22.01 | ERP / MISHEL Administrator | IT & Digital Director (CIO) | Users, roles, last use, exceptions | PDF, XLSX | OPS |
| DOC-22-002 | Configuration change record | D22.02 | ERP / MISHEL Administrator | IT & Digital Director (CIO) | Change, impact, test, rollback | PDF | OPS |
| DOC-22-003 | AI agent register entry | D22.03 | AI Operations Specialist | AI Governance Committee | Scope, data, tools, version, quality review | PDF | PERM |
| DOC-22-004 | Data import log | D22.04 | Application Developer / Integrator | IT & Digital Director (CIO) | Source, rows, refused rows, reconciliation | PDF, XLSX | OPS |
| DOC-22-005 | Backup / restore test report | D22.05 | System / Network Administrator | IT & Digital Director (CIO) | Backup set, restore result, time | PDF | OPS |
| DOC-22-006 | Security incident report | D22.06 | Cybersecurity Officer | IT & Digital Director (CIO) | Event, impact, containment, evidence | PDF | PERM |
| DOC-22-007 | Privacy / retention register and erasure record | D22.07 | Data Protection Officer | General Counsel | Data categories, purpose, retention, actions | PDF | PERM |
| DOC-22-008 | Report specification and distribution list | D22.09 | Data / BI Analyst | IT & Digital Director (CIO) | Data sources, filters, permissions, schedule, recipients | PDF | OPS |
| DOC-23-001 | Portfolio dashboard snapshot / management pack | D23.01 | Reporting / Data Analyst | CEO / Managing Director | All projects: phase, KPIs, PV / EV / AC, progress, cash, issues | PDF, PPTX, XLSX | OPS |
| DOC-23-002 | Company cash and commitments review | D23.02 | FP&A Analyst | CFO | Cash, commitments, funding needs | PDF, XLSX | FIN |
| DOC-23-003 | Workforce gap review decisions | D23.03 | Organisation Development Specialist | Recruitment / Headcount Committee | Gaps reviewed, decisions, approved vacancies | PDF | HR |
| DOC-24-001 | Control exception log | D24.01 | Internal Auditor / Compliance Officer | Head of Internal Audit | Exception, process, user, resolution | PDF, XLSX | FIN |
| DOC-24-002 | Compliance calendar status | D24.02 | Internal Auditor / Compliance Officer | Head of Internal Audit | Obligation, due, status | PDF, XLSX | OPS |

## 3. Retention classes (periods are inputs, not defaults)
| Class | Applies to | Period source |
|---|---|---|
| PERM | Corporate, contracts as signed, final accounts, as-built, T&C, hand-over, statements, legal | Kept permanently unless the company decides otherwise |
| CONTRACT | Project records that may be needed for claims, defects liability or disputes | Contract life + period set by the company with legal advice (limitation and defects-liability rules) |
| FIN | Accounting and tax records | Period required by tax / commercial law — legal / tax-advisor input |
| HR | Personnel, payroll, training | Period required by labour / social-insurance law — legal input |
| HSE | Permits, incidents, inspections | Period required by occupational-safety law — legal input |
| OPS | Operational records without legal minimum | Company setting |
Legal hold (dispute, audit, investigation) overrides any retention expiry.

## 4. Registers and live reports (screens that are also exportable)
Every register in section 2 is a live, filterable screen with the same export formats. In addition:
| Report | Content | Formats |
|---|---|---|
| Owner portfolio dashboard | All projects, phases, KPIs, PV / EV / AC, progress, cash, risks, issues; drill-down to project and source records | Screen, PDF, PPTX, XLSX |
| Department dashboards (one per MP-01 department) | Department KPIs (MP-01 §10), workload, overdue items | Screen, PDF, XLSX |
| Project control room | Schedule, cost, cash, procurement, quality, HSE, documents status for one project | Screen, PDF, PPTX |
| Overdue / time-bar watch | Notices and responses due, by project and owner | Screen, PDF, XLSX |
| Expiry watch | Guarantees, insurances, permits, licences, certificates, work permits, calibrations | Screen, PDF, XLSX |
| Workforce gap and commitments | Gap alarm, vacancies, monthly commitments | Screen, PDF, XLSX |
| Audit trail report | Any record: who changed what, when, before / after | Screen, PDF, XLSX |
| User-built reports | Report designer within the viewer's permissions, scheduled distribution (D22.09) | Screen, PDF, XLSX, CSV |

## 5. Export, print and exchange engine (to build)
| Need | Approach | Candidate open-source component (licence checked at adoption, OQS-001) |
|---|---|---|
| Pixel-exact PDF with Arabic RTL, fonts, QR, watermark | HTML / CSS templates rendered to PDF server-side | Headless Chromium via Playwright (Apache-2.0) — already used by the test gate; pdf-lib (MIT) for stamping / merging |
| Excel export with formulas and formats | Server-side workbook generation | ExcelJS (MIT) |
| Word export | Server-side document generation | docx (MIT) |
| PowerPoint export | Server-side slide generation | PptxGenJS (MIT) |
| Drawings / models | DXF read / write, IFC read / write (MP-05) | Selected in MP-05 |
| Schedule exchange | Primavera XER / P6 XML, MS Project XML import / export (MP-05) | Selected in MP-05 |
| Data import | CSV / XLSX with row-level dry run (pattern already built for cut-over, CC-065) | Same engine |
| E-invoice / e-receipt | Tax-authority format and signing | Specification and credentials are owner inputs (OI-2) |
| Print | Browser print of the PDF; batch print of a register selection | — |
Rules: an export carries the same permissions as the screen; restricted data cannot be exported without the right;
every export and print is logged; exported numbers are exactly the database values (money as text from SQL, never
re-computed in the browser).

## 6. Coverage and review record
**Counts (computed by script):** 220 documents — DOC-01 9 · 02 7 · 03 17 · 04 8 · 05 11 · 06 12 · 07 8 · 08 12 ·
09 9 · 10 9 · 11 6 · 12 11 · 13 7 · 14 10 · 15 13 · 16 20 · 17 14 · 18 4 · 19 5 · 20 8 · 21 3 · 22 8 · 23 3 · 24 2 ·
25 4; 6 retention classes; 8 cross-cutting reports in addition to every register; 209 of the 210 MP-02 processes
produce at least one document. The exception is D22.08 "ask-the-business": answers are not documents; each question,
answer and its sources are kept in the audit trail.

**Automated checks (scratchpad `check_mp03.py` + table check):** every row has its header's column count; codes
unique and consecutive per domain; the code's domain equals its process's domain; every process exists in MP-02;
every preparer / approver is an MP-01 position or body or one of the named external / generic parties; every
retention class is defined; no document has the same position as preparer and approver.

**Review log (OQS-001):**
- R3 truth: code status verified (no export / document library in either `package.json`, no file-download response
  in `backend/src`); the five candidate libraries are named with their published licences and are re-checked at
  adoption; no retention period, legal text or e-signature rule is stated — they are legal inputs.
- Automated check 1 — 7 documents had the same position as preparer and approver (store transfer, fabrication
  order, site minutes, receipt voucher, leave, unit hand-over, FM invoice): corrected to a separate preparer or
  approver. 15 processes produced no document: 14 documents added; the remaining exception is justified above.
- Hostile pass 1 — manual journal entries had no process although the GL source `manual_journal` exists in the code:
  MP-02 D16.19 added and the journal voucher re-linked to it; standard documents missing: letter of award / notice to
  commence, site possession record, progress photo log, daywork sheet — added.
- Hostile pass 2 — electronic-signature legal effect stated as a legal input; unspecified "images, 3D model" formats
  made explicit; generic parties (Client, Consultant / Engineer, Authority, End user, Line manager, Employee
  self-service) defined in the legend.
- Scope boundary (stated, not hidden): this catalogue fixes each document's identity, owner, approver, process,
  content and formats; the field-by-field template of each document is produced when that document is built, from
  this row, and passes the same review.

**Status:** reviewed (automated checks + two hostile passes); awaiting owner approval.
