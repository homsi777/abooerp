import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './pool.js';
async function ensureMigrationTable(client) {
    await client.query(`
    create table if not exists schema_migrations (
      id serial primary key,
      name text not null unique,
      executed_at timestamptz not null default now()
    )
  `);
}
async function runMigrations() {
    const client = await pool.connect();
    let lockAcquired = false;
    try {
        await client.query('select pg_advisory_lock($1)', [902001]);
        lockAcquired = true;
        await ensureMigrationTable(client);
        const migrationsDir = path.resolve(process.cwd(), 'server/src/db/migrations');
        const files = (await fs.readdir(migrationsDir))
            .filter((file) => file.endsWith('.sql'))
            .sort();
        for (const file of files) {
            const alreadyRun = await client.query('select name from schema_migrations where name = $1', [file]);
            if (alreadyRun.rowCount) {
                continue;
            }
            const fullPath = path.join(migrationsDir, file);
            const sql = await fs.readFile(fullPath, 'utf8');
            try {
                await client.query('begin');
                await client.query(sql);
                await client.query('insert into schema_migrations(name) values($1)', [file]);
                await client.query('commit');
                console.info(`[MIGRATION] Applied ${file}`);
            }
            catch (error) {
                await client.query('rollback');
                console.error(`[MIGRATION] Failed ${file}`, error);
                throw error;
            }
        }
    }
    finally {
        if (lockAcquired) {
            await client.query('select pg_advisory_unlock($1)', [902001]);
        }
        client.release();
    }
}
runMigrations()
    .then(async () => {
    console.info('[MIGRATION] Completed successfully.');
    await pool.end();
})
    .catch(async (error) => {
    console.error('[MIGRATION] Aborted.', error);
    await pool.end();
    process.exit(1);
});
