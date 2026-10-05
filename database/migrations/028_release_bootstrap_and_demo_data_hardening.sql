-- (transaction managed by migrator)

-- If the untouched Phase-1 placeholder organization still exists, neutralize its guessed identity.
-- Do not overwrite organizations that have already been configured by an operator.
UPDATE organizations
SET name = 'Construction ERP Bootstrap Organization',
    legal_name = NULL,
    tax_id = NULL,
    updated_at = now()
WHERE id = 1
  AND name = 'Al Sadim Architects & Consultants'
  AND legal_name = 'PLACEHOLDER — confirm legal name'
  AND tax_id = 'PLACEHOLDER — confirm tax ID';

-- No default/demo users are permitted in a release database. Remove only the exact historical
-- demonstration identity when it still carries the unusable placeholder hash and has no activity.
DELETE FROM users u
WHERE lower(u.email) = 'mishel@example.com'
  AND u.password_hash = 'CHANGE_ME_HASH'
  AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id = u.id);

-- (transaction managed by migrator)
