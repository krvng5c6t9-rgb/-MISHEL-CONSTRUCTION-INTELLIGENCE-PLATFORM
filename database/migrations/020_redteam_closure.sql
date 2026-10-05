-- (transaction managed by migrator)
-- Never ship guessed approval authority as usable business configuration.
-- Deactivate (not delete): approval_workflow_steps reference these rows by FK.
UPDATE delegation_of_authority SET is_active=false, updated_at=now() WHERE upper(coalesce(notes,'')) LIKE '%PLACEHOLDER%' AND coalesce(is_confirmed,false)=false;
-- A guessed retention standard is worse than an unset policy: require explicit company configuration.
DELETE FROM system_settings WHERE setting_key='default_retention_percent' AND setting_value='10';
-- The demonstrative placeholder lives in organizations (001), handled by 028; clients has no legal_name column.
CREATE INDEX IF NOT EXISTS idx_claims_org_project_status ON contract_claims(org_id,project_id,status);
CREATE INDEX IF NOT EXISTS idx_inventory_org_wh_item ON inventory_transactions(org_id,warehouse_id,inventory_item_id,transaction_date);
-- (transaction managed by migrator)
