-- Stage 56 / CC-086 / R1.5 second part (MP-03 §2): more printed documents.
-- (transaction managed by migrator)
-- Before (E3 @CC-085): the export log accepted the client IPC and the subcontractor certificate only.
-- Now it also accepts the purchase order (DOC-09-004), goods received note (DOC-10-001), payment / receipt voucher
-- (DOC-16-006 / DOC-16-004, one record type: payments), journal voucher (DOC-16-020, manual journal entries) and
-- daily site diary (DOC-12-004). Entries stay permanent (guard of migration 092 unchanged).
-- Rollback: restore the check of migration 092 (only if no entry of the new types exists).

ALTER TABLE document_exports DROP CONSTRAINT IF EXISTS document_exports_doc_type_check;
ALTER TABLE document_exports ADD CONSTRAINT document_exports_doc_type_check
  CHECK (doc_type IN ('ipc', 'subcontract_certificate', 'purchase_order', 'goods_receipt', 'payment', 'manual_journal', 'site_diary'));
