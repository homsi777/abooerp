import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';

const repoRoot = process.cwd();
const releaseDir = path.resolve(repoRoot, process.env.RELEASE_DIR || 'dist-release-next');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const database = `almiya_pkg_smoke_${randomBytes(6).toString('hex')}`;
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'almiya-packaged-smoke-'));
const pgBinCandidates = [
  process.env.POSTGRES_BIN,
  'C:\\Program Files\\PostgreSQL\\16\\bin',
  'C:\\Program Files\\PostgreSQL\\17\\bin',
  'C:\\Program Files\\PostgreSQL\\15\\bin',
].filter(Boolean);
const pgBin = pgBinCandidates.find((candidate) => existsSync(path.join(candidate, 'createdb.exe')));

if (!pgBin) throw new Error('PostgreSQL command-line tools were not found. Set POSTGRES_BIN.');
if (!existsSync(unpackedDir)) throw new Error(`Packaged directory not found: ${unpackedDir}`);

loadDotEnv({ path: path.join(repoRoot, 'server', '.env') });
const pgPassword = process.env.PGPASSWORD;
if (!pgPassword) throw new Error('PGPASSWORD is required (directly or through server/.env).');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: options.env || process.env,
      windowsHide: true,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || options.allowFailure) resolve({ code, stdout, stderr });
      else reject(new Error(`${path.basename(command)} exited with ${code}\n${stderr}`));
    });
  });
}

async function waitForHealth(serverProcess) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null) return false;
    try {
      const response = await fetch('http://127.0.0.1:4010/api/health');
      if (response.ok) return true;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

let serverProcess;
let databaseCreated = false;
try {
  try {
    const existing = await fetch('http://127.0.0.1:4010/api/health');
    if (existing.ok) throw new Error('Port 4010 is already serving an API; refusing an ambiguous smoke test.');
  } catch (error) {
    if (String(error?.message || '').includes('already serving')) throw error;
  }

  const baseEnv = {
    ...process.env,
    PGPASSWORD: pgPassword,
    NODE_ENV: 'test',
    PGHOST: '127.0.0.1',
    PGPORT: process.env.PGPORT || '5432',
    PGUSER: process.env.PGUSER || 'postgres',
    PGDATABASE: database,
    PGSSL_ENABLED: 'false',
    ALLOW_DB_SEED: 'false',
    LOCK_SERVER_PORT: '1',
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: '4010',
    AUTH_JWT_SECRET: 'package-smoke-only-secret-0123456789abcdef',
    SYNC_NODE_ROLE: 'disabled',
  };

  await run(path.join(pgBin, 'createdb.exe'), ['-h', '127.0.0.1', '-p', baseEnv.PGPORT, '-U', baseEnv.PGUSER, database], { env: baseEnv });
  databaseCreated = true;
  await run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/src/db/migrate.ts'], { env: baseEnv });

  serverProcess = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/src/index.ts'], {
    cwd: repoRoot,
    env: baseEnv,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverStderr = '';
  serverProcess.stderr.on('data', (chunk) => { serverStderr += chunk.toString(); });
  if (!(await waitForHealth(serverProcess))) {
    throw new Error(`Isolated server did not become healthy.\n${serverStderr}`);
  }

  const executable = existsSync(path.join(unpackedDir, 'resources', 'app.asar'))
    ? readdirSync(unpackedDir).find((name) => name.toLowerCase().endsWith('.exe'))
    : null;
  if (!executable) throw new Error(`Packaged executable not found in ${unpackedDir}`);

  const electronEnv = {
    ...process.env,
    APPDATA: path.join(tempRoot, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(tempRoot, 'AppData', 'Local'),
    ELECTRON_SMOKE_RUNTIME: '1',
  };
  const result = await run(path.join(unpackedDir, executable), [], { env: electronEnv, capture: true });
  console.info('[PACKAGED-RUNTIME-SMOKE]', JSON.stringify({
    status: 'PASS',
    executable,
    isolatedDatabase: database,
    serverHealth: 200,
    electronExitCode: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }));
} finally {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL');
  }
  if (databaseCreated && /^almiya_pkg_smoke_[0-9a-f]{12}$/.test(database)) {
    await run(path.join(pgBin, 'dropdb.exe'), [
      '-h', '127.0.0.1',
      '-p', process.env.PGPORT || '5432',
      '-U', process.env.PGUSER || 'postgres',
      '--if-exists',
      '--force',
      database,
    ], { env: { ...process.env, PGPASSWORD: pgPassword }, allowFailure: true });
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
