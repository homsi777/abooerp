import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

export type SyncOperationType = 'UPSERT' | 'DELETE' | 'ACTION';

export type EnqueueSyncOperationInput = {
  companyId?: string | null;
  branchId?: string | null;
  userId?: string | null;
  entityType: string;
  entityId: string;
  operationType: SyncOperationType;
  payload: Record<string, unknown>;
  payloadVersion?: number;
  localBaseVersion?: number | null;
};

export function isLocalSyncNode(): boolean {
  return env.SYNC_NODE_ROLE === 'local';
}

export async function ensureLocalSyncIdentity(): Promise<void> {
  if (!isLocalSyncNode()) return;
  if (!env.SYNC_DEVICE_ID) {
    throw new Error('SYNC_DEVICE_ID is required when SYNC_NODE_ROLE=local.');
  }
  await pool.query(
    `
    insert into sync_local_state(
      singleton, device_id, device_name, app_version, schema_version, updated_at
    ) values(true,$1,$2,$3,$4,now())
    on conflict(singleton) do update set
      device_id=excluded.device_id,
      device_name=excluded.device_name,
      app_version=excluded.app_version,
      schema_version=excluded.schema_version,
      updated_at=now()
    `,
    [
      env.SYNC_DEVICE_ID,
      env.SYNC_DEVICE_NAME ?? 'desktop-node',
      env.SYNC_APP_VERSION,
      env.SYNC_SCHEMA_VERSION,
    ],
  );
}

export async function enqueueSyncOperation(
  client: PoolClient,
  input: EnqueueSyncOperationInput,
): Promise<{ operationId: string; deviceSequence: string } | null> {
  if (!isLocalSyncNode()) return null;

  const identity = await client.query<{ device_id: string }>(
    `select device_id from sync_local_state where singleton=true for share`,
  );
  const deviceId = identity.rows[0]?.device_id;
  if (!deviceId) throw new Error('Local sync identity is not initialized.');

  const sequence = await client.query<{ value: string }>(
    `select nextval('sync_device_sequence')::text as value`,
  );
  const deviceSequence = sequence.rows[0]?.value;
  if (!deviceSequence) throw new Error('Unable to allocate device sync sequence.');

  const hashResult = await client.query<{ hash: string }>(
    `select encode(digest(convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') as hash`,
    [JSON.stringify(input.payload)],
  );
  const payloadHash = hashResult.rows[0].hash;
  const inserted = await client.query<{ operation_id: string }>(
    `
    insert into sync_outbox(
      device_id, device_sequence, company_id, branch_id, user_id,
      entity_type, entity_id, operation_type, payload, payload_version,
      payload_hash, local_base_version
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
    returning operation_id
    `,
    [
      deviceId,
      deviceSequence,
      input.companyId ?? null,
      input.branchId ?? null,
      input.userId ?? null,
      input.entityType,
      input.entityId,
      input.operationType,
      JSON.stringify(input.payload),
      input.payloadVersion ?? 1,
      payloadHash,
      input.localBaseVersion ?? null,
    ],
  );
  return { operationId: inserted.rows[0].operation_id, deviceSequence };
}

export async function recoverInterruptedOutboxOperations(): Promise<number> {
  if (!isLocalSyncNode()) return 0;
  const result = await pool.query(
    `
    update sync_outbox
    set sync_status='RETRY',
        next_retry_at=now(),
        last_error_code='WORKER_RESTARTED',
        last_error_message='Recovered after local sync worker restart.',
        updated_at=now()
    where sync_status='SENDING'
    `,
  );
  return result.rowCount ?? 0;
}
