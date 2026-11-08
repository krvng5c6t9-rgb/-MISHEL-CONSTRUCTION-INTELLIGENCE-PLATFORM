# Owner Vision Directive 002 (OVD-002) — recorded 2026-11-08

Source: the owner's own words in the working session of 2026-11-08 (Arabic), recorded so nothing is lost between
sessions. It extends OVD-001; it does not replace it. Nothing here is a claim that anything exists in the code.

## 1. Statement of the owner (summary, faithful)
- MARC is to be the first application for engineering and company management in Egypt, the Middle East and the Gulf:
  larger than Odoo or any other application, fully automatic and dynamic, everything linked to everything.
- It understands every department of engineering and contracting companies, from the most junior position to the
  chairman of the board, and performs the role of every person in the company — an ultimate, full enterprise system
  for engineering in all categories and departments and all management jobs and tasks of a large company.
- Named scope (examples, not a limit): AI agents; tenders; drawing review; Odoo, SAP2000, AutoCAD, Revit, Primavera,
  MS Project, Power BI, MS Excel; all engineering tasks; management; companies and engineers in all fields.
- Owner instruction after the competitor analysis (COMPETITOR_SCAN_002): "اتفضل نفذ الاصح فى كل حاجه ناقصه نفذ" —
  implement the correct solution for everything missing.

## 2. Additions to the master plan that follow from this statement
| # | Addition | Where in the plan |
|---|---|---|
| A1 | Structural analysis and design (the SAP2000 / ETABS role): connector to the client's licensed SAP2000 / ETABS through their APIs, and an evaluation of open-source analysis engines (licence and verification checked first); results are always checked and signed by a licensed engineer | MP-05 (new engine), MP-04 agent for structural checks, release R5 |
| A2 | Integration with Odoo and Power BI used by a client: data exchange with Odoo (import of masters and open balances through the cut-over / import pattern; export of postings), and a governed read-only data feed for Power BI / Excel | MP-05 / MP-07, R1 import and R7 |
| A3 | Gulf market requirements: Saudi ZATCA e-invoicing (phase 2), UAE e-invoicing, VAT per country, labour law and end-of-service rules per country, Hijri dates where required | MP-07 R7 (Saudi first when a customer requires it) |
| A4 | All engineering categories, not only contracting: consultancy and design offices, developers, specialist contractors, facility management, workshops, and the individual engineer, as switchable company profiles on one data model | MP-01 (profiles), MP-02 processes per profile |
| A5 | Parity gaps for the Egyptian market (COMPETITOR_SCAN_002): profitability per project and company, letters of guarantee register, labour attendance and allocation with cost, Egyptian e-invoice / e-receipt | MP-07: placed before the rest of R1 |

## 3. Governance unchanged (OVD-001 §5)
AI acts in every role but is never the sole authority for financial, contractual, engineering or safety decisions; the
accountable person approves. Licensed drawings, prices, DOA values and company policies come from the company; no
evidence → no claim; nothing is announced as working before it passes its gate.
