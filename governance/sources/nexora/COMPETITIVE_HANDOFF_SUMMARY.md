# NEXORA ONE — Competitive handoff

41 competitor records; 20 market gaps; 103 additive tables; 110 proposed entity-level capability contracts. Original baseline: 67 tables, 538 columns, 634 roles. No baseline modifications.

## Gap-to-addition register

### G01 — 5D transactional BOQ/WBS/FIDIC twin (P0)

Source requirement: BOQ item, rate version, WBS activity, dependency, element allocation, notice and valuation line

Additions / shared entities: nx_market.boq_item, nx_market.rate_version, nx_market.wbs_activity, nx_market.activity_dependency, nx_market.element_allocation, nx_market.contract_notice, nx_market.valuation_line

Acceptance: domain workflow and negative fixtures still required.

### G02 — Field workflows and CDE (P0)

Source requirement: RFI, submittal, transmittal, checklist template/version, inspection result, punch item and due-date escalation

Additions / shared entities: nx_market.rfi, nx_market.submittal, nx_market.transmittal, nx_market.checklist_template, nx_market.inspection_result, nx_market.punch_item, nx_market.field_escalation

Acceptance: domain workflow and negative fixtures still required.

### G03 — Financial and commercial transaction core (P0)

Source requirement: Journal header/line, account, commitment, invoice, payment certificate line and currency rate

Additions / shared entities: nx_market.account, nx_market.fiscal_period, nx_market.journal_header, nx_market.journal_line, nx_market.cost_commitment, nx_market.invoice, nx_market.payment_certificate_line, nx_market.fx_rate

Acceptance: domain workflow and negative fixtures still required.

### G04 — Conflict-safe offline and portable model operations (P0)

Source requirement: Operation causal context, conflict record, tombstone, attachment chunk, merge policy and checkpoint; no proven CRDT semantics

Additions / shared entities: nx_market.merge_policy, nx_market.crdt_operation, nx_market.sync_conflict, nx_market.tombstone, nx_market.attachment_chunk, nx_market.sync_checkpoint

Acceptance: domain workflow and negative fixtures still required.

### G05 — Developer unit inventory and reservation (P0)

Source requirement: Property, building, unit, saleable area, price book, inventory status and atomic reservation/expiry

Additions / shared entities: nx_market.property, nx_market.building, nx_market.unit, nx_market.price_book, nx_market.reservation

Acceptance: domain workflow and negative fixtures still required.

### G06 — Real estate CRM and lead attribution (P1)

Source requirement: Lead, contact, consent, source, assignment, activity, viewing, funnel and deduplication

Additions / shared entities: nx_market.contact, nx_market.lead_source, nx_market.lead, nx_market.consent, nx_market.lead_assignment, nx_market.lead_activity, nx_market.viewing, nx_market.funnel_stage

Acceptance: domain workflow and negative fixtures still required.

### G07 — Broker commission engine (P1)

Source requirement: Broker agreement, commission rule, split, eligibility event, accrual, clawback and payout

Additions / shared entities: nx_market.broker_agreement, nx_market.commission_rule, nx_market.commission_split, nx_market.eligibility_event, nx_market.commission_accrual, nx_market.commission_clawback, nx_market.commission_payout

Acceptance: domain workflow and negative fixtures still required.

### G08 — Sales installments and lease accounting (P0)

Source requirement: Sale contract, installment schedule, lease, rent escalation, deposit, receipt allocation and arrears

Additions / shared entities: nx_market.sale_contract, nx_market.installment, nx_market.lease, nx_market.rent_escalation, nx_market.deposit, nx_market.receipt_allocation, nx_market.arrears

Acceptance: domain workflow and negative fixtures still required.

### G09 — Handover, resident service and facilities (P1)

Source requirement: Unit handover, occupant, asset register, warranty, service request, work order and SLA

Additions / shared entities: nx_market.unit_handover, nx_market.occupant, nx_market.asset_register, nx_market.warranty, nx_market.service_request, nx_market.service_sla, nx_market.work_order

Acceptance: domain workflow and negative fixtures still required.

### G10 — Portal syndication and market intelligence (P1)

Source requirement: Listing, portal entitlement, feed run, permit, credit ledger, comparable record and valuation evidence

Additions / shared entities: nx_market.listing, nx_market.portal_entitlement, nx_market.feed_run, nx_market.listing_permit, nx_market.portal_credit_ledger, nx_market.comparable_record, nx_market.valuation_evidence

Acceptance: domain workflow and negative fixtures still required.

### G11 — Double-entry ledger (P0)

Source requirement: journal_header,journal_line,account,period

Additions / shared entities: nx_market.account, nx_market.fiscal_period, nx_market.journal_header, nx_market.journal_line

Acceptance: Balanced postings; closed periods reject writes

### G12 — Group consolidation (P0)

Source requirement: intercompany_match,elimination,fx_rate,consolidation_run

Additions / shared entities: nx_market.intercompany_match, nx_market.consolidation_run, nx_market.elimination, nx_market.fx_rate

Acceptance: Eliminations net to zero; reproducible FX

### G13 — AP/AR and procurement matching (P0)

Source requirement: invoice,invoice_line,receipt,match_exception

Additions / shared entities: nx_market.invoice_line, nx_market.receipt, nx_market.match_exception, nx_market.invoice

Acceptance: Partial receipt and duplicate invoice fixtures

### G14 — Treasury and bank reconciliation (P0)

Source requirement: bank_account,bank_statement_line,payment_proposal,reconciliation_match

Additions / shared entities: nx_market.bank_account, nx_market.bank_statement_line, nx_market.payment_proposal, nx_market.reconciliation_match

Acceptance: Duplicate settlements rejected; no bypass of DOA

### G15 — Tax lifecycle extension (P0)

Source requirement: tax_document_line,tax_return,withholding_event,transfer_pricing_adjustment

Additions / shared entities: nx_market.tax_document_line, nx_market.tax_return, nx_market.withholding_event, nx_market.transfer_pricing_adjustment

Acceptance: Reproduce approved jurisdiction-specific fixtures

### G16 — Payroll calculation and statutory localization (P0)

Source requirement: worker,employment,pay_component,pay_run,pay_result

Additions / shared entities: nx_market.worker, nx_market.employment, nx_market.pay_component, nx_market.pay_run, nx_market.pay_result

Acceptance: Golden payroll cases by country; PII access tests

### G17 — Time and labor allocation (P1)

Source requirement: time_entry,shift,crew_assignment,labor_allocation

Additions / shared entities: nx_market.shift, nx_market.crew_assignment, nx_market.time_entry, nx_market.labor_allocation

Acceptance: No duplicated hours after reconnect

### G18 — Fixed assets and plant costing (P1)

Source requirement: fixed_asset,depreciation_run,maintenance_order,asset_charge

Additions / shared entities: nx_market.fixed_asset, nx_market.depreciation_run, nx_market.maintenance_order, nx_market.asset_charge

Acceptance: Asset roll-forward reconciles to GL

### G19 — Project revenue and WIP (P1)

Source requirement: performance_obligation,wip_snapshot,revenue_event,cost_commitment

Additions / shared entities: nx_market.performance_obligation, nx_market.wip_snapshot, nx_market.revenue_event, nx_market.cost_commitment

Acceptance: Contract-to-ledger reconciliation

### G20 — Integration governance and data portability (P1)

Source requirement: connector_contract,webhook_receipt,dead_letter,export_manifest

Additions / shared entities: nx_market.connector_contract, nx_market.webhook_receipt, nx_market.dead_letter, nx_market.export_manifest

Acceptance: Idempotent replay and complete export/import

## Validation

- Generated PostgreSQL statement-template checks: 0 errors (identifier/type whitelist, balanced parentheses, table count, references). No independent PostgreSQL parser or server was available; not a complete syntax certification.

- SQLite structural projection: 0 errors; foreign keys enabled, integrity check OK. PostgreSQL RLS and native type behavior are not tested by SQLite.

- RLS uses session scope placeholders; trusted middleware and grants must be designed and verified.

- DDL is a proposed transactional data model, not executable business engines: balanced posting, closed-period enforcement, approval/DOA, tax computation, CRDT convergence, reservation expiry and other lifecycle rules require implementation and fixtures.

- Shared G03/G11 ledger, G03/G12 FX, G03/G13 invoice and G03/G19 commitment entities avoid duplicate tables.

- Role IDs are candidates, not permissions. Cross-node transfers and consolidated reporting require explicit authorized workflows.

- Vendor review evidence and pricing gaps from Parts 1–2 remain open. No new competitor research or measured 10x claim.

- Turn 4 and R25_SUMMARY.md were not present in the preserved package.

## Next gate

Independent PostgreSQL 18 migration test against the complete baseline; implement business invariants, security authorization, API contracts and acceptance fixtures before production.