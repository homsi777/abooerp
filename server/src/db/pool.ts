import { Pool } from 'pg';
import { env } from '../config/env.js';

const sslConfig = env.PGSSL_ENABLED
  ? {
      rejectUnauthorized: env.PGSSL_REJECT_UNAUTHORIZED,
    }
  : undefined;

export const pool = new Pool({
  host: env.PGHOST,
  port: env.PGPORT,
  database: env.PGDATABASE,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // PostgreSQL custom settings are read by sync triggers. They never contain secrets.
  options: `-c app.node_role=${env.SYNC_NODE_ROLE}`,
});

export async function testDatabaseConnection(): Promise<void> {
  const result = await pool.query<{ now: string }>('select now()::text as now');
  console.info(`[DB] PostgreSQL connection established at ${result.rows[0]?.now ?? 'unknown time'}`);
}
