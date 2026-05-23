/**
 * يُحرّر منافذ تطوير المشروع (تُعرّف في config/dev-ports.json) لتفادي EADDRINUSE.
 */
const path = require('node:path');
const fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const killPort = require('kill-port');

const devPortsPath = path.join(__dirname, '..', '..', 'config', 'dev-ports.json');
const { api, vite: vitePort } = JSON.parse(fs.readFileSync(devPortsPath, 'utf-8'));
const ports = [api, vitePort];

async function main() {
  for (const p of ports) {
    try {
      await killPort(p);
    } catch {
      /* */
    }
  }
}

main().then(() => {
  console.info(`[dev:free-ports] تمت محاولة تحرير API:${api} و Vite:${vitePort} إن وُجد عالق`);
});
