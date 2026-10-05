# R0 Runtime Evidence — v0.2 (2026-10-05)

Source: `MISHEL_COMMERCIAL_PRODUCT_V0_2_ACTUAL_MERGE.zip` from Drive, SHA-256 `f8b1df3f…53f4` (matches SHA256_MANIFEST).
Environment: Node v22.22.0, npm 10.9.4, PostgreSQL 16.14 (compose specifies 17 — deviation).

| File | Step | Result |
|---|---|---|
| C1_backend_install_build.log | R0-1/R0-3 backend | No lockfile (npm install only); `tsc` FAIL, 25 errors |
| C1_frontend_install_build.log | R0-1/R0-3 frontend | No lockfile; `tsc -b` FAIL, 1 error |
| C2_migrate_from_zero.log | R0-2 shipped migrations | FAIL at 011 (ENABLE RLS on view `v_tender_win_loss`) |
| C2b_diagnostic_after_011_patch.log | Diagnostic only (patched copy, NOT a fix) | Further failures: 017 (view), 019 (aggregate in UPDATE), 020 (`clients.legal_name`), 028 (`audit_log.actor_user_id`), 032 (forced RLS hides rows from migrator) |
| C2c_diagnostic_bypassrls_full_chain.log | Diagnostic with BYPASSRLS | 020 DOA placeholder delete violates FK — under shipped design this delete is a silent no-op |
| zips_sha256.txt | Source integrity | 9 downloaded archives, all match Drive SHA256_MANIFEST |

Status: R0 incomplete — R0-4 (E2E) and R0-5 (negative tests) blocked by R0-2/R0-3. No fixes applied to the baseline.
