# MP-06 — UI / UX design system, navigation, screens, dashboards, alerts, mobile and portals

Master Plan part 6 of 7 (OVD-001, OQS-001). Screens present MP-02 processes and MP-03 documents to MP-01 positions;
agents (MP-04) and engines (MP-05) appear inside them.

## 0. Code status (E3, verified 2026-10-15)
| Area | Exists | Gap |
|---|---|---|
| Shell and navigation | React SPA; `index.html` sets `lang="ar" dir="rtl"`; one flat side menu of 34 items (`Layout.tsx`); 36 page components | Menu labels are English while the page is Arabic RTL; no grouping, no workspace (company / entity / project) switcher, no global search, no favourites |
| Design tokens / CSS | One stylesheet (`global.css`, 70 lines) with colour variables (navy, blue, grey, gold, orange); Arabic font Cairo (`@fontsource/cairo`, weights 500 / 700 / 800) | No light / dark themes, one responsive breakpoint (900 px), no documented component library, no Latin font pairing |
| Components | 4 shared components (`Layout`, `ProtectedRoute`, `RecordTable`, `ReferenceSelect`) | No data grid (filters, grouping, totals, export), no form framework, no record-page template, no charts library |
| Localisation | — | No translation framework (no i18n library in `frontend/package.json`); labels hard-coded |
| Dashboards | Endpoints `/dashboards/executive`, `/dashboards/cost-control`, `/dashboards/portfolio` (`v_portfolio_summary`: project, status, contract value, billed %) used by `ExecutiveDashboard.tsx` | No EV / schedule / cash / risk / HSE / quality / staffing content; no drill-down; no browser or API check covers these endpoints |
| Notifications | Table `notifications`, filled by a trigger only for "approval pending" (migration 008); API list / mark read (`notifications.routes.ts`) | Not shown anywhere in the frontend; no other alert types; no e-mail / SMS channel; no escalation |
| Browser tests | Five Playwright checks (project controls, payments, revenue, MFA login, cut-over) | No accessibility, RTL / LTR or visual-regression checks |

## 1. Design principles
1. **Arabic-first, fully bilingual:** every label, message, document and number format available in Arabic and English;
   the user switches language and direction (RTL / LTR) at any time; no hard-coded text.
2. **Engineer-grade density:** large registers, frozen columns, keyboard navigation, bulk actions — without clutter.
3. **One pattern everywhere:** the same list → record → approval → document flow on every module (MP-02 §27).
4. **Every number traceable:** any figure on any screen opens the records it comes from; the data cut-off is shown.
5. **Safe by design:** irreversible actions ask for confirmation stating the consequence; the AI never presents a draft
   as approved (DRAFT marking, MP-04 rule 6).
6. **Accessible:** WCAG 2.2 level AA as the target, verified by tests (§9).
7. **Any device:** desktop, tablet and phone layouts; site functions work offline (§7).
8. **Company identity:** logo, colours and document letterheads come from company configuration; the product's own
   look stays consistent.

## 2. Design system
| Element | Specification |
|---|---|
| Colour roles | Brand primary / secondary (company-configurable), neutral scale, status roles (success, warning, danger, info, draft, locked); status never shown by colour alone — always with text / icon |
| Themes | Light and dark, both meeting contrast requirements; high-contrast option |
| Typography | Arabic font (Cairo today) paired with a Latin face of matching metrics; scale for headings, body, table, numerals; tabular numerals in tables |
| Numerals and dates | Company / user setting for Western or Arabic-Indic digits, decimal and thousands separators, Gregorian (Hijri optional) dates |
| Spacing and grid | One spacing scale and layout grid; density modes (comfortable / compact) |
| Icons | One icon set (lucide-react in use today), mirrored where direction matters |
| Core components | App shell; grouped navigation; contextual help and guided onboarding per screen (bilingual); workspace switcher; global search / command palette; data grid (sort, filter, group, totals, saved views, column chooser, frozen columns, bulk actions, export per MP-03); forms (validation, required markers, help text, reference pickers, attachments); record page template; approval timeline; comments and mentions; audit history; document viewer (PDF, images, DXF / IFC via MP-05); tabs; dialogs; toasts; empty / loading / error states; KPI tiles; charts; Gantt (MP-05); CAD / BIM canvas (MP-05); map; signature capture; file upload with progress |
| Record page template | Header (number, title, status, revision, owner), action bar (only actions the user's position may take), tabs: details · lines · documents · approvals · related records · history · comments · AI assistant (drafts with sources) |
| Charts | One chart library with accessible colour palette, direction-aware axes, values readable in both languages |

## 3. Information architecture and navigation
- **Workspace context:** company → legal entity / branch → project (or "all projects"); every screen respects it.
- **Home by role:** each MP-01 position lands on its home (tasks, approvals, alerts, its department dashboard).
- **Global search:** records, documents, people and commands in one box, within the user's permissions.
- **Grouped navigation** (the 34 current flat items are re-grouped; groups shown only if the user has rights):
| Group | MP-02 domains |
|---|---|
| Home, tasks and approvals | Cross-cutting (MP-02 §27), D23 |
| Business development and tendering | D02, D03 |
| Contracts and commercial | D04, D15 |
| Projects and planning | D05, D08 |
| Engineering and technical office | D06 |
| Design studio | D07 |
| Site execution | D12, D20 |
| Quality and HSE | D13, D14 |
| Supply chain, stores and plant | D09, D10, D11, D25 |
| Finance and tax | D16 |
| People and administration | D17, D18 |
| Legal, risk and audit | D01, D19, D24 |
| Facility management | D21 |
| System, data and AI | D22 |

## 4. Screen catalogue
- **Generated from one template set:** every MP-03 document type (220) has a **register screen** (data grid) and a
  **record screen** (record page template); every MP-02 process (210) is reachable from its group.
- **Special workspaces (built individually):**
| Workspace | Purpose | Main users |
|---|---|---|
| Owner portfolio | All projects and the company at a glance, drill-down (§5) | CEO / Managing Director |
| Department dashboards | One per MP-01 department, KPIs from MP-01 §10 | Department heads |
| Project control room | One project: schedule, cost, cash, procurement, documents, quality, HSE, risks | Project Director, Project Manager |
| My tasks and approvals inbox | Everything waiting for the user, with due dates and DOA context | Everyone |
| Notification centre | Alerts (§6) with filters, read state, links | Everyone |
| Tender study workspace | Documents, findings, queries, risks side by side (AG-04) | Tendering Manager |
| Estimating workbench | BOQ, rate build-up, quotes, indirects, summary | Senior Estimator (Civil / Arch / MEP) |
| Schedule workspace | Gantt, network, resources, baselines, look-ahead (MP-05 §1) | Planner / Scheduler |
| IPC / certificate workbench | Measurement, valuation, deductions, previous, documents | Quantity Surveyor (project), Subcontract Administrator |
| Drawing workspace | CAD canvas and drawing register (MP-05 §2) | Technical Office Manager, BIM Modeller / CAD Draftsman (per discipline) |
| Model workspace | BIM viewer, clashes, quantities (MP-05 §3) | BIM Manager, BIM Coordinator |
| Interior studio | Options, styles, 3D, BOQ, client approvals (MP-05 §5) | Interior Designer |
| Organisation and workforce | Org chart editor, positions, approved headcount, gap alarm, commitments | HR Director (CHRO), Organisation Development Specialist |
| Configuration | Entities, numbering, calendars, taxes, DOA editor with conflict check, templates | ERP / MISHEL Administrator |
| Data import | File upload, column mapping, row-level dry run (pattern of CC-065) | Application Developer / Integrator |
| Report designer | User-built reports and schedules (D22.09) | Data / BI Analyst |
| AI assistant panel | In-context assistant on every record and workspace (MP-04) | Everyone |
| Audit trail viewer | History of any record | Head of Internal Audit |
| Portals | Client, consultant, subcontractor, supplier (§8) | External parties |
| Site app | Offline capture (§7) | Site Engineer (Civil / Arch / MEP), Site Timekeeper |

## 5. Dashboards
**Owner portfolio (the screen the owner opens first):**
| Section | Content (each value opens its source records) |
|---|---|
| Portfolio header | Number of projects by phase (tender, mobilisation, execution, hand-over, DLP, closed); total contract value, certified, collected, outstanding |
| Project table | Per project: phase, contract value, % planned vs % actual progress, PV / EV / AC, SPI / CPI, EAC and margin vs tender, certified / collected, overdue receivables, critical delay, top risks, open NCRs, HSE incidents, staffing gap, last update date |
| Company cash and commitments | Cash position, forecast, monthly commitments (payroll, subcontract, supplier, instalments, facilities) |
| Alerts summary | Time-bars due, expiring guarantees / insurances / permits, budget and schedule breaches, workforce gap — by severity |
| Tender pipeline | Opportunities and bids by stage, hit rate |
| Drill-down | Portfolio → project control room → module register → record → source document |
Thresholds for red / amber / green are company settings; the dashboard shows the cut-off date and never a figure
without its source.

**Department dashboards:** one per MP-01 department with the KPIs of MP-01 §10 plus workload (open items, overdue,
approvals waiting).

**Project control room:** schedule (critical path, look-ahead), cost and EAC, cash, procurement status, documents and
submittals, quality, HSE, risks, staffing, alerts — for one project.

## 6. Alerts and notifications
All triggers are deterministic rules on database data (MP-04 rule 2: L4 is reserved for rules, never agents);
thresholds, recipients and escalation steps are company settings. Recipients are MP-01 positions, resolved to the
people holding them.
| ID | Alert | Trigger (rule) | Default recipient | Escalation |
|---|---|---|---|---|
| AL-01 | Approval pending | New approval step for the user (exists today) | Approver | Approver's line manager |
| AL-02 | Approval overdue | Pending beyond the company-set time | Approver | Approver's line manager |
| AL-03 | Contract time-bar approaching | Notice / response date within the company-set window | Contracts Engineer | Contracts Manager |
| AL-04 | Guarantee / bond expiry or release due | Expiry / release date within window | Banking & Guarantees Officer | CFO |
| AL-05 | Insurance expiry or cover gap | Expiry within window or cover < contract requirement | Insurance Officer | CFO |
| AL-06 | Permit / licence / certificate expiry | Expiry within window (permits, corporate licences, calibration, work permits, training certificates, subcontractor / supplier insurances and certificates) | Register owner | Register owner's manager |
| AL-07 | Budget / EAC breach | EAC or cost line beyond company threshold vs budget | Cost Control Manager / Cost Controller | Project Manager |
| AL-08 | Critical delay | Negative float or critical activity late beyond threshold | Planner / Scheduler | Project Manager |
| AL-09 | Material need date at risk | Expected delivery after the need date in the look-ahead | Expeditor | Procurement Manager |
| AL-10 | Stock below minimum | Stock < company minimum per item / store | Stores Manager / Storekeeper / Inventory Controller | Procurement Manager |
| AL-11 | NCR / snag open too long | Open beyond company-set time | QA/QC Manager | Project Manager |
| AL-12 | HSE incident reported / stop-work | Incident record or stop-work order created | HSE Manager | QHSE Director |
| AL-13 | Workforce gap | Gap > 0 for a position with date needed within window | Organisation Development Specialist | HR Director (CHRO) |
| AL-14 | Payment due | Approved payable due within window | Treasury Manager / Cashier | CFO |
| AL-15 | Receivable overdue | Certified amount past due date | Credit Control / Collections Officer | CFO |
| AL-16 | Cash below threshold | Forecast cash below company minimum | Treasury Manager / Cashier | CFO |
| AL-17 | Period-close task overdue | Close checklist item past its date | Finance Manager / Chief Accountant | Financial Controller |
| AL-18 | AI draft awaiting review | Agent draft assigned to a human gate | Human gate of the agent (MP-04) | Gate's manager |
| AL-19 | Import refused rows | Data import with refused rows | Application Developer / Integrator | IT & Digital Director (CIO) |
| AL-20 | Security incident / agent suspended | Security event or AI agent suspended | Cybersecurity Officer | IT & Digital Director (CIO) |
| AL-21 | Variation / notice candidate | Site instruction registered with a possible variation | Change / Variation Manager | Commercial Manager (project) |
| AL-22 | Document superseded in use | Superseded revision referenced by an open activity / order | Document Control Manager / Controller | Technical Office Manager |
| AL-23 | Retention release / DLP end due | DLP end or retention-release milestone within window | Handover & Warranty Manager | Commercial Manager (project) |
| AL-24 | Billing cut-off approaching | Contract billing date within window and IPC not submitted | Quantity Surveyor (project) | Commercial Manager (project) |
| AL-25 | Consultant response overdue | Submittal / RFI / IR without response beyond the contract period | Technical Office Manager | Project Manager |
| AL-26 | Price index published | New index value relevant to a contract escalation formula | Commercial Manager (project) | Commercial Director (CCO) |
Delivery rules: in-app always; e-mail per user / company setting; SMS / messaging apps only through a provider the
company contracts, without confidential content in the message; daily digest option; quiet hours; every alert links
to its record; alerts are records (who was told, when, read, acted).

## 7. Mobile / site app
Offline capture and later sync (D12.09): daily diary, inspection requests, measurements, photos with location and
time, timesheets, HSE observations, snags; QR / barcode scan for materials and equipment; camera for documents;
location only with the user's consent and company policy; conflict resolution recorded (DOC-12-010). Offline
data is stored encrypted on the device; a lost device can be signed out remotely and its unsynced data is reported.

## 8. Portals (external parties)
| Portal | What the party can do |
|---|---|
| Client / employer | See shared progress, submitted IPCs, correspondence; certify / comment where the contract allows; approvals of designs and options (D07) |
| Consultant / engineer | Receive submittals, IRs, RFIs; respond with status codes; meeting minutes |
| Subcontractor | Submit applications, see certificates, payments, back-charges, documents for their package |
| Supplier | Receive RFQs, submit offers, see POs, delivery and payment status |
Portal users have no internal authority (MP-01 §11) and see only their own records; they authenticate with MFA where
company policy requires, and their access expires with the contract or package it was granted for.

## 9. Acceptance and quality of the interface
- Automated browser checks for every workspace in both languages and directions, light and dark themes.
- Accessibility checks (automated + manual) against WCAG 2.2 AA.
- Visual regression on key screens; performance budgets (load and interaction times) set in the MP-07 test plan.
- Usability sessions with real users of each MP-01 department before a module is declared usable.

## 10. Coverage and review record
**Counts (computed by script):** 14 navigation groups covering all 25 MP-02 domains, each exactly once; register +
record screens for all 220 MP-03 document types and access to all 210 MP-02 processes; 20 special workspaces;
26 alert types; 4 portals.

**Automated checks (scratchpad `check_mp06.py` + table check):** every table row has its header's column count;
navigation covers every domain exactly once; alert numbering consecutive; every alert recipient / escalation and every
workspace user is an MP-01 position or a named generic role; document and process counts equal MP-03 / MP-02.

**Review log (OQS-001):**
- R3 truth: code status verified in the repository — `index.html` (`lang="ar" dir="rtl"`), 34 English menu labels in
  `Layout.tsx`, 36 page components, 70-line `global.css` with one breakpoint and no dark theme, Cairo font, 4 shared
  components, no i18n library, three dashboard endpoints (portfolio view = contract value and billed %) with no test
  calling them, notifications produced only by the approval-pending trigger (migration 008) and not shown in the
  frontend, five Playwright checks.
- Automated check: AL-01's escalation cell named an alert instead of a recipient — corrected.
- Hostile pass 1 (product / operations): alerts added for retention release / DLP end, billing cut-off, consultant
  response overdue and published price indices; subcontractor / supplier insurances and certificates added to expiry
  alerts; contextual help and guided onboarding added to the core components.
- Hostile pass 2 (security / privacy): encrypted offline storage with remote sign-out for lost devices; MFA and
  time-limited access for portal users; confidential content kept out of SMS / messaging channels (already stated).
- Residual (stated): performance budgets and usability acceptance criteria are set in the MP-07 test plan; colours,
  thresholds and escalation times are company settings.

**Status:** reviewed (code verification, automated checks, two hostile passes); **approved by the owner (Mishel Thabet Halim), 2026-10-15 — R6, approval register A-001.**
