import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const srcMigrationsDir = path.join(root, 'server', 'src', 'db', 'migrations');
const releaseDirName = String(process.env.RELEASE_DIR || 'dist-release').trim() || 'dist-release';
const releaseResourcesDir = path.join(root, releaseDirName, 'win-unpacked', 'resources');
const releaseMigrationsDir = path.join(releaseResourcesDir, 'migrations');

function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function assertExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

try {
  assertExists(path.join(root, 'dist', 'index.html'), 'renderer build');
  assertExists(path.join(releaseResourcesDir, 'app.asar'), 'app.asar');
  assertExists(path.join(releaseResourcesDir, 'server.cjs'), 'bundled server');
  assertExists(path.join(releaseResourcesDir, 'server-wrapper.cjs'), 'server wrapper');
  assertExists(path.join(releaseResourcesDir, 'app-config.env'), 'app-config.env');
  assertExists(releaseMigrationsDir, 'release migrations directory');

  const sourceMigrations = listSqlFiles(srcMigrationsDir);
  const releaseMigrations = new Set(listSqlFiles(releaseMigrationsDir));

  if (sourceMigrations.length === 0) {
    throw new Error('No source migrations found.');
  }

  const latestMigration = sourceMigrations[sourceMigrations.length - 1];
  if (!releaseMigrations.has(latestMigration)) {
    throw new Error(`Latest migration missing from packaged resources: ${latestMigration}`);
  }

  console.log('[verify-release] ✅ Release package contains latest build outputs.');
  console.log(`[verify-release] Latest migration: ${latestMigration}`);
  process.exit(0);
} catch (error) {
  console.error('[verify-release] ❌ Verification failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
