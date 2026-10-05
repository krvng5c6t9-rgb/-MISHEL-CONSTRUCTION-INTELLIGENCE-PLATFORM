# R14: Market and competitor evidence (first pass, 2026-10-05)

**Rules applied:**
- Only vendor documentation, vendor press releases and independent country tax guides found by web search are used as evidence (grade E4, public claims).
- No pricing, market-size or capability claim is made beyond what the cited source states. This pass makes no claim that MISHEL is better than any competitor; the product has to *prove* that with executed Golden Case tests.

## 1. What competitors demonstrably offer (cited)
| Vendor / product | Evidenced capability relevant to MISHEL | Source |
|---|---|---|
| Procore (Prime Contracts, Change Events) | Prime contract with schedule of values; change events from RFIs with cost-code line items; RFQs to subs; prime potential change orders and approval workflow; immutable change history. **No notice/time-bar feature was found in the searched documentation.** | [Change Events](https://support.procore.com/products/online/user-guide/project-level/change-events), [Prime Contracts](https://support.procore.com/products/online/user-guide/project-level/prime-contracts), [Change history](https://support.procore.com/products/online/user-guide/project-level/prime-contracts/tutorials/view-the-change-history-of-a-prime-contract) |
| Procore Helix (AI) | Conversational assist; Agent Builder (open beta); agents for RFI analysis, submittal cross-checking and compliance auditing; Developer Studio with MCP planned for 2026 | [Business Wire, Groundbreak 2025](https://www.businesswire.com/news/home/20251015796723/en/Procore-Advances-the-Future-of-Construction-with-New-AI-Innovations-at-Groundbreak-2025), [Q1 2026 transcript](https://s21.q4cdn.com/306803720/files/doc_financials/2026/q1/29510794_1995380849_3711053_Transcript_EditedCopy_20260505202150.pdf) |
| Oracle Primavera Unifier | Contract management forms and workflows for NEC4 early warnings and compensation events, payment applications, response times and contract changes | [NEC4 tour](https://www.oracle.com/uk/construction-engineering/primavera-unifier-project-controls-asset-management/nec4-contract-management-tour/), [data sheet](https://www.oracle.com/a/ocom/docs/industries/construction-engineering/ce-contract-management-primavera-unifier-ds.pdf) |
| Thinkproject CEMAR | NEC contract administration; Early Warning and Compensation Event registers; named in NEC4 contracts | [Thinkproject news](https://group.thinkproject.com/en/news-events/nec-e-learning-integrated-into-thinkprojects-cemar-software/) |
| SAP S/4HANA (EC&O) | Milestone, percent-complete and unit billing; event-based revenue recognition (IFRS / US-GAAP); partner add-ons for contractor/subcontractor measurement books and progress billing | [SAP Learning, billing](https://learning.sap.com/courses/project-financials-control-in-sap-s-4hana/describing-billing-methods-and-controls), [EBRR](https://learning.sap.com/live-sessions/event-based-revenue-recognition-for-project-based-services-professional-services), [Syntax partner](https://www.sap.com/romania/products/financial-management/partners/syntax-systems-usa-lp-progress-billing.html) |
| Odoo (core) | Per a partner vendor: core Odoo has no WBS, BOQ, retention or committed cost; partners sell custom construction modules | [ECOSIRE](https://ecosire.com/apps/odoo/construction-builder) (partner claim) |
| RIB 4.0 / iTWO | Integrated 5D estimating, bidding, scheduling, procurement and BI; integrates with take-off systems | [TrustRadius](https://www.trustradius.com/products/itwo/details), [Capterra](https://www.capterra.co.uk/software/1052499/itwo-4-0) (review-site descriptions) |
| Trimble Viewpoint Vista | Construction ERP: job cost, AR/GL, payroll, equipment; retainage hold/release; AIA billing forms; vendor compliance warnings | [ERP Research](https://erpresearch.com/en-gb/trimble-viewpoint-vista), [Software Connect](https://softwareconnect.com/construction/vista-by-viewpoint/) |

## 2. Egypt-first market facts (cited)
- **E-invoicing:** Egypt runs a mandatory **clearance** e-invoicing regime for B2B and B2G through the ETA portal/API. Invoices must be signed XML/JSON and receive a UUID before issue. B2C e-receipts were expanded in 2025 ([Avalara](https://www.avalara.com/vatlive/en/country-guides/africa-and-middle-east/egypt-vat/egyptian-e-invoicing.html), [VATit](https://vatit.com/e-invoicing-guide/egypt/), [Fonoa](https://www.fonoa.com/resources/country-tax-guides/egypt/e-invoicing-and-digital-reporting)). This is registered as **NDC-028** (EXTENDS_FROZEN_SCOPE: the STEP09 fiscal engine plus the F46 jurisdiction pack).
- **Local alternatives:** regional integrators sell localised Odoo, ERPNext and Oracle construction implementations ([Sendan](https://www.sendantech.com/en/jeddah/odoo/construction-contracting/erp-implementation)). Buyers expect a full Arabic interface and tax compliance ([Mozon](https://mozon-tech.com/en/blog/erp-system-in-egypt/)).

## 3. Expert-commission challenge to our own plan (honest)
1. **NEC EW/CE registers are not unique.** Unifier and CEMAR already provide them (§1). NDC-002 is table-stakes for NEC markets, not a differentiator.
2. **Evidence-backed differentiation hypotheses.** None is proven; each must be tested in a pilot.
   - (a) **One application** joining estimating → execution BOQ → procurement → IPC → GL → cash with enforced truth invariants (R0 chain, STEP09). Procore is not an accounting ERP; Vista and SAP need partner add-ons or are US-form-centric (AIA).
   - (b) **FIDIC-form rights preservation** (Contract Data Pack plus time-bar engine) native to the contractor ERP. Our searched Procore documentation shows change events but no time-bar calendar. This is a gap observation from searched pages, not proof of absence.
   - (c) **Egypt/MENA localisation:** Arabic, ETA e-invoice and FIDIC as the regional default.
   - (d) **Governed AI over authoritative records:** facts vs calculations vs inference, with AI never the sole authority. Procore Helix is moving fast here, so speed matters and claims must be modest.
3. **Risk of over-scoping.** 38 Golden Cases and 276 aggregates cannot ship at once. The commercial core waves (R13) must reach a pilot before the platform journeys.
4. **Gaps that block a sale regardless of features:**
   - no tenant provisioning (G-003);
   - no vendor master API (G-002);
   - no ETA e-invoicing (NDC-028);
   - no backup/restore (GC-34);
   - no Arabic/RTL verification of the frontend (not yet tested).

## 4. Not done in this pass (next)
- Pricing and licensing: an owner decision. Competitor pricing was not collected because invented numbers are forbidden.
- Odoo construction partner apps in Egypt and ERPNext feature depth have not been reviewed in detail.
- Local Egyptian construction ERP vendors are not identified individually. A structured interview or survey with pilot customers is preferred over web claims.
