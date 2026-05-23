import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const targets = ['dist', 'dist-electron', 'dist-server', 'dist-release-next'];
const root = process.cwd();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tryKill(imageName) {
  try {
    execSync(`taskkill /F /IM "${imageName}" /T`, { stdio: 'ignore' });
  } catch {
    return;
  }
}

async function removeDir(target) {
  const full = path.join(root, target);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
      return;
    } catch (err) {
      if (attempt === 89) throw err;
      await sleep(1000);
    }
  }
}

tryKill('شركة عبو المحمود لنقل والخدمات الوجستية.exe');
tryKill('shahn.exe');

for (const target of targets) {
  await removeDir(target);
}

console.log('packaging artifacts cleaned');
