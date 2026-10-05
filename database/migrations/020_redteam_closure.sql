BEGIN;
-- Never ship guessed approval authority as usable business configuration.
DELETE FROM delegation_of_authority WHERE upper(coalesce(notes,'')) LIKE '%PLACEHOLDER%' AND coalesce(is_confirmed,false)=false;
-- A guessed retention standard is worse than an unset policy: require explicit company configuration.
DELETE FROM system_settings WHERE setting_key='default_retention_percent' AND setting_value='10';
-- Remove the original demonstrative client if it was never converted into real master data.
DELETE FROM clients WHERE legal_name='PLACEHOLDER — confirm legal name' AND tax_id='PLACEHOLDER — confirm tax ID'
  AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id=clients.id)
  AND NOT EXISTS (SELECT 1 FROM tenders t WHERE t.client_id=clients.id);
CREATE INDEX IF NOT EXISTS idx_claims_org_project_status ON contract_claims(org_id,project_id,status);
CREATE INDEX IF NOT EXISTS idx_inventory_org_wh_item ON inventory_transactions(org_id,warehouse_id,inventory_item_id,transaction_date);
COMMIT;
