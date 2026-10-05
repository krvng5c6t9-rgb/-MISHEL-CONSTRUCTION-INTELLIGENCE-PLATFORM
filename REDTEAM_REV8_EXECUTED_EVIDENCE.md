# REV8 Executed Adversarial Evidence

## Scope executed in this environment
- Source/package inventory on REV7.
- Approval/DOA adversarial source review.
- Financial posting precision review.
- Frontend dead-placeholder review.
- Static import, permission, schema/code, tenant, and Phase 2–7 gates.
- Actual build attempt.

## Defects found and remediated
1. **DOA future-rule activation defect**: approval lookup checked `effective_to` but not `effective_from`. Fixed: confirmed rules are not eligible before their effective date.
2. **DOA null-currency wildcard defect**: a transaction with NULL currency could match a currency-specific DOA rule. Fixed: only generic NULL-currency rule or exact transaction currency can match.
3. **Segregation-of-duties gap across approval levels**: initiator self-approval was blocked, but the same non-initiator user could approve multiple levels when roles/configuration allowed it. Fixed in service and reinforced with a partial unique DB index.
4. **Concurrent duplicate pending approval risk**: added unique partial index `(org_id,module,record_id) WHERE status='pending'`.
5. **Manual journal Float64 balancing**: balance validation used JavaScript `Number` arithmetic and tolerance. Fixed: PostgreSQL `NUMERIC` performs the balance calculation; JavaScript no longer sums monetary lines.
6. **Dead placeholder frontend component**: unused `SimplePage.tsx` removed.
7. Added migration `022_approval_integrity_hardening.sql` and executable `redteam-rev8-check.mjs`.

## Executed gates after remediation
- `node scripts/redteam-rev8-check.mjs` — PASS.
- `npm run check:all` — PASS.
- `npm --prefix backend run security:tenant` — PASS.
- Phase 2, 3, 4, 5, 6, 7 security/integrity gates — PASS.
- Schema/code checker: 111 tables; 46 backend SQL files — PASS.

## Build evidence
`npm run build` was executed after remediation and exited with code 2. The emitted failures are dependency/type-resolution failures (`express`, `zod`, `pg`, `@types/node`, etc.). No lockfiles are present in the supplied package and dependency installation/package-lock generation timed out in this environment. Therefore a dependency-resolved compile is **UNVERIFIED**, not PASS and not proven source-code FAIL.

## Runtime boundary
No `psql`, PostgreSQL server binary, or Docker executable is available in this environment. PostgreSQL migrations, RLS attack execution, runtime E2E, concurrency DB tests, backup/restore and browser-driven runtime validation remain **UNVERIFIED**.

## Release decision
REV8 is a hardened engineering candidate only. It is **not** labelled Production Ready because runtime acceptance evidence is incomplete.
