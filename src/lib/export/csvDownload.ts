/**
 * Export tabular data as a UTF-8 CSV file (Excel-compatible with BOM for Arabic).
 */
function escapeCell(value: string | number | boolean | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

export function downloadCsv(
  filename: string,
  headers: string[],
  dataRows: (string | number | boolean | null | undefined)[][],
): void {
  const body = [headers, ...dataRows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const bom = '\uFEFF';
  const fullName = filename.endsWith('.csv') ? filename : `${filename}.csv`;

  if (typeof window !== 'undefined' && window.csvRuntime?.exportCsv) {
    void window.csvRuntime.exportCsv({
      title: fullName,
      defaultFileName: fullName,
      csv: bom + body,
    });
    return;
  }

  const blob = new Blob([bom + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fullName;
  a.click();
  URL.revokeObjectURL(url);
}
