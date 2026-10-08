-- CC-036 (G-016): database views ran with the view owner's rights (BYPASSRLS migrator), so RLS on base tables did
-- not apply to them. Runtime probe (sweep_view_isolation.mjs) as the app role under tenant B: v_boq_vs_actual,
-- v_portfolio_summary (21 foreign projects), v_procurement_cycle_time and v_vendor_performance returned tenant A rows.
-- API routes filtered by org (E3), so the exposure was at DB level (defence in depth / any future consumer).
-- Fix: every view evaluates with the caller's rights (security_invoker, PostgreSQL 15+).
-- (transaction managed by migrator)
DO $$ DECLARE v text; BEGIN
  FOR v IN SELECT c.relname FROM pg_class c WHERE c.relkind = 'v' AND c.relnamespace = 'public'::regnamespace LOOP
    EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v);
  END LOOP;
END $$;
