import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  buildMahmoudPreprintedReceiptHtml,
  MAHMOUD_RECEIPT_DUMMY_ROWS,
} from '../src/lib/shipping/mahmoudPreprintedReceiptPrint.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'print-tests');
const outFile = join(outDir, 'mahmoud-receipt-calibration.html');

const html = buildMahmoudPreprintedReceiptHtml(MAHMOUD_RECEIPT_DUMMY_ROWS.slice(0, 4), {
  debug: true,
  overlay: true,
  title: 'معايرة إيصالات المحمود',
});

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html, 'utf8');
console.log('Written:', outFile);

if (process.platform === 'win32') {
  spawn('cmd', ['/c', 'start', '', outFile], { detached: true, stdio: 'ignore' }).unref();
}
