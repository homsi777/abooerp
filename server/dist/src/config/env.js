import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
function loadEnvFile() {
    const cwd = process.cwd();
    const explicitEnvPath = process.env.SERVER_ENV_FILE;
    const candidates = explicitEnvPath
        ? [path.resolve(cwd, explicitEnvPath)]
        : [path.resolve(cwd, 'server/.env'), path.resolve(cwd, '.env')];
    for (const envPath of candidates) {
        if (!fs.existsSync(envPath)) {
            continue;
        }
        config({ path: envPath });
        return;
    }
    config();
}
loadEnvFile();
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PGHOST: z.string().min(1),
    PGPORT: z.coerce.number().int().positive().default(5432),
    PGDATABASE: z.string().min(1),
    PGUSER: z.string().min(1),
    PGPASSWORD: z.string().min(1),
    PGSSL_ENABLED: z
        .string()
        .optional()
        .transform((value) => ['true', '1', 'yes', 'on'].includes((value || '').toLowerCase())),
    PGSSL_REJECT_UNAUTHORIZED: z
        .string()
        .optional()
        .transform((value) => !['false', '0', 'no', 'off'].includes((value || '').toLowerCase())),
    SERVER_PORT: z.coerce.number().int().positive().default(4000),
    AUTH_JWT_SECRET: z.string().min(32).default('dev-change-me-super-long-jwt-secret-32chars+'),
    AUTH_ACCESS_TOKEN_TTL: z.string().default('15m'),
    AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    DASHBOARD_CACHE_TTL_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
    DASHBOARD_CACHE_RESET_ENABLED: z
        .string()
        .optional()
        .transform((value) => !['false', '0', 'no', 'off'].includes((value || '').toLowerCase())),
    DASHBOARD_CACHE_RESET_REQUIRE_CONFIRM: z
        .string()
        .optional()
        .transform((value) => ['true', '1', 'yes', 'on'].includes((value || '').toLowerCase())),
    AUTH_STRICT_RBAC: z
        .string()
        .optional()
        .transform((value) => !['false', '0', 'no', 'off'].includes((value || '').toLowerCase())),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid server environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Server startup failed due to invalid environment configuration.');
}
export const env = parsed.data;
