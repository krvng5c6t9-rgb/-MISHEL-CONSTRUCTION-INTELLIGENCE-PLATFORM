-- Stage 60 / CC-090 (MP-03 §5): verification of a digital copy by its fingerprint.
-- (transaction managed by migrator)
-- Before (E3 @CC-089): an export entry could be found only by its number. Now POST /documents/verify also finds the
-- entry of a digital copy (PDF / HTML as exported) by the SHA-256 of its bytes, within the company; this index serves
-- that lookup. No data changes.
-- Rollback: drop index idx_document_exports_sha256.

CREATE INDEX IF NOT EXISTS idx_document_exports_sha256 ON document_exports(org_id, sha256) WHERE sha256 IS NOT NULL;
