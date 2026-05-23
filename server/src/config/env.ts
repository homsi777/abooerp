import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

function loadEnvFile() {
  const cwd = process.cwd();
  const explicitEnvPath = process.env.SERVER_ENV_FILE;

  // In packaged Electron the env file lives in app userData, set by electron/main.ts
  const candidates = explicitEnvPath
    ? [path.resolve(explicitEnvPath)]                      // absolute path from electron
    : [
        path.resolve(cwd, 'server/.env'),                  // dev: repo root
        path.resolve(cwd, '.env'),                          // dev: alternative
      ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    config({ path: envPath });
    return;
  }

  config(); // fallback: read from process.env directly (electron sets them via utilityProcess)
}

loadEnvFile();

// في التطوير: نفس `config/dev-ports.json` لمنفذ الـ API حتى تتطابق `wait-on` و Electron والسيرفر.
// (إن كان `SERVER_PORT` في server/.env قديماً مثل 4000 يتسبب بانتظار أبدي على 4010 وعدم فتح النافذة.)
if (process.env.NODE_ENV !== 'production' && process.env.LOCK_SERVER_PORT !== '1') {
  const devPortsPath = path.join(process.cwd(), 'config', 'dev-ports.json');
  if (fs.existsSync(devPortsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(devPortsPath, 'utf-8')) as { api?: unknown };
      const port = Number(raw.api);
      if (Number.isFinite(port) && port > 0 && port < 65536) {
        process.env.SERVER_PORT = String(port);
      }
    } catch {
      /* ignore */
    }
  }
}

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
  SERVER_HOST: z.string().default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().int().positive().default(4010),
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
  ALLOW_DEV_USER_HEADER: z
    .string()
    .optional()
    .transform((value) => ['true', '1', 'yes', 'on'].includes((value || '').toLowerCase())),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid server environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Server startup failed due to invalid environment configuration.');
}

const DEFAULT_JWT_SECRET = 'dev-change-me-super-long-jwt-secret-32chars+';
// When packaged via Electron, AUTH_JWT_SECRET is generated dynamically and injected via process.env
// So we skip this check when ELECTRON_PACKAGED=1 is set
if (
  parsed.data.NODE_ENV === 'production' &&
  parsed.data.AUTH_JWT_SECRET === DEFAULT_JWT_SECRET &&
  process.env.ELECTRON_PACKAGED !== '1'
) {
  throw new Error(
    'Refusing to start in production with default AUTH_JWT_SECRET. Set a long random value in the environment.',
  );
}

export const env = parsed.data;
