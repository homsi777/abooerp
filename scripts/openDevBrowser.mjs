import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const ports = JSON.parse(readFileSync(join(root, 'config', 'dev-ports.json'), 'utf-8'));
const hold = process.argv.includes('--hold');
const urlArg = process.argv.find((arg) => arg.startsWith('http://') || arg.startsWith('https://'));
const url = urlArg || `http://127.0.0.1:${ports.vite || 5188}/#/login`;

function open(urlToOpen) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', urlToOpen], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', [urlToOpen], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [urlToOpen], { detached: true, stdio: 'ignore' }).unref();
}

open(url);
console.log(`Opened browser: ${url}`);

if (hold) {
  setInterval(() => {}, 2_147_483_647);
}
