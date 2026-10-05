# REV12 Executed Evidence

Scope of this remediation round:

1. Bootstrap administrator permission drift: the bootstrap role omitted modules that are actually enforced by `authorize()` (`crm`, `tendering`, `contracts`, `notifications`). This could produce a first-run admin that is unable to access operational modules. The registry is now aligned and a regression gate compares every `authorize()` module against bootstrap coverage.
2. Subcontract certificate segregation of duties: the previous workflow allowed the certificate maker to site-verify it, and allowed the same user to perform site verification and QS certification. New certificates now preserve maker identity; site verification requires a different user with `site:approve`; QS certification requires another distinct user. PostgreSQL trigger protection duplicates the application guard and fails closed when identity is missing.

This evidence is static/source-level only until PostgreSQL runtime is available. Runtime claims are not implied by this document.
