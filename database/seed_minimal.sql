-- Optional local bootstrap reference data only.
-- SECURITY: this script deliberately creates NO users, passwords, clients, projects, BOQ, or demo transactions.
-- Create the first administrator through POST /api/auth/bootstrap-admin using the explicit
-- x-bootstrap-token configured in BOOTSTRAP_ADMIN_TOKEN.

insert into currencies (id, code, name, exchange_rate_to_base)
values (1, 'EGP', 'Egyptian Pound', 1)
on conflict do nothing;

-- Migration 001 creates the initial organization shell. Replace its legal/company data explicitly
-- before operational use. This seed does not add any authentication credential.
