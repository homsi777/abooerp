-- Refresh existing desktop mirrors so company-level finance rows (branch_id is
-- null) are included alongside the device branch history.
update sync_local_state
set resnapshot_required = true,
    updated_at = now()
where singleton = true
  and snapshot_initialized_at is not null;
