#!/bin/bash
set -euo pipefail
cd ~/abooerp
set -a
source <(grep -E '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD)=' server/.env)
set +a

DEVICE_ID="${1:?device id}"
TOKEN="${2:?token}"
TOKEN_HASH=$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')

ADMIN=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "select id::text from users where username='admin' and status='active' limit 1")
COMPANY=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "select company_id::text from users where id='$ADMIN'::uuid")
BRANCH=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "select id::text from branches where company_id='$COMPANY'::uuid and code='MAIN' and is_active=true limit 1")
if [ -z "$BRANCH" ]; then
  BRANCH=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc "select id::text from branches where company_id='$COMPANY'::uuid and is_active=true order by created_at asc limit 1")
fi

echo "ADMIN=$ADMIN"
echo "COMPANY=$COMPANY"
echo "BRANCH=$BRANCH"
echo "DEVICE_ID=$DEVICE_ID"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 <<SQL
insert into linked_devices(
  id, machine_id, device_name, os_type, company_id, branch_id,
  is_approved, is_blocked, registered_by, app_version, local_schema_version,
  sync_state, sync_secret_hash, sync_credential_issued_at, last_seen_at, created_at, updated_at
) values (
  '$DEVICE_ID'::uuid, '$DEVICE_ID', 'nabil-desktop-sync', 'windows',
  '$COMPANY'::uuid, '$BRANCH'::uuid,
  true, false, '$ADMIN'::uuid, '1.0.1-dev', '112_offline_sync_foundation',
  'active', '$TOKEN_HASH', now(), now(), now(), now()
)
on conflict (machine_id) do update set
  id = excluded.id,
  device_name = excluded.device_name,
  branch_id = excluded.branch_id,
  is_approved = true,
  is_blocked = false,
  registered_by = excluded.registered_by,
  sync_state = 'active',
  sync_secret_hash = excluded.sync_secret_hash,
  sync_credential_issued_at = now(),
  last_seen_at = now(),
  updated_at = now();

-- keep id aligned if conflict updated by machine_id only
update linked_devices
set sync_secret_hash='$TOKEN_HASH', is_approved=true, is_blocked=false, sync_state='active', updated_at=now()
where machine_id='$DEVICE_ID';
SQL

echo "DEVICE_READY=1"
