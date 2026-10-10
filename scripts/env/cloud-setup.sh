#!/usr/bin/env bash
# Cloud session setup (paste into the environment's "Setup script" box). Installs PostgreSQL 16 if missing,
# creates a local test cluster on port 5433 with the gate roles, and starts it. LOCAL TEST CREDENTIALS ONLY -
# never used for any real deployment. Project packages are installed by the session itself (npm ci).
set -e
if [ ! -x /usr/lib/postgresql/16/bin/pg_ctl ]; then
  apt-get update -y && apt-get install -y postgresql-16 postgresql-client-16
fi
W=${W:-/home/user/mishel_work}; P=${P:-5433}; mkdir -p $W/pgrun; chown -R postgres:postgres $W/pgrun
if [ ! -f $W/pgdata/PG_VERSION ]; then
  mkdir -p $W/pgdata && chown postgres:postgres $W/pgdata
  echo pg_pw > /tmp/pgpw && chown postgres /tmp/pgpw
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $W/pgdata -A md5 --pwfile=/tmp/pgpw" >/dev/null; rm -f /tmp/pgpw
fi
rm -f $W/pgdata/postmaster.pid
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $W/pgdata -o '-p $P -k $W/pgrun' -l $W/pgrun/pg.log start" || true
sleep 2
PGPASSWORD=pg_pw psql -h localhost -p $P -U postgres -v ON_ERROR_STOP=0 -qc "
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_owner') THEN CREATE ROLE erp_owner LOGIN BYPASSRLS PASSWORD 'owner_pw'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_app') THEN CREATE ROLE erp_app LOGIN PASSWORD 'app_pw'; END IF;
  END \$\$;" || true
