import { app } from './app.js';
import { env } from './config/env.js';
import { testDatabaseConnection, pool } from './db/pool.js';
import { getLocalLanAddresses } from './utils/network.js';
import { ensureDatabase } from '../scripts/ensureDatabase.cjs';
import { runMigrations } from './db/migrate.js';
import { runSeed } from './db/seed.js';

// Wrap top-level awaits in an async IIFE to support CJS bundle format
(async () => {
  try {
    await ensureDatabase();
    await testDatabaseConnection();
    await runMigrations();
    await runSeed();
  } catch (error) {
    console.error('[SERVER] Startup failed:', error);
    await pool.end();
    process.exit(1);
  }

  app.listen(env.SERVER_PORT, env.SERVER_HOST, () => {
    const lanAddresses = getLocalLanAddresses();
    console.info(`[SERVER] ✅ Backend ready — listening on ${env.SERVER_HOST}:${env.SERVER_PORT}`);
    console.info(`[SERVER]   Local : http://127.0.0.1:${env.SERVER_PORT}`);
    if (lanAddresses.length > 0) {
      for (const ip of lanAddresses) {
        console.info(`[SERVER]   LAN   : http://${ip}:${env.SERVER_PORT}`);
      }
    } else {
      console.info(`[SERVER]   LAN   : (لم يتم اكتشاف عنوان LAN — تحقق من اتصال الشبكة)`);
    }
  });
})();
