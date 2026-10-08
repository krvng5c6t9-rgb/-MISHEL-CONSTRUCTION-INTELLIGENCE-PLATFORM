-- CC-037 (G-013): session revocation. Before: an issued JWT stayed valid for its full 8 h after logout, password
-- change or role change, and a token issued before a deactivation became valid again when the user was reactivated;
-- there was no logout, no password change and no signing-key rotation path.
-- token_version is a per-user session epoch carried in every token; the database bumps it on any security-relevant
-- change so every route that changes these columns revokes sessions without having to remember to.
-- (transaction managed by migrator)
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION bump_user_token_version() RETURNS trigger AS $$
BEGIN
  IF NEW.token_version IS NOT DISTINCT FROM OLD.token_version
     AND (NEW.password_hash, NEW.is_active, NEW.role_id, NEW.org_id, lower(NEW.email)) IS DISTINCT FROM (OLD.password_hash, OLD.is_active, OLD.role_id, OLD.org_id, lower(OLD.email)) THEN
    NEW.token_version := OLD.token_version + 1;
  END IF;
  IF NEW.token_version < OLD.token_version THEN RAISE EXCEPTION 'token_version can only increase'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_token_version ON users;
CREATE TRIGGER trg_users_token_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION bump_user_token_version();

CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti UUID PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('logout','admin_revoke')),
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expiry ON revoked_sessions(expires_at);
CREATE OR REPLACE FUNCTION guard_revoked_sessions() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'revoked_sessions is append-only'; END IF;
  IF TG_OP = 'DELETE' AND OLD.expires_at > now() THEN RAISE EXCEPTION 'A revocation can only be purged after the token has expired'; END IF;
  RETURN COALESCE(OLD, NEW);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_revoked_sessions_guard ON revoked_sessions;
CREATE TRIGGER trg_revoked_sessions_guard BEFORE UPDATE OR DELETE ON revoked_sessions FOR EACH ROW EXECUTE FUNCTION guard_revoked_sessions();
ALTER TABLE revoked_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON revoked_sessions;
DROP POLICY IF EXISTS tenant_isolation_write ON revoked_sessions;
CREATE POLICY tenant_isolation_select ON revoked_sessions FOR SELECT USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
CREATE POLICY tenant_isolation_write ON revoked_sessions FOR ALL USING (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint) WITH CHECK (org_id=NULLIF(current_setting('app.org_id',true),'')::bigint);
