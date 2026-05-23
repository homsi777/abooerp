'use strict';
// Auto-generated CJS wrapper that loads the server bundle
const path = require('path');
const fs   = require('fs');

const serverCjs = path.join(__dirname, 'server.cjs');
const logFile   = path.join(process.env.APPDATA || process.env.HOME || '', 'server-crash.log');

function fatal(err) {
  const msg = '[server-wrapper] FATAL: ' + (err && err.stack ? err.stack : String(err)) + '\n';
  process.stderr.write(msg);
  try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg); } catch {}
  process.exit(1);
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

try {
  require(serverCjs);
} catch (e) {
  fatal(e);
}
