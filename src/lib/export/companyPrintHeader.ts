import { resolveCompanyLogoPrintSrc } from '../branding/companyBrand';

export type CompanyPrintHeaderField = {
  label: string;
  value: string | number;
};

function escapePrintHeaderHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** أنماط رأس الطباعة الموحّد — يُضمَّن داخل &lt;style&gt; لكل مستند */
export function companyPrintHeaderStyles(): string {
  return `
    .company-print-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 2px solid #1e3a34;
      page-break-inside: avoid;
    }
    .company-print-logo {
      width: 184px;
      height: 184px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .company-print-fields {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 8px;
      font-size: 11px;
      min-width: 0;
    }
    .company-print-field {
      border: 1px solid #c5d0dc;
      padding: 3px 6px;
      background: #f8fafc;
      line-height: 1.25;
    }
    .company-print-field strong {
      font-weight: 800;
      color: #1e3a34;
    }
    .company-print-title {
      font-size: 15px;
      font-weight: 800;
      margin: 0 0 8px;
      text-align: center;
      color: #10251f;
    }
  `;
}

export function renderCompanyPrintHeader(options: {
  fields: CompanyPrintHeaderField[];
  logoSrc?: string;
  title?: string;
}): string {
  const logoSrc = options.logoSrc ?? resolveCompanyLogoPrintSrc();
  const titleHtml = options.title
    ? `<p class="company-print-title">${escapePrintHeaderHtml(options.title)}</p>`
    : '';

  if (!options.fields.length) {
    return `${titleHtml}<header class="company-print-header">
  <img class="company-print-logo" src="${escapePrintHeaderHtml(logoSrc)}" alt="شعار الشركة" />
</header>`;
  }

  const fieldsHtml = options.fields
    .map(
      (field) =>
        `<div class="company-print-field"><strong>${escapePrintHeaderHtml(field.label)}:</strong> ${escapePrintHeaderHtml(field.value)}</div>`,
    )
    .join('');

  return `${titleHtml}<header class="company-print-header">
  <img class="company-print-logo" src="${escapePrintHeaderHtml(logoSrc)}" alt="شعار الشركة" />
  <div class="company-print-fields">${fieldsHtml}</div>
</header>`;
}

/** حقول رأس دفتر الشحن — موحّدة للطباعة والـ PDF */
export function buildDailyLedgerHeaderFields(input: {
  rowCount: number;
  destination: string;
  driver: string;
  parcelCount: number | string;
}): CompanyPrintHeaderField[] {
  return [
    { label: 'عدد الأسطر', value: input.rowCount },
    { label: 'الوجهة', value: input.destination || '—' },
    { label: 'السائق', value: input.driver || '—' },
    { label: 'عدد الطرود', value: input.parcelCount },
  ];
}
