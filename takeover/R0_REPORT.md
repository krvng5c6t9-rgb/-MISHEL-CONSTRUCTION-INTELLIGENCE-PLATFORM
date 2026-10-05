# R0 Runtime Truth — Report (2026-10-05)

Scope: v0.2 baseline (`MISHEL_COMMERCIAL_PRODUCT_V0_2_ACTUAL_MERGE.zip`, SHA verified) on Node 22.22 / PostgreSQL 16.14. Decisions and changes: `governance/DECISION_LEDGER.md`. Logs: `takeover/evidence/`.

## Verdict
**R0 gate: PASSED for the core commercial-financial chain on a fresh database, after 11 Controlled Changes.** The shipped v0.2 could not build, could not create a database, and, once those were fixed, could not complete a single authenticated request or approval. The documentation's claims of "executed evidence" are not reliable (F-09).

## Works (E1, executed)
- Build: backend and frontend `tsc` are clean; lockfiles are present.
- Migrations 001–037 apply from zero (`C4_…log`, `MIGRATIONS_OK 37`). The migrator refuses a role that RLS would filter, and the API refuses superuser/BYPASSRLS roles in production.
- E2E chain, API only, 74/74 (`R0-4_e2e_chain.log`): Lead → Opportunity → Tender (DOA approval, SoD enforced) → Project → BOQ + rate build-up → MR (approved) → RFQ → Quotation → Comparative statement → PO (DB-computed total, wrong-role rejection, committed cost) → Issue → GRN → Confirm (idempotent) → Invoice → 3-way match → Approval (actual cost + AP) → Cost→GL (double post rejected; commitment not posted) → Contract → IPC → Approval → Client approval → AR/GL → Payment → Approval → GL. The GL balances (debit 135,000 = credit 135,000).
- Tenant isolation, 32/32 (`R0-5_tenant_isolation.log`): reads by id, lists, cross-tenant writes, approval actions, DOA/role edits, login across orgs, and DB-level probes are all blocked.
- Existing repo checks: 26/26 pass (`R0-6_existing_check_scripts.log`).

## Does not work / not verified
- Execution BOQ (`project_boq`) has no creation path. BOQ-linked PO lines, IPC lines, progress and variations cannot be exercised (F-01).
- No vendor create API (F-02), no DOA create API (F-04), and no tenant provisioning (F-03). A new tenant cannot operate.
- Not run: the full `docker compose` stack (no daemon), PG 17, the frontend in a browser, and the modules outside the chain (HR, assets, HSE, QA/QC, EDMS, planning, site, portals, AI/automation/knowledge). Load, performance, backup/restore and security pentest were also not run.

## Top 10 blockers (to commercial pilot)
1. F-01: estimating→execution BOQ handover is missing, and so is the `project_boq` API.
2. F-03: tenant provisioning (roles, DOA, CoA, GL rules, cost codes, fiscal calendar) for SaaS.
3. F-04: there is no owner-approved DOA matrix or DOA management API; approver roles lack permissions.
4. F-05: revenue and retention GL treatment for IPCs needs an accounting decision by the owner.
5. F-02: vendor/subcontractor master data has no API.
6. F-08: the bootstrap-token tenant creation model is unsafe for multi-tenant SaaS.
7. F-06/F-07: missing `authorize` on `/projects`; DB errors return 500.
8. Runtime coverage of ~25 other modules is zero. They need the same E2E treatment (expect similar defect density).
9. Deployment: compose with role separation is UNVERIFIED at runtime, and there is no PG 17 run, CI pipeline, backup or monitoring.
10. F-09: test discipline. The repo's checks are grep-based, so the runtime E2E and isolation suites must become the CI gate.

Next (per §23/§29): close F-06/F-07 (small), then the BOQ handover and tenant provisioning design. In parallel, start the M01–M11 / D01–D20 coverage map against the code. R0 is not the product scope.
