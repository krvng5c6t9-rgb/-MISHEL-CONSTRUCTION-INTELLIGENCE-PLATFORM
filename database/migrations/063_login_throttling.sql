-- G-017 (Stage 11): login throttling and temporary account lockout.
-- (transaction managed by migrator)
-- Before: /auth/login accepted unlimited failed attempts per account and per source address (E3 code read, Stage 8);
-- an unknown email also answered faster than a wrong password (no bcrypt work) - an account-enumeration timing signal.
--  * Throttle state is keyed by (organization id as typed, lower(email)) whether or not the account exists, so the
--    lockout response never reveals which emails are real.
--  * Per-source-address failure limit is optional (0 = off) because it needs a correctly configured proxy hop count.
--  * The tables are reachable only through SECURITY DEFINER functions owned by the migrator role; the API role
--    cannot read or reset throttle state directly. Login events are append-only and visible to the tenant's admins.
--  * Thresholds (failures, window, lockout duration, address limit) are passed in from configuration: the values in
--    env.ts are PROVISIONAL engineering defaults pending the owner's security policy (DEC-015), not a policy.
-- Rollback: DROP FUNCTION login_gate, login_record, login_unlock; DROP TABLE login_events, login_account_throttle,
--           login_address_throttle.

CREATE TABLE IF NOT EXISTS login_account_throttle (
  org_id BIGINT NOT NULL,
  email_key TEXT NOT NULL,
  failures INT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  PRIMARY KEY (org_id, email_key)
);
CREATE TABLE IF NOT EXISTS login_address_throttle (
  address TEXT PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_events (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  email_key TEXT NOT NULL,
  address TEXT,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success','failure','locked_out','blocked_locked','blocked_address','unlocked')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_events_org ON login_events(org_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION guard_login_events() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Login events are append-only'; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_login_events_append_only ON login_events;
CREATE TRIGGER trg_login_events_append_only BEFORE UPDATE OR DELETE ON login_events FOR EACH ROW EXECUTE FUNCTION guard_login_events();

-- The migrator grants every table to the API role after migrating; these markers make it withhold access
-- ([app:none] = no direct access, [app:read] = SELECT only). See backend/src/db/migrate.ts.
REVOKE ALL ON login_account_throttle, login_address_throttle FROM PUBLIC;
COMMENT ON TABLE login_account_throttle IS '[app:none] G-017 throttle state: only via login_gate/login_record/login_unlock';
COMMENT ON TABLE login_address_throttle IS '[app:none] G-017 throttle state: only via login_gate/login_record';
COMMENT ON TABLE login_events IS '[app:read] G-017 append-only login events, written only by SECURITY DEFINER functions';
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON login_events;
CREATE POLICY tenant_isolation_select ON login_events FOR SELECT USING (org_id = NULLIF(current_setting('app.org_id', true), '')::bigint);

-- Gate before the password is checked: refuses while the account key is locked or the address is over its limit.
CREATE OR REPLACE FUNCTION login_gate(p_org bigint, p_email text, p_address text, p_address_max int, p_window_min int)
RETURNS TABLE (allowed boolean, retry_after_seconds int, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text := lower(trim(p_email)); a record; ad record;
BEGIN
  SELECT * INTO a FROM login_account_throttle WHERE org_id = p_org AND email_key = k;
  IF a.locked_until IS NOT NULL AND a.locked_until > now() THEN
    INSERT INTO login_events(org_id, email_key, address, outcome) VALUES (p_org, k, p_address, 'blocked_locked');
    RETURN QUERY SELECT false, ceil(extract(epoch FROM a.locked_until - now()))::int, 'account_locked'::text; RETURN;
  END IF;
  IF p_address_max > 0 AND p_address IS NOT NULL THEN
    SELECT * INTO ad FROM login_address_throttle WHERE address = p_address;
    IF ad.address IS NOT NULL AND ad.window_started_at > now() - make_interval(mins => p_window_min) AND ad.failures >= p_address_max THEN
      INSERT INTO login_events(org_id, email_key, address, outcome) VALUES (p_org, k, p_address, 'blocked_address');
      RETURN QUERY SELECT false, ceil(extract(epoch FROM ad.window_started_at + make_interval(mins => p_window_min) - now()))::int, 'address_limited'::text; RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT true, 0, NULL::text;
END $$;

-- Records the outcome. A failure counts toward the account key (and the address); reaching the limit locks the key.
CREATE OR REPLACE FUNCTION login_record(p_org bigint, p_email text, p_address text, p_success boolean,
                                        p_max_failures int, p_window_min int, p_lock_min int, p_address_max int)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text := lower(trim(p_email)); n int;
BEGIN
  IF p_success THEN
    DELETE FROM login_account_throttle WHERE org_id = p_org AND email_key = k;
    INSERT INTO login_events(org_id, email_key, address, outcome) VALUES (p_org, k, p_address, 'success');
    RETURN false;
  END IF;
  INSERT INTO login_events(org_id, email_key, address, outcome) VALUES (p_org, k, p_address, 'failure');
  IF p_address_max > 0 AND p_address IS NOT NULL THEN
    INSERT INTO login_address_throttle AS t (address, failures, window_started_at) VALUES (p_address, 1, now())
    ON CONFLICT (address) DO UPDATE SET
      failures = CASE WHEN t.window_started_at <= now() - make_interval(mins => p_window_min) THEN 1 ELSE t.failures + 1 END,
      window_started_at = CASE WHEN t.window_started_at <= now() - make_interval(mins => p_window_min) THEN now() ELSE t.window_started_at END;
  END IF;
  IF p_max_failures <= 0 THEN RETURN false; END IF;
  INSERT INTO login_account_throttle AS t (org_id, email_key, failures, window_started_at) VALUES (p_org, k, 1, now())
  ON CONFLICT (org_id, email_key) DO UPDATE SET
    failures = CASE WHEN t.window_started_at <= now() - make_interval(mins => p_window_min) THEN 1 ELSE t.failures + 1 END,
    window_started_at = CASE WHEN t.window_started_at <= now() - make_interval(mins => p_window_min) THEN now() ELSE t.window_started_at END
  RETURNING failures INTO n;
  IF n >= p_max_failures THEN
    UPDATE login_account_throttle SET locked_until = now() + make_interval(mins => p_lock_min), failures = 0, window_started_at = now()
     WHERE org_id = p_org AND email_key = k;
    INSERT INTO login_events(org_id, email_key, address, outcome) VALUES (p_org, k, p_address, 'locked_out');
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- Administrator unlock: only for a user of the caller's own organization (checked under the caller's RLS context).
CREATE OR REPLACE FUNCTION login_unlock(p_user bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o bigint := NULLIF(current_setting('app.org_id', true), '')::bigint; e text;
BEGIN
  SELECT lower(email) INTO e FROM users WHERE id = p_user AND org_id = o;
  IF e IS NULL THEN RETURN false; END IF;
  DELETE FROM login_account_throttle WHERE org_id = o AND email_key = e;
  INSERT INTO login_events(org_id, email_key, address, outcome) VALUES (o, e, NULL, 'unlocked');
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION login_gate(bigint, text, text, int, int), login_record(bigint, text, text, boolean, int, int, int, int), login_unlock(bigint) FROM PUBLIC;
-- EXECUTE is granted to the API role by the migrator (grant execute on all functions).
