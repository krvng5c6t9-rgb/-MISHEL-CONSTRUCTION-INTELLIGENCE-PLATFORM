# PRE-RUN EXECUTED EVIDENCE

Source package: `construction_erp_HOSTILE_REVIEW_REMEDIATED_REV20.zip`

Executed before packaging this candidate:
- Static import check: PASS
- Permission consistency check: PASS
- Schema/code column check: PASS (`112` tables, `47` backend SQL-bearing source files)
- Tenant isolation static gate: PASS
- Phase 2 commercial gate: PASS
- Phase 3 financial-integrity gate: PASS
- Phase 4 execution-integrity gate: PASS
- Phase 5 integrity gate: PASS
- Phase 6 portal/reporting gate: PASS
- Phase 7 hardening gate: PASS
- REV20 adversarial gate: PASS (`14/14`)
- New pre-run gate: PASS
- Migration sequence: `001→031`, continuous and unique

Additional pre-run remediations in this candidate:
- Full local Docker stack added: PostgreSQL + migrator + backend + frontend.
- Checksum-tracked `schema_migrations` runner added; changed applied migrations fail closed.
- Unsafe automatic baseline on an existing untracked ERP schema is refused.
- One-command local launcher added: `./scripts/run-local.sh`.
- Local secrets generated outside source control on first run.
- Historical demo compatibility seed neutralized.
- Direct npm dependency versions pinned exactly (transitive dependency resolution still requires registry access until lockfiles are generated during a network-enabled runtime build).
- Permission consistency gate now validates the actual bootstrap permission grant path rather than depending on historical demo seed data.

Verification boundary:
- The current environment did not provide Docker/PostgreSQL runtime and could not reach npm reliably enough to complete dependency installation/lockfile generation.
- Therefore PostgreSQL migration execution, application build with installed dependencies, browser runtime, E2E, concurrency, performance, and backup/restore remain runtime acceptance work and are not marked PASS here.
