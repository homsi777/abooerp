import { pool } from '../db/pool.js';
export function isTransientDbError(error) {
    const code = error?.code;
    return code === '40001' || code === '40P01' || code === '55P03';
}
export async function withDbRetry(operation, maxRetries = 2) {
    let attempt = 0;
    while (true) {
        try {
            return await operation();
        }
        catch (error) {
            if (!isTransientDbError(error) || attempt >= maxRetries) {
                throw error;
            }
            attempt += 1;
            await new Promise((resolve) => setTimeout(resolve, 30 * attempt));
        }
    }
}
export async function runInTransaction(handler) {
    const client = await pool.connect();
    try {
        await client.query('begin');
        const result = await handler(client);
        await client.query('commit');
        return result;
    }
    catch (error) {
        await client.query('rollback');
        throw error;
    }
    finally {
        client.release();
    }
}
