-- Existing desktop mirrors may contain only the administrator who activated
-- the device. Refresh them once so every active user assigned to the device
-- branch is available for offline login with the correct RBAC scope.
update sync_local_state
set resnapshot_required = true,
    updated_at = now()
where singleton = true
  and snapshot_initialized_at is not null;
