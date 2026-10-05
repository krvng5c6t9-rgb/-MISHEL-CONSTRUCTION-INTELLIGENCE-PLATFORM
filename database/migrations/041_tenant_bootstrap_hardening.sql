-- G-006 / F-08: tenant bootstrap hardening.
-- (transaction managed by migrator)
-- The bootstrap flow runs under tenant RLS and could only count *active* users of the target org,
-- so an organization whose users were all deactivated could be re-claimed with the global bootstrap
-- token. These SECURITY DEFINER helpers (owned by the migrator role, which bypasses RLS) answer the
-- two platform-level questions bootstrap needs, without exposing any row data.
CREATE OR REPLACE FUNCTION platform_org_has_any_user(p_org bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS
$$ SELECT EXISTS (SELECT 1 FROM public.users WHERE org_id = p_org) $$;

CREATE OR REPLACE FUNCTION platform_has_any_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS
$$ SELECT EXISTS (SELECT 1 FROM public.users) $$;

REVOKE ALL ON FUNCTION platform_org_has_any_user(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform_has_any_user() FROM PUBLIC;
