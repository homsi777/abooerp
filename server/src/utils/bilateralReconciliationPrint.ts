function formatMoney(value: unknown, currency = 'USD'): string {
  const num = Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (String(currency).toUpperCase() === 'USD') return `${num} USD ($)`;
  return `${num} ${currency}`;
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).split('T')[0] ?? '—';
  return d.toLocaleDateString('ar-SY');
}

function isCountDescription(description: string) {
  return description.startsWith('عدد ');
}

export function buildBilateralReconciliationPrintHtmlServer(data: {
  agent?: { name?: string; code?: string };
  periodFrom?: string;
  periodTo?: string;
  currencyCode?: string;
  previousBalance?: number;
  periodMovement?: number;
  currentBalance?: number;
  status?: string;
  notes?: string;
  agentNotes?: string;
  forceApproveNote?: string;
  items?: Array<{
    description?: string;
    company_amount?: number;
    agent_amount?: number | null;
    difference?: number | null;
    status?: string;
  }>;
}): string {
  const agent = data.agent ?? {};
  const currency = data.currencyCode || 'USD';
  const statusLabel: Record<string, string> = {
    draft: 'مسودة',
    pending: 'قيد المراجعة',
    approved: 'معتمد',
    disputed: 'متنازع عليه',
  };
  const rows = (data.items ?? [])
    .map((item) => {
      const desc = item.description ?? '—';
      const company = isCountDescription(desc)
        ? String(Math.round(Number(item.company_amount ?? 0)))
        : formatMoney(item.company_amount ?? 0, currency);
      const agentVal = item.agent_amount == null
        ? '—'
        : isCountDescription(desc)
          ? String(Math.round(Number(item.agent_amount)))
          : formatMoney(item.agent_amount, currency);
      const diff = item.difference == null
        ? '—'
        : isCountDescription(desc)
          ? String(Math.round(Number(item.difference)))
          : formatMoney(item.difference, currency);
      const st = item.status === 'matched' ? 'متطابق' : item.status === 'disputed' ? 'نزاع' : 'غير متطابق';
      return `<tr><td>${desc}</td><td>${company}</td><td>${agentVal}</td><td>${diff}</td><td>${st}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>مطابقة ثنائية</title>
<style>body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:8px;text-align:right}th{background:#f3f4f6}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}</style>
</head><body>
<h1>مطابقة ثنائية — وكيل ↔ فرع رئيسي</h1>
<div class="meta">
<div><strong>الوكيل:</strong> ${agent.name ?? '—'}${agent.code ? ` (${agent.code})` : ''}</div>
<div><strong>من:</strong> ${formatDate(data.periodFrom)}</div>
<div><strong>إلى:</strong> ${formatDate(data.periodTo)}</div>
<div><strong>الحالة:</strong> ${statusLabel[String(data.status ?? '')] ?? data.status ?? '—'}</div>
<div><strong>الذمة السابقة:</strong> ${formatMoney(data.previousBalance ?? 0, currency)}</div>
<div><strong>حركات الفترة:</strong> ${formatMoney(data.periodMovement ?? 0, currency)}</div>
<div><strong>الذمة الحالية:</strong> ${formatMoney(data.currentBalance ?? 0, currency)}</div>
</div>
<table><thead><tr><th>البند</th><th>الشركة</th><th>الوكيل</th><th>الفرق</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>
<p><strong>ملاحظات الفرع:</strong> ${data.notes?.trim() || '—'}</p>
<p><strong>ملاحظات الوكيل:</strong> ${data.agentNotes?.trim() || '—'}</p>
${data.forceApproveNote ? `<p><strong>اعتماد قسري:</strong> ${data.forceApproveNote}</p>` : ''}
<h3>التوقيع</h3>
<table><thead><tr><th>الطرف</th><th>الاسم</th><th>التوقيع</th><th>التاريخ</th></tr></thead>
<tbody><tr><td>الفرع الرئيسي</td><td></td><td></td><td></td></tr><tr><td>الوكيل</td><td></td><td></td><td></td></tr></tbody></table>
</body></html>`;
}
