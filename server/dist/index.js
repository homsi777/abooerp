import { app } from './app.js';
import { env } from './config/env.js';
import { testDatabaseConnection, pool } from './db/pool.js';
async function start() {
    try {
        await testDatabaseConnection();
        app.listen(env.SERVER_PORT, () => {
            console.info(`[SERVER] Backend foundation running on http://localhost:${env.SERVER_PORT}`);
        });
    }
    catch (error) {
        console.error('[SERVER] Startup failed: unable to connect PostgreSQL.', error);
        await pool.end();
        process.exit(1);
    }
}
start();
