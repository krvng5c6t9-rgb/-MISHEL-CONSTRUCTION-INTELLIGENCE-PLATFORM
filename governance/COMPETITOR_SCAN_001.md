# Competitor scan 001 — 2026-10-15

Source: saved web pages sent by the owner (saveweb2zip archives, one page each). Every competitor statement below is
**the vendor's own marketing claim (E4)**, not verified. MISHEL statements carry their own evidence grade.

## What each page claims
| Vendor | Market | Claimed scope | AI | Notes |
|---|---|---|---|---|
| CMiC (cmicglobal.ae) | Mid-size / enterprise GCs and specialty contractors | Financials + project management on one system; bidding and procurement; schedules; labour hours against jobs; office–field communication | Page headline "First AI-Powered Construction ERP" (no detail on the page) | Landing page only; lead form |
| Buildo (buildo.solutions/locations/egypt) | Egypt and Saudi contractors; owner / developer / consultant / contractor / supplier | One cycle BOQ → contract → execution → IPC → cost; owner and subcontract IPCs with previous / current / cumulative, deductions, retention, review and approval; cost overrun early warning; subcontract advances and retention; permissions; integrations; "15 modules, 10 business models, 32 sectors"; gradual rollout without stopping work; ROI calculator | None claimed | Closest positioning to MISHEL's commercial core |
| Madara (madarasystems.com, Itsaq, KSA) | KSA contracting, maintenance and operations (part of a multi-sector ERP) | Financials with ZATCA e-invoicing; projects with phases and progress linked to cost; client / subcontract contracts and internal approval; payment schedule by progress; document archive; workflow designer and custom forms; approvals; tasks, chat, notifications, e-mail; reports, scheduled reports, role dashboards; Excel / PDF export; API; Salesforce CRM | None claimed | Strong on workflow / forms / collaboration tooling |
| Pioneers ERP (pioneers-solutions.com, blog) | Egypt and Saudi contractors (one of many products) | Projects, accounting, inventory / procurement, HR / payroll, attendance, subcontractor list, tenders, contracts, work / supply orders, project income / expenses, drawings archive, fixed assets, dashboards | None claimed | Blog article; case-study percentages are unsourced marketing |
| Hajjaj (hajjaj.pro) | — | — | — | Archive contains only "404 Not Found" — page needs resending |
| BySmart (bysmart-soft.com) | — | — | — | Not received; site blocked from the build environment |

## Position of MISHEL against these claims
- **Already at runtime (E1, gate suites):** client IPC with cumulative / previous / current, retention, advance
  recovery and certification SoD; subcontract certificates, advances, retention, back-charges; GL posting rules with
  balanced batches; tax codes and withholding; revenue recognition runs; go-live cut-over with reconciliation; DOA
  configuration and approvals; RLS multi-tenancy; MFA; procurement, inventory valuation, HR / payroll, EDMS, QA/HSE
  suites (see CURRENT_STATE.md).
- **Gaps visible against competitors:** configurable workflow / form designer (Madara); in-app chat, notifications and
  e-mail (Madara); scheduled and user-built reports (Madara); role-based configurable dashboards and owner portfolio
  view (all); Excel import for every master list (all — cut-over only today); live e-invoice submission (OI-2
  credentials); scheduling engine (Pioneers, CMiC claim scheduling); mobile / field app; ROI calculator and
  marketing material (Buildo).
- **Where MISHEL can lead (none of the Egyptian / Saudi pages claim it):** AI agents per role (tender study, contract
  review, design review, technical office), Primavera-like scheduling linked to cost and IPCs, BIM / IFC and Revit /
  AutoCAD agents, interior design flow, workforce-gap alarm — all **not built yet** (OVD-001).
