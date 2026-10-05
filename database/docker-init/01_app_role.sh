#!/bin/sh
# CC-010: create the non-superuser application role used by the backend.
# Runs once, on first initialisation of the postgres volume (docker-entrypoint-initdb.d).
# The migrator connects as POSTGRES_USER (superuser) and grants erp_app its privileges
# (APP_DB_ROLE); the backend connects as erp_app so FORCE ROW LEVEL SECURITY applies.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pw="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE erp_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') \gexec
SQL
