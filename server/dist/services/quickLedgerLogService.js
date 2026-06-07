import fs from 'node:fs/promises';
import path from 'node:path';
const logsRoot = path.resolve(process.cwd(), 'server', 'logs', 'quick-ledger');
function logFileForDate(date = new Date()) {
    const day = date.toISOString().slice(0, 10);
    return path.join(logsRoot, `ledger-${day}.log`);
}
export async function appendQuickLedgerClientLogs(companyId, userId, entries) {
    if (!entries.length) {
        return { filePath: logFileForDate(), written: 0 };
    }
    await fs.mkdir(logsRoot, { recursive: true });
    const filePath = logFileForDate();
    const lines = entries
        .map((entry) => JSON.stringify({
        companyId,
        userId,
        ...entry,
    }))
        .join('\n');
    await fs.appendFile(filePath, `${lines}\n`, 'utf8');
    return { filePath, written: entries.length };
}
