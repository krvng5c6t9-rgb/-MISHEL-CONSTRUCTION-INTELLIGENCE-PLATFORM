-- (transaction managed by migrator)

-- Prevent duplicate simultaneously-pending approval instances for the same business record.
CREATE UNIQUE INDEX IF NOT EXISTS ux_approval_instances_one_pending_record
ON approval_instances(org_id, module, record_id)
WHERE status = 'pending';

-- A single user may not approve multiple steps of the same approval instance.
CREATE UNIQUE INDEX IF NOT EXISTS ux_approval_actions_one_approval_per_user
ON approval_actions_log(approval_instance_id, approver_id)
WHERE action = 'approved';

-- (transaction managed by migrator)
