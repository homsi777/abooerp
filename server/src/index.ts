import { app } from './app.js';
import { env } from './config/env.js';
import { testDatabaseConnection, pool } from './db/pool.js';
import { getLocalLanAddresses } from './utils/network.js';
import { ensureDatabase } from '../scripts/ensureDatabase.cjs';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { ensureLocalSyncIdentity, recoverInterruptedOutboxOperations } from './sync/localOutbox.js';
import { startLocalSyncWorker, stopLocalSyncWorker } from './sync/localSyncWorker.js';
import { startLocalBackupScheduler, stopLocalBackupScheduler } from './db/localMigrationBackup.js';

// Wrap top-level awaits in an async IIFE to support CJS bundle format
(async () => {
  try {
    await ensureDatabase();
    await testDatabaseConnection();
    await runMigrations();
    if (env.SYNC_NODE_ROLE !== 'local') {
      await runSeed();
    }
    await ensureLocalSyncIdentity();
    const recoveredSyncOperations = await recoverInterruptedOutboxOperations();
    if (recoveredSyncOperations > 0) {
      console.info(`[SYNC] Recovered ${recoveredSyncOperations} interrupted outbox operations.`);
    }
  } catch (error) {
    console.error('[SERVER] Startup failed:', error);
    await pool.end();
    process.exit(1);
  }

  app.listen(env.SERVER_PORT, env.SERVER_HOST, () => {
    const lanAddresses = getLocalLanAddresses();
    console.info(`[SERVER] ✅ Backend ready — listening on ${env.SERVER_HOST}:${env.SERVER_PORT}`);
    console.info(`[SERVER]   Local : http://127.0.0.1:${env.SERVER_PORT}`);
    if (!['127.0.0.1','localhost','::1'].includes(env.SERVER_HOST) && lanAddresses.length > 0) {
      for (const ip of lanAddresses) {
        console.info(`[SERVER]   LAN   : http://${ip}:${env.SERVER_PORT}`);
      }
    } else if (!['127.0.0.1','localhost','::1'].includes(env.SERVER_HOST)) {
      console.info(`[SERVER]   LAN   : (لم يتم اكتشاف عنوان LAN — تحقق من اتصال الشبكة)`);
    } else console.info('[SERVER]   LAN   : disabled (loopback-only desktop node)');
  });
  startLocalSyncWorker();
  startLocalBackupScheduler();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopLocalSyncWorker();
      stopLocalBackupScheduler();
    });
  }
})();
