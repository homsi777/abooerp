import fs from 'node:fs/promises';
import path from 'node:path';

export type QuickLedgerClientLogEntry = {
  id: string;
  at: string;
  level: string;
  phase: string;
  message: string;
  batchId?: string;
  rowLabel?: string;
  receiptNo?: string;
  destination?: string;
  details?: Record<string, unknown>;
};

const logsRoot = path.resolve(process.cwd(), 'server', 'logs', 'quick-ledger');

function logFileForDate(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return path.join(logsRoot, `ledger-${day}.log`);
}

export async function appendQuickLedgerClientLogs(
  companyId: string,
  userId: string | null,
  entries: QuickLedgerClientLogEntry[],
): Promise<{ filePath: string; written: number }> {
  if (!entries.length) {
    return { filePath: logFileForDate(), written: 0 };
  }
  await fs.mkdir(logsRoot, { recursive: true });
  const filePath = logFileForDate();
  const lines = entries
    .map((entry) =>
      JSON.stringify({
        companyId,
        userId,
        ...entry,
      }),
    )
    .join('\n');
  await fs.appendFile(filePath, `${lines}\n`, 'utf8');
  return { filePath, written: entries.length };
}
