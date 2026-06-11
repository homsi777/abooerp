import { resolveCompanyLogoPrintSrc } from '../branding/companyBrand';

export type CompanyPrintHeaderField = {
  label: string;
  value: string | number;
};

/** 184px − 25% — حجم اللوغو في رأس الطباعة */
const PRINT_LOGO_SIZE_PX = 138;

function escapePrintHeaderHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderInfoField(field: CompanyPrintHeaderField): string {
  return `<div class="company-print-info-item">
  <span class="company-print-info-label">${escapePrintHeaderHtml(field.label)}</span>
  <span class="company-print-info-value">${escapePrintHeaderHtml(field.value)}</span>
</div>`;
}

/** أنماط رأس الطباعة الموحّد — يُضمَّن داخل &lt;style&gt; لكل مستند */
export function companyPrintHeaderStyles(): string {
  return `
    .company-print-banner {
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 2px solid #1e3a34;
      page-break-inside: avoid;
    }
    .company-print-title {
      font-size: 16px;
      font-weight: 800;
      margin: 0 0 8px;
      padding-bottom: 6px;
      text-align: center;
      color: #10251f;
      border-bottom: 1px solid #dce8e5;
    }
    .company-print-header {
      display: flex;
      align-items: stretch;
      gap: 14px;
      min-height: ${PRINT_LOGO_SIZE_PX}px;
    }
    .company-print-logo-wrap {
      flex: 0 0 ${PRINT_LOGO_SIZE_PX}px;
      width: ${PRINT_LOGO_SIZE_PX}px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .company-print-logo {
      width: ${PRINT_LOGO_SIZE_PX}px;
      height: ${PRINT_LOGO_SIZE_PX}px;
      object-fit: contain;
      display: block;
    }
    .company-print-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      padding: 10px 16px;
      background: linear-gradient(135deg, #f8fafc 0%, #eef4f2 100%);
      border: 1px solid #b8c9c4;
      border-radius: 8px;
    }
    .company-print-info-grid {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 28px;
    }
    .company-print-info-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .company-print-info-label {
      font-size: 11px;
      font-weight: 700;
      color: #475569;
      letter-spacing: 0.02em;
    }
    .company-print-info-value {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.3;
      word-break: break-word;
    }
    .company-print-info--title-only {
      justify-content: center;
    }
    .company-print-report-title {
      margin: 0;
      font-size: 17px;
      font-weight: 800;
      color: #10251f;
      text-align: center;
      line-height: 1.35;
    }
  `;
}

export function renderCompanyPrintHeader(options: {
  fields: CompanyPrintHeaderField[];
  logoSrc?: string;
  title?: string;
}): string {
  const logoSrc = options.logoSrc ?? resolveCompanyLogoPrintSrc();
  const logoHtml = `<div class="company-print-logo-wrap">
  <img class="company-print-logo" src="${escapePrintHeaderHtml(logoSrc)}" alt="شعار الشركة" />
</div>`;

  const titleHtml = options.title
    ? `<p class="company-print-title">${escapePrintHeaderHtml(options.title)}</p>`
    : '';

  if (!options.fields.length) {
    const reportTitle = options.title
      ? `<h1 class="company-print-report-title">${escapePrintHeaderHtml(options.title)}</h1>`
      : '';
    return `<div class="company-print-banner">
  <div class="company-print-header">
    ${logoHtml}
    <div class="company-print-info company-print-info--title-only">${reportTitle}</div>
  </div>
</div>`;
  }

  const fieldsHtml = options.fields.map(renderInfoField).join('');

  return `<div class="company-print-banner">
  ${titleHtml}
  <div class="company-print-header">
    ${logoHtml}
    <div class="company-print-info">
      <div class="company-print-info-grid">${fieldsHtml}</div>
    </div>
  </div>
</div>`;
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
