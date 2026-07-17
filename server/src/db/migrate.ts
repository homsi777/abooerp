import fs from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from './pool.js';
import { env } from '../config/env.js';
import { createEncryptedLocalMigrationBackup } from './localMigrationBackup.js';

async function ensureMigrationTable(client: PoolClient) {
  await client.query(`
    create table if not exists schema_migrations (
      id serial primary key,
      name text not null unique,
      executed_at timestamptz not null default now()
    )
  `);
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;
  let localSafetyBackupTaken = false;
  let hasExistingSchema = false;
  try {
    await client.query('select pg_advisory_lock($1)', [902001]);
    lockAcquired = true;
    await ensureMigrationTable(client);
    const migrationCount = await client.query<{ count: string }>('select count(*)::text as count from schema_migrations');
    hasExistingSchema = Number(migrationCount.rows[0]?.count ?? 0) > 0;

    // In packaged Electron, MIGRATIONS_DIR points to extraResources/migrations
    const migrationsDir = process.env.MIGRATIONS_DIR
      ? path.resolve(process.env.MIGRATIONS_DIR)
      : path.resolve(process.cwd(), 'server/src/db/migrations');
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const alreadyRun = await client.query<{ name: string }>('select name from schema_migrations where name = $1', [file]);
      if (alreadyRun.rowCount) {
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(fullPath, 'utf8');

      try {
        if (env.SYNC_NODE_ROLE === 'local' && hasExistingSchema && !localSafetyBackupTaken && /\b(drop|truncate|alter\s+table)\b/i.test(sql)) {
          await createEncryptedLocalMigrationBackup(`before migration ${file}`);
          localSafetyBackupTaken = true;
        }
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations(name) values($1)', [file]);
        await client.query('commit');
        console.info(`[MIGRATION] Applied ${file}`);
      } catch (error) {
        await client.query('rollback');
        console.error(`[MIGRATION] Failed ${file}`, error);
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      await client.query('select pg_advisory_unlock($1)', [902001]);
    }
    client.release();
  }
}

const isDirectExecution = (() => {
  const entry = String(process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
  return entry.endsWith('/db/migrate.ts') || entry.endsWith('/db/migrate.js');
})();

if (isDirectExecution) {
  runMigrations()
    .then(() => {
      void pool.end();
    })
    .catch((error) => {
      console.error('[MIGRATION] Failed to run migrations', error);
      void pool.end().finally(() => process.exit(1));
    });
}
