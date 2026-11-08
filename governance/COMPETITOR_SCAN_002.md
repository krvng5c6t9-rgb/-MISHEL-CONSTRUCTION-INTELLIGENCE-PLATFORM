# Competitor scan 002 — 2026-11-08

Sources sent by the owner on 2026-11-08: four Facebook advertisements (screenshots) and four archives about
hajjaj.pro (`hajjaj-public-archive.zip`: the 48 pages listed in the site's sitemap with headers and SHA-256;
`hajjaj-erp-public-code.zip`: 36 JavaScript modules split from the site's public browser bundles;
`hajjaj-public-code-review.zip`: an inspection of those bundles; `mhj_accounting_reports-19.0.zip`: an Odoo
accounting add-on pack). The archives were extracted in an isolated scratch folder and read as text only; nothing
in them was executed, and nothing from them is copied into MARC (MARC is Node / PostgreSQL, not Odoo).

Evidence grades: **E2** = read in the material itself (a statement of fact about the material); **E4** = the vendor's
own marketing claim, not verified. A marketing article explaining a topic is not evidence that the product does it.

## 1. Hajjaj.Pro (hajjaj.pro) — direct competitor (Egypt; claims customers in Egypt and Saudi Arabia)
**Facts from the material (E2):**
- The product is built on Odoo: page 004 ("نظام ادارة شركات المقاولات") states "نظام ERP مخصص لشركات المقاولات
  بالاعتماد على نظام Odoo العالمي" and "مبني على منصة Odoo العالمية مفتوحة المصدر".
- The 36 browser modules are standard Odoo modules (account, payment, sale, sale_management, purchase, project
  portal) plus `xpay_payment` (payment form) and `mhj_meta_capi` (Meta tracking); the included inspection found no
  contractor-specific module in the public bundles (this does not prove such code is absent on the server).
- `mhj_accounting_reports-19.0` is eight Odoo 19 community accounting modules (financial reports, accounting,
  assets, budget, day / cash / bank books, follow-up, fiscal year and lock date, recurring payments) whose manifests
  name the authors "Odoo Mates, Odoo SA" (and Walnut Software Solutions for one) under **LGPL-3** — i.e. the free
  community replacement for Odoo Enterprise accounting.
- About 30 of the 48 pages are marketing articles (tender pricing, letters of guarantee, equipment cost, AI in
  business, ERP selection, factories). The company also sells factory systems, a private cloud and consulting.

**Claims on the product pages (E4):** unlimited projects, phases and progress %, tasks; client and subcontract
contracts, payments / IPCs, variation orders, due / expiry alerts; purchase requests and electronic approvals,
supplier quotation comparison, purchase orders, delivery to site; central and site stores, transfers, live stock,
periodic counts; equipment, preventive maintenance, operating hours, equipment cost per project; employees and
labour, attendance, allocation to projects, productivity; automatic journal entries, customers / suppliers, banks and
cash, cost centre per project, financial statements; client and subcontract IPCs; Egyptian e-invoice and e-receipt
(ETA), VAT; Arabic / English; user permissions; cloud; "implementation in days"; customisable. Main sales message:
"is the project making or losing money" (ربحية المشروع).

**Not claimed anywhere in the material:** contractual notices / time-bars, claims and EOT, FIDIC dispute ladder,
revenue recognition, CPM / Primavera-class scheduling, BIM / CAD, drawing review by AI, AI agents acting in roles
(the AI pages are generic articles), printed documents with verification.

## 2. Advertisements (screenshots, E4)
| Advertiser | What it is | Lesson for MARC |
|---|---|---|
| Hajjaj.Pro | Ad: "a contracting company means linking the technical office with sites, materials, IPCs and stores"; "do you know how much your projects earn?" | Profitability per project is the message that sells in Egypt |
| Essential Construction | Library of templates (schedules, quality forms, drawings, safety signs, operations, estimating), subscription with a 14-day free trial; 12.7K reactions | Strong demand for ready forms; MARC's 220 documents (MP-03) live inside workflows (filled from data, approved, printed with QR) |
| Refraxion | Free tool that reviews an AWS account "like a solutions architect", ranks findings by severity, gives the fix, connects to Claude | The output shape for MARC review agents (contract, drawings, tender): findings ranked by severity with references and proposed fix, approved by the accountable engineer; optional MCP access to company data with the user's permissions |
| Meska AI | Training cohort for building internal tools with Claude Code | Small tools become cheap for everyone; MARC's defensible value is integrated data, tested contractual / financial rules, isolation, governance and local compliance |

## 3. Position of MARC (E1 = gate-tested; see CURRENT_STATE.md)
| Area | Hajjaj (E4 unless noted) | MARC |
|---|---|---|
| Generic ERP breadth (website, sales, portal payments, many apps) | Stronger (Odoo, E2) | Narrower |
| Profitability per project / company in one view | Main claim | **Gap** — data exists (revenue runs, actual cost, EAC); no single view (F-66) |
| Egyptian e-invoice / e-receipt submission | Claimed | **Gap** — tax engine E1; submission needs OI-2 credentials |
| Letters of guarantee / bonds register | Article only | **Gap** — no register (also blocks alerts listed in migration 091) |
| Labour attendance and allocation to projects with cost | Claimed | Partial (HR / payroll E1; no daily attendance per project) |
| Notices, time-bars, claims / EOT, FIDIC / DAAB, compensation events | Not claimed | **E1** |
| Retention, advances, back-charges, tax, DOA and segregation of duties on IPCs | Generic | **E1**, deep |
| Revenue recognition, CPM, design-revision impact, commissioning, risks | Not claimed | **E1** |
| Printed documents with amount in words, QR and fingerprint verification | Not claimed | **E1** |
| Multi-company isolation, MFA, 1,954 runtime checks | Not visible | **E1** |
| AI agents in roles, Primavera-class scheduling, CAD / BIM, AI drawing review | Not present | **Not built yet** (MP-04 / MP-05) |

## 4. Conclusions
1. MARC does not win by copying Odoo's breadth; it wins on construction depth, AI agents in roles and engineering
   engines (OVD-001 / OVD-002).
2. Four parity gaps for the Egyptian market are moved ahead of the rest of R1 (MP-07 amendment of 2026-11-08):
   profitability view, letters of guarantee register, labour attendance and allocation, Egyptian e-invoice.
3. Nothing from the archives is reused; LGPL-3 Odoo code is irrelevant to MARC's stack.
