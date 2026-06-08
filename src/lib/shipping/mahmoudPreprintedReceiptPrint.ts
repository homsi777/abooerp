/**
 * طباعة بيانات فوق ورق A4 مطبوع مسبقاً — نقليات المحمود (4 إيصالات/صفحة).
 * المواقع بالمليمتر من الحافة اليسرى/العليا لكل إيصال.
 */

export type MahmoudReceiptRow = {
  receiptNo: string;
  date: string;
  /** الجهة — الرقة، السخة، إلخ */
  destination: string;
  receiver: string;
  sender: string;
  parcelType: string;
  parcelCount: string;
  collectAmount: string;
  /** دفع مسبق $ → «دفع حلب» */
  prepaidAmount: string;
  /** حوالة → «حوالة» */
  hawalaAmount: string;
  /** أجرة الحوالة → «المبلغ» */
  transferServiceFee: string;
};

type FieldAlign = 'left' | 'center' | 'right';

export type FieldDef = {
  top: number;
  left: number;
  width: number;
  height: number;
  fontSize: number;
  align: FieldAlign;
};

export const MAHMOUD_RECEIPT_FIELD_LABELS: Record<string, string> = {
  receiptNo: 'رقم الإيصال',
  date: 'التاريخ',
  destination: 'الجهة',
  receiver: 'المطلوب من السيد',
  sender: 'المرسل',
  parcelType: 'النوع',
  parcelCount: 'العدد',
  prepaid: 'دفع حلب',
  amount: 'المبلغ',
  hawala: 'حوالة',
};

/** ترتيب الحقول في لوحة المعايرة */
export const MAHMOUD_RECEIPT_FIELD_ORDER = [
  'receiptNo',
  'date',
  'destination',
  'receiver',
  'sender',
  'parcelType',
  'parcelCount',
  'prepaid',
  'amount',
  'hawala',
] as const;

/** ارتفاع كل إيصال — مُقاس من scan الورق */
export const MAHMOUD_RECEIPT_SLOT_HEIGHT_MM = 73.5;

/** ضبط عام للطابعة */
export const MAHMOUD_RECEIPT_PAGE_OFFSET = { topMm: 0, leftMm: 0 };

/** عدد الإيصالات في صفحة A4 */
export const MAHMOUD_RECEIPTS_PER_PAGE = 4;

/**
 * تصحيح اتجاه الطابعة — افتراضياً معطّل.
 * المعايرة على الشاشة = الطباعة. فعّل الخيارات من صفحة المعايرة إن احتجت.
 */
export const MAHMOUD_RECEIPT_PRINT_TRANSFORM = {
  reverseSlotOrder: false,
  mirrorFieldsInSlot: false,
};

export type MahmoudPrintTransform = typeof MAHMOUD_RECEIPT_PRINT_TRANSFORM;

function mirrorFieldTop(field: FieldDef): number {
  return MAHMOUD_RECEIPT_SLOT_HEIGHT_MM - field.top - field.height;
}

function resolveFieldForPrint(field: FieldDef, transform: MahmoudPrintTransform): FieldDef {
  if (!transform.mirrorFieldsInSlot) return field;
  return { ...field, top: mirrorFieldTop(field) };
}

function resolveSlotIndex(slotIndex: number, transform: MahmoudPrintTransform): number {
  if (!transform.reverseSlotOrder) return slotIndex;
  return MAHMOUD_RECEIPTS_PER_PAGE - 1 - slotIndex;
}

/**
 * قالب افتراضي — slot 0.
 * global offset: top=0, left=0 — fontSize مُخفّض بنسبة 25% (10.5/9.75pt)
 */
export const MAHMOUD_RECEIPT_FIELD_LAYOUT: Record<string, FieldDef> = {
  receiptNo: { top: 10, left: 88, width: 20, height: 4, fontSize: 10.5, align: 'center' },
  date: { top: 24, left: 98.5, width: 16, height: 5.5, fontSize: 10.5, align: 'center' },
  destination: { top: 23.5, left: 59, width: 28, height: 5.5, fontSize: 10.5, align: 'center' },
  receiver: { top: 44.5, left: 137.5, width: 92, height: 4.5, fontSize: 10.5, align: 'right' },
  sender: { top: 57, left: 38.5, width: 26, height: 3.8, fontSize: 9.75, align: 'right' },
  parcelType: { top: 57, left: 74, width: 36, height: 3.8, fontSize: 9.75, align: 'right' },
  parcelCount: { top: 57.5, left: 138.5, width: 9, height: 3.8, fontSize: 9.75, align: 'center' },
  prepaid: { top: 58, left: 174, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
  amount: { top: 58, left: 154.5, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
  hawala: { top: 58, left: 194, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
};

export type MahmoudReceiptSlotLayouts = Record<number, Record<string, FieldDef>>;

function cloneFieldLayout(source: Record<string, FieldDef> = MAHMOUD_RECEIPT_FIELD_LAYOUT) {
  return JSON.parse(JSON.stringify(source)) as Record<string, FieldDef>;
}

/** مواقع مُعايرة — slots 0–3 (يونيو 2026) */
export const MAHMOUD_RECEIPT_SLOT_LAYOUTS: MahmoudReceiptSlotLayouts = {
  0: {
    receiptNo: { top: 10, left: 88, width: 20, height: 4, fontSize: 10.5, align: 'center' },
    date: { top: 24, left: 98.5, width: 16, height: 5.5, fontSize: 10.5, align: 'center' },
    destination: { top: 23.5, left: 59, width: 28, height: 5.5, fontSize: 10.5, align: 'center' },
    receiver: { top: 44.5, left: 137.5, width: 92, height: 4.5, fontSize: 10.5, align: 'right' },
    sender: { top: 57, left: 38.5, width: 26, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelType: { top: 57, left: 74, width: 36, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelCount: { top: 57.5, left: 138.5, width: 9, height: 3.8, fontSize: 9.75, align: 'center' },
    prepaid: { top: 58, left: 174, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    amount: { top: 58, left: 154.5, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    hawala: { top: 58, left: 194, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
  },
  1: {
    receiptNo: { top: 8, left: 88, width: 20, height: 4, fontSize: 10.5, align: 'center' },
    date: { top: 21, left: 98.5, width: 16, height: 5.5, fontSize: 10.5, align: 'center' },
    destination: { top: 23.5, left: 59, width: 28, height: 5.5, fontSize: 10.5, align: 'center' },
    receiver: { top: 41, left: 137.5, width: 92, height: 4.5, fontSize: 10.5, align: 'right' },
    sender: { top: 55.5, left: 38.5, width: 26, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelType: { top: 55, left: 74, width: 36, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelCount: { top: 55.5, left: 138.5, width: 9, height: 3.8, fontSize: 9.75, align: 'center' },
    prepaid: { top: 56, left: 174, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    amount: { top: 55.5, left: 154.5, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    hawala: { top: 55.5, left: 194, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
  },
  2: {
    receiptNo: { top: 8.5, left: 88, width: 20, height: 4, fontSize: 10.5, align: 'center' },
    date: { top: 21.5, left: 98.5, width: 16, height: 5.5, fontSize: 10.5, align: 'center' },
    destination: { top: 21.5, left: 59, width: 28, height: 5.5, fontSize: 10.5, align: 'center' },
    receiver: { top: 40.5, left: 137.5, width: 92, height: 4.5, fontSize: 10.5, align: 'right' },
    sender: { top: 54, left: 38.5, width: 26, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelType: { top: 54, left: 74, width: 36, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelCount: { top: 54, left: 138.5, width: 9, height: 3.8, fontSize: 9.75, align: 'center' },
    prepaid: { top: 54.5, left: 174, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    amount: { top: 54.5, left: 154.5, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    hawala: { top: 54, left: 192, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
  },
  3: {
    receiptNo: { top: 5, left: 88, width: 20, height: 4, fontSize: 10.5, align: 'center' },
    date: { top: 18.5, left: 98.5, width: 16, height: 5.5, fontSize: 10.5, align: 'center' },
    destination: { top: 18, left: 59, width: 28, height: 5.5, fontSize: 10.5, align: 'center' },
    receiver: { top: 37.5, left: 137.5, width: 92, height: 4.5, fontSize: 10.5, align: 'right' },
    sender: { top: 53, left: 33, width: 26, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelType: { top: 52.5, left: 74, width: 36, height: 3.8, fontSize: 9.75, align: 'right' },
    parcelCount: { top: 52, left: 138.5, width: 9, height: 3.8, fontSize: 9.75, align: 'center' },
    prepaid: { top: 52, left: 174, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    amount: { top: 52, left: 154.5, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
    hawala: { top: 52, left: 191, width: 10, height: 3.8, fontSize: 9.75, align: 'center' },
  },
};

export function createDefaultSlotLayouts(): MahmoudReceiptSlotLayouts {
  return JSON.parse(JSON.stringify(MAHMOUD_RECEIPT_SLOT_LAYOUTS)) as MahmoudReceiptSlotLayouts;
}

function getSlotLayout(
  slotIndex: number,
  slotLayouts: MahmoudReceiptSlotLayouts = MAHMOUD_RECEIPT_SLOT_LAYOUTS,
): Record<string, FieldDef> {
  return slotLayouts[slotIndex] ?? slotLayouts[0] ?? MAHMOUD_RECEIPT_FIELD_LAYOUT;
}

export const MAHMOUD_RECEIPT_DUMMY_ROWS: MahmoudReceiptRow[] = [
  {
    receiptNo: '9365',
    date: '06-06-26',
    destination: 'الرقة',
    receiver: 'محمد أحمد',
    sender: 'علي حسن',
    parcelType: 'صندوق خشب',
    parcelCount: '1',
    collectAmount: '45',
    prepaidAmount: '5',
    hawalaAmount: '100',
    transferServiceFee: '3',
  },
  {
    receiptNo: '9302',
    date: '06-06-26',
    destination: 'حلب',
    receiver: 'فاطمة يوسف',
    sender: 'خالد عمر',
    parcelType: 'طرد خردة',
    parcelCount: '2',
    collectAmount: '30',
    prepaidAmount: '',
    hawalaAmount: '250',
    transferServiceFee: '5',
  },
  {
    receiptNo: '9400',
    date: '06-06-26',
    destination: 'السخة',
    receiver: 'سارة محمود',
    sender: 'أحمد ناصر',
    parcelType: 'كيس',
    parcelCount: '10',
    collectAmount: '',
    prepaidAmount: '20',
    hawalaAmount: '',
    transferServiceFee: '',
  },
  {
    receiptNo: '9411',
    date: '06-06-26',
    destination: 'دمشق',
    receiver: 'حسين كريم',
    sender: 'مكتب الشحن',
    parcelType: 'صندوق',
    parcelCount: '3',
    collectAmount: '18',
    prepaidAmount: '8',
    hawalaAmount: '75',
    transferServiceFee: '2',
  },
];

/** تحويل سطر الدفتر إلى صف إيصال للطباعة على الورق المطبوع */
export function formatMahmoudReceiptDate(isoDate: string): string {
  const part = String(isoDate ?? '').split('T')[0];
  const [y, m, d] = part.split('-');
  if (!y || !m || !d) return part || '';
  return `${d}-${m}-${y.slice(-2)}`;
}

function formatReceiptMoneySum(...values: Array<string | number | null | undefined>): string {
  const total = values.reduce((sum, value) => {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);
  if (total <= 0) return '';
  return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(2)));
}

export function mapRemoteLedgerRowToMahmoudReceipt(row: {
  receipt_no: string | null;
  ledger_date: string;
  destination: string;
  receiver_name: string;
  sender_name: string;
  parcel_type: string;
  parcel_count: number | null;
  collect_amount_usd: string;
  fees_amount_usd?: string;
  prepaid_amount_usd: string;
  hawala_amount_usd: string;
  transfer_service_fee_usd: string;
}): MahmoudReceiptRow {
  return {
    receiptNo: row.receipt_no ?? '',
    date: formatMahmoudReceiptDate(row.ledger_date),
    destination: row.destination ?? '',
    receiver: row.receiver_name ?? '',
    sender: row.sender_name ?? '',
    parcelType: row.parcel_type ?? '',
    parcelCount: row.parcel_count == null ? '' : String(row.parcel_count),
    collectAmount: formatReceiptMoneySum(row.collect_amount_usd, row.fees_amount_usd),
    prepaidAmount: String(row.prepaid_amount_usd ?? ''),
    hawalaAmount: String(row.hawala_amount_usd ?? ''),
    transferServiceFee: String(row.transfer_service_fee_usd ?? ''),
  };
}

export function mapLedgerRowToMahmoudReceipt(
  row: {
    receiptNo: string;
    destination: string;
    receiver: string;
    sender: string;
    parcelType: string;
    parcelCount: string;
    collectAmount: string;
    prepaidAmount: string;
    receiverCollect: string;
    transferServiceFee: string;
  },
  dateLabel = '',
): MahmoudReceiptRow {
  return {
    receiptNo: row.receiptNo,
    date: dateLabel ? formatMahmoudReceiptDate(dateLabel) : '',
    destination: row.destination,
    receiver: row.receiver,
    sender: row.sender,
    parcelType: row.parcelType,
    parcelCount: row.parcelCount,
    collectAmount: row.collectAmount,
    prepaidAmount: row.prepaidAmount,
    hawalaAmount: row.receiverCollect,
    transferServiceFee: row.transferServiceFee,
  };
}

function escapeHtml(value: string) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fieldStyle(field: FieldDef) {
  return [
    `top:${field.top}mm`,
    `left:${field.left}mm`,
    `width:${field.width}mm`,
    `height:${field.height}mm`,
    `font-size:${field.fontSize}pt`,
  ].join(';');
}

function fieldDataAttrs(slotIndex: number, key: string, field: FieldDef) {
  return [
    `data-slot-index="${slotIndex}"`,
    `data-field="${key}"`,
    `data-base-top="${field.top}"`,
    `data-base-left="${field.left}"`,
    `data-base-width="${field.width}"`,
    `data-base-height="${field.height}"`,
    `data-base-font-size="${field.fontSize}"`,
    `data-base-align="${field.align}"`,
  ].join(' ');
}

function renderField(
  slotIndex: number,
  key: string,
  value: string,
  field: FieldDef,
  debug: boolean,
  transform?: MahmoudPrintTransform | null,
) {
  const resolved = transform ? resolveFieldForPrint(field, transform) : field;
  const debugClass = debug ? ' debug-field' : '';
  return `<div class="field align-${resolved.align}${debugClass}" ${fieldDataAttrs(slotIndex, key, field)} style="${fieldStyle(resolved)}">${escapeHtml(value)}</div>`;
}

function renderReceiptSlot(
  row: MahmoudReceiptRow,
  slotIndex: number,
  debug: boolean,
  slotLayouts: MahmoudReceiptSlotLayouts,
  transform?: MahmoudPrintTransform | null,
) {
  const visualIndex = transform ? resolveSlotIndex(slotIndex, transform) : slotIndex;
  const slotTop = visualIndex * MAHMOUD_RECEIPT_SLOT_HEIGHT_MM + MAHMOUD_RECEIPT_PAGE_OFFSET.topMm;
  const L = getSlotLayout(slotIndex, slotLayouts);

  return `<div class="receipt-slot" data-slot-index="${slotIndex}" data-base-top="${slotTop}" style="top:${slotTop}mm;height:${MAHMOUD_RECEIPT_SLOT_HEIGHT_MM}mm">
  ${renderField(slotIndex, 'receiptNo', row.receiptNo, L.receiptNo, debug, transform)}
  ${renderField(slotIndex, 'date', row.date, L.date, debug, transform)}
  ${renderField(slotIndex, 'destination', row.destination, L.destination, debug, transform)}
  ${renderField(slotIndex, 'receiver', row.receiver, L.receiver, debug, transform)}
  ${renderField(slotIndex, 'hawala', row.hawalaAmount, L.hawala, debug, transform)}
  ${renderField(slotIndex, 'amount', row.collectAmount, L.amount, debug, transform)}
  ${renderField(slotIndex, 'prepaid', row.prepaidAmount, L.prepaid, debug, transform)}
  ${renderField(slotIndex, 'parcelCount', row.parcelCount, L.parcelCount, debug, transform)}
  ${renderField(slotIndex, 'parcelType', row.parcelType, L.parcelType, debug, transform)}
  ${renderField(slotIndex, 'sender', row.sender, L.sender, debug, transform)}
</div>`;
}

function renderPage(
  rows: MahmoudReceiptRow[],
  pageIndex: number,
  debug: boolean,
  overlay: boolean,
  slotLayouts: MahmoudReceiptSlotLayouts,
  transform?: MahmoudPrintTransform | null,
) {
  const body = rows
    .map((row, i) => renderReceiptSlot(row, i, debug, slotLayouts, transform))
    .join('\n');
  const overlayClass = overlay ? ' sheet-overlay' : '';
  return `<section class="sheet${overlayClass}" data-page="${pageIndex + 1}">${body}</section>`;
}

function buildFieldCalRow(slotIndex: number, key: string, field: FieldDef) {
  const label = MAHMOUD_RECEIPT_FIELD_LABELS[key] ?? key;
  return `<div class="field-cal-row" data-cal-slot="${slotIndex}" data-cal-key="${key}">
    <div class="field-cal-title">${escapeHtml(label)}</div>
    <div class="field-cal-inputs">
      <label>أعلى<input type="number" step="0.5" data-prop="top" value="${field.top}" /></label>
      <label>يسار<input type="number" step="0.5" data-prop="left" value="${field.left}" /></label>
      <label>عرض<input type="number" step="0.5" data-prop="width" value="${field.width}" /></label>
      <label>ارتفاع<input type="number" step="0.5" data-prop="height" value="${field.height}" /></label>
      <label>خط pt<input type="number" step="0.5" min="6" max="24" data-prop="fontSize" value="${field.fontSize}" /></label>
      <label>محاذاة
        <select data-prop="align">
          <option value="right"${field.align === 'right' ? ' selected' : ''}>يمين</option>
          <option value="center"${field.align === 'center' ? ' selected' : ''}>وسط</option>
          <option value="left"${field.align === 'left' ? ' selected' : ''}>يسار</option>
        </select>
      </label>
    </div>
  </div>`;
}

function buildSlotCalibrationPanels() {
  const tabs = Array.from({ length: MAHMOUD_RECEIPTS_PER_PAGE }, (_, slotIndex) => {
    const n = slotIndex + 1;
    const active = slotIndex === 0 ? ' active' : '';
    return `<button type="button" class="slot-tab${active}" data-slot-tab="${slotIndex}">إيصال ${n}</button>`;
  }).join('');

  const panels = Array.from({ length: MAHMOUD_RECEIPTS_PER_PAGE }, (_, slotIndex) => {
    const layout = getSlotLayout(slotIndex);
    const rows = MAHMOUD_RECEIPT_FIELD_ORDER.map((key) =>
      buildFieldCalRow(slotIndex, key, layout[key]),
    ).join('\n');
    const hidden = slotIndex === 0 ? '' : ' hidden';
    return `<div class="slot-cal-panel"${hidden} data-slot-panel="${slotIndex}">${rows}</div>`;
  }).join('\n');

  return `<div class="slot-tabs">${tabs}</div>
    <div class="slot-cal-actions">
      <button type="button" id="btnCopySlotToAll">نسخ هذا الإيصال للأربعة</button>
    </div>
    <div class="field-cal-grid">${panels}</div>`;
}

function buildCalibrationScript() {
  const defaultSlotLayouts = createDefaultSlotLayouts();
  const slotLayoutsJson = JSON.stringify(defaultSlotLayouts);
  return `<script>
    const DEFAULT_SLOT_LAYOUTS = ${slotLayoutsJson};
    const SLOT_H = ${MAHMOUD_RECEIPT_SLOT_HEIGHT_MM};
    const RECEIPTS_PER_PAGE = ${MAHMOUD_RECEIPTS_PER_PAGE};
    let slotLayouts = JSON.parse(JSON.stringify(DEFAULT_SLOT_LAYOUTS));
    let activeSlot = 0;
    let globalTop = 0;
    let globalLeft = 0;

    function num(id, fallback = 0) {
      const el = document.getElementById(id);
      return Number(el && el.value !== '' ? el.value : fallback);
    }

    function getTransformFlags() {
      return {
        reverseSlotOrder: Boolean(document.getElementById('flipSlots') && document.getElementById('flipSlots').checked),
        mirrorFieldsInSlot: Boolean(document.getElementById('flipFields') && document.getElementById('flipFields').checked),
      };
    }

    function readFieldFromPanel(slotIndex, key) {
      const row = document.querySelector('.field-cal-row[data-cal-slot="' + slotIndex + '"][data-cal-key="' + key + '"]');
      const fallback = slotLayouts[slotIndex][key];
      if (!row) return fallback;
      const read = (prop) => {
        const input = row.querySelector('[data-prop="' + prop + '"]');
        if (!input) return fallback[prop];
        if (prop === 'align') return input.value;
        return Number(input.value);
      };
      return {
        top: read('top'),
        left: read('left'),
        width: read('width'),
        height: read('height'),
        fontSize: read('fontSize'),
        align: read('align'),
      };
    }

    function readAllSlotLayouts() {
      for (let s = 0; s < RECEIPTS_PER_PAGE; s += 1) {
        MAHMOUD_FIELD_ORDER.forEach((key) => {
          slotLayouts[s][key] = readFieldFromPanel(s, key);
        });
      }
    }

    function writeFieldToPanel(slotIndex, key, def) {
      const row = document.querySelector('.field-cal-row[data-cal-slot="' + slotIndex + '"][data-cal-key="' + key + '"]');
      if (!row || !def) return;
      row.querySelector('[data-prop="top"]').value = def.top;
      row.querySelector('[data-prop="left"]').value = def.left;
      row.querySelector('[data-prop="width"]').value = def.width;
      row.querySelector('[data-prop="height"]').value = def.height;
      row.querySelector('[data-prop="fontSize"]').value = def.fontSize;
      row.querySelector('[data-prop="align"]').value = def.align;
    }

    function effectiveTop(def) {
      const t = getTransformFlags();
      if (!t.mirrorFieldsInSlot) return def.top;
      return SLOT_H - def.top - def.height;
    }

    function effectiveSlotTop(slotIndex) {
      const t = getTransformFlags();
      const visualIndex = t.reverseSlotOrder ? RECEIPTS_PER_PAGE - 1 - slotIndex : slotIndex;
      return visualIndex * SLOT_H + globalTop;
    }

    function applyFieldStyle(el, def) {
      el.style.top = effectiveTop(def) + 'mm';
      el.style.left = (def.left + globalLeft).toFixed(2) + 'mm';
      el.style.width = def.width + 'mm';
      el.style.height = def.height + 'mm';
      el.style.fontSize = def.fontSize + 'pt';
      el.classList.remove('align-left', 'align-center', 'align-right');
      el.classList.add('align-' + def.align);
    }

    function setActiveSlot(slotIndex) {
      activeSlot = slotIndex;
      document.querySelectorAll('.slot-tab').forEach((tab) => {
        tab.classList.toggle('active', Number(tab.getAttribute('data-slot-tab')) === slotIndex);
      });
      document.querySelectorAll('.slot-cal-panel').forEach((panel) => {
        panel.hidden = Number(panel.getAttribute('data-slot-panel')) !== slotIndex;
      });
      document.querySelectorAll('.receipt-slot').forEach((slot) => {
        slot.classList.toggle('slot-active', Number(slot.getAttribute('data-slot-index')) === slotIndex);
      });
    }

    function applyAll() {
      readAllSlotLayouts();
      globalTop = num('offTop', 0);
      globalLeft = num('offLeft', 0);

      document.querySelectorAll('.receipt-slot').forEach((slot) => {
        const slotIndex = Number(slot.getAttribute('data-slot-index') || 0);
        slot.style.top = effectiveSlotTop(slotIndex).toFixed(2) + 'mm';
        slot.classList.toggle('slot-active', slotIndex === activeSlot);
      });

      document.querySelectorAll('.field[data-field]').forEach((el) => {
        const key = el.getAttribute('data-field');
        const slotIndex = Number(el.getAttribute('data-slot-index') || 0);
        const def = slotLayouts[slotIndex] && slotLayouts[slotIndex][key];
        if (!def) return;
        applyFieldStyle(el, def);
      });

      document.getElementById('exportOut').textContent = exportLayoutCode();
    }

    function exportLayoutCode() {
      const blocks = [];
      for (let s = 0; s < RECEIPTS_PER_PAGE; s += 1) {
        const lines = MAHMOUD_FIELD_ORDER.map((key) => {
          const f = slotLayouts[s][key];
          return '    ' + key + ': { top: ' + f.top + ', left: ' + f.left + ', width: ' + f.width + ', height: ' + f.height + ', fontSize: ' + f.fontSize + ", align: '" + f.align + "' },";
        });
        blocks.push('  ' + s + ': {\\n' + lines.join('\\n') + '\\n  },');
      }
      return 'export const MAHMOUD_RECEIPT_SLOT_LAYOUTS = {\\n' + blocks.join('\\n') + '\\n};\\n\\n// global offset: top=' + globalTop + ', left=' + globalLeft;
    }

    function resetLayout() {
      slotLayouts = JSON.parse(JSON.stringify(DEFAULT_SLOT_LAYOUTS));
      document.getElementById('offTop').value = '0';
      document.getElementById('offLeft').value = '0';
      for (let s = 0; s < RECEIPTS_PER_PAGE; s += 1) {
        MAHMOUD_FIELD_ORDER.forEach((key) => {
          writeFieldToPanel(s, key, slotLayouts[s][key]);
        });
      }
      applyAll();
    }

    function copyActiveSlotToAll() {
      readAllSlotLayouts();
      const source = JSON.parse(JSON.stringify(slotLayouts[activeSlot]));
      for (let s = 0; s < RECEIPTS_PER_PAGE; s += 1) {
        slotLayouts[s] = JSON.parse(JSON.stringify(source));
        MAHMOUD_FIELD_ORDER.forEach((key) => {
          writeFieldToPanel(s, key, slotLayouts[s][key]);
        });
      }
      applyAll();
    }

    function copyExport() {
      const text = document.getElementById('exportOut').textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        alert('تم نسخ إعدادات الإيصالات الأربعة');
      }).catch(() => {
        prompt('انسخ هذا النص:', text);
      });
    }

    const MAHMOUD_FIELD_ORDER = ${JSON.stringify([...MAHMOUD_RECEIPT_FIELD_ORDER])};

    document.querySelectorAll('.field-cal-row input, .field-cal-row select').forEach((el) => {
      el.addEventListener('input', applyAll);
      el.addEventListener('change', applyAll);
    });
    ['offTop', 'offLeft'].forEach((id) => {
      document.getElementById(id).addEventListener('input', applyAll);
      document.getElementById(id).addEventListener('change', applyAll);
    });
    document.querySelectorAll('.slot-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        setActiveSlot(Number(tab.getAttribute('data-slot-tab') || 0));
      });
    });
    document.getElementById('btnReset').addEventListener('click', resetLayout);
    document.getElementById('btnCopy').addEventListener('click', copyExport);
    document.getElementById('btnCopySlotToAll').addEventListener('click', copyActiveSlotToAll);
    ['flipSlots', 'flipFields'].forEach((id) => {
      document.getElementById(id).addEventListener('change', applyAll);
    });
    setActiveSlot(0);
    applyAll();
  </script>`;
}

export function buildMahmoudPreprintedReceiptHtml(
  rows: MahmoudReceiptRow[],
  options?: {
    debug?: boolean;
    overlay?: boolean;
    title?: string;
    slotLayouts?: MahmoudReceiptSlotLayouts;
    /** true = عكس عمودي للطباعة على Canon */
    applyPrintTransform?: boolean;
  },
) {
  const debug = Boolean(options?.debug);
  const overlay = options?.overlay ?? debug;
  const applyPrintTransform = options?.applyPrintTransform ?? false;
  const transform = applyPrintTransform ? MAHMOUD_RECEIPT_PRINT_TRANSFORM : null;
  const slotLayouts = options?.slotLayouts ?? MAHMOUD_RECEIPT_SLOT_LAYOUTS;
  const title = options?.title ?? 'طباعة إيصالات — نقليات المحمود';
  const pages: string[] = [];
  for (let i = 0; i < rows.length; i += 4) {
    pages.push(renderPage(rows.slice(i, i + 4), pages.length, debug, overlay, slotLayouts, transform));
  }
  if (!pages.length) pages.push(renderPage([], 0, debug, overlay, slotLayouts, transform));

  const calibrationPanel = debug
    ? `<aside class="calibration-panel no-print">
    <strong>4 إيصالات × 10 حقول — تحكم منفصل</strong>
    <div class="global-offset">
      <label>↓ <input id="offTop" type="number" step="0.5" value="0" title="إزاحة عامة أعلى/أسفل" /></label>
      <label>→ <input id="offLeft" type="number" step="0.5" value="0" title="إزاحة عامة يمين/يسار" /></label>
      <button type="button" id="btnReset">إعادة</button>
      <button type="button" id="btnCopy">نسخ الكل</button>
    </div>
    <div class="flip-options">
      <label><input id="flipSlots" type="checkbox" /> عكس ترتيب الإيصالات (4→1)</label>
      <label><input id="flipFields" type="checkbox" /> عكس عمودي داخل الإيصال</label>
    </div>
    ${buildSlotCalibrationPanels()}
    <pre id="exportOut" class="export-out"></pre>
  </aside>`
    : '';

  const bodyContent = debug
    ? `<div class="calibration-workspace no-print">
  ${calibrationPanel}
  <div class="preview-column">
    <div class="toolbar">
      <button type="button" onclick="window.print()">طباعة على Canon</button>
    </div>
    <div class="preview-scroll">${pages.join('\n')}</div>
  </div>
</div>`
    : pages.join('\n');

  return `<!doctype html>
<html lang="ar">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: 210mm 297mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      min-height: 100vh;
      background: #fff;
      color: #000;
      font-family: Tahoma, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .screen-hint {
      padding: 8px 14px;
      background: #fff8e6;
      border-bottom: 1px solid #e6c200;
      font-size: 12px;
      line-height: 1.5;
    }
    .calibration-workspace {
      display: flex;
      flex-direction: row;
      direction: rtl;
      align-items: stretch;
      gap: 0;
      height: calc(100vh - 52px);
      overflow: hidden;
    }
    .calibration-panel {
      flex: 0 0 380px;
      width: 380px;
      padding: 10px 12px 12px;
      background: #eef4fa;
      border-inline-start: 2px solid #b8c9da;
      font-size: 12px;
      direction: rtl;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .preview-column {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      background: #d8dee6;
      direction: ltr;
    }
    .preview-scroll {
      flex: 1;
      overflow: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .toolbar {
      flex: 0 0 auto;
      padding: 8px 12px;
      text-align: center;
      background: #c5cdd8;
      border-bottom: 1px solid #aeb8c4;
    }
    .toolbar button {
      padding: 7px 16px;
      font-family: inherit;
      cursor: pointer;
    }
    .print-only { display: none; }
    @media print {
      html, body { width: 210mm; min-height: auto; background: #fff; }
      .screen-hint, .calibration-panel, .toolbar { display: none !important; }
      .calibration-workspace {
        display: block !important;
        height: auto !important;
        overflow: visible !important;
      }
      .preview-column, .preview-scroll {
        display: block !important;
        padding: 0 !important;
        background: none !important;
        overflow: visible !important;
      }
      .sheet {
        box-shadow: none !important;
        margin: 0 !important;
      }
      .sheet-overlay { background-image: none !important; }
      .debug-field { outline: none !important; background: transparent !important; }
      .debug-field::after { display: none !important; }
    }
    .sheet {
      position: relative;
      width: 210mm;
      height: 297mm;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
      margin: 0;
      flex-shrink: 0;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
      background: #fff;
    }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .sheet-overlay {
      background-image: url('mahmoud-form-reference.png');
      background-size: 210mm 297mm;
      background-repeat: no-repeat;
      background-position: top left;
    }
    .receipt-slot {
      position: absolute;
      left: ${MAHMOUD_RECEIPT_PAGE_OFFSET.leftMm}mm;
      width: 210mm;
      overflow: visible;
    }
    .receipt-slot.slot-active {
      outline: 0.35mm solid #0066cc;
      outline-offset: -0.35mm;
      z-index: 2;
    }
    .receipt-slot:not(.slot-active) .debug-field {
      opacity: 0.28;
    }
    .field {
      position: absolute;
      display: flex;
      align-items: center;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      direction: rtl;
      background: transparent;
      font-weight: 600;
    }
    .field.align-center { justify-content: center; text-align: center; }
    .field.align-right { justify-content: flex-end; text-align: right; padding-inline-end: 0.4mm; }
    .field.align-left { justify-content: flex-start; text-align: left; padding-inline-start: 0.4mm; }
    .debug-field {
      outline: 0.12mm dashed rgba(200, 0, 0, 0.7);
      background: rgba(255, 230, 0, 0.12);
    }
    .debug-field::after {
      content: 'S' attr(data-slot-index) ' · ' attr(data-field);
      position: absolute;
      top: -2.8mm;
      left: 0;
      font-size: 5.5pt;
      font-weight: 400;
      color: #b00;
      direction: ltr;
      pointer-events: none;
    }
    .global-offset {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 8px 0 10px;
    }
    .global-offset label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
    }
    .global-offset input { width: 52px; font-family: inherit; }
    .global-offset button {
      padding: 4px 8px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .flip-options {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 10px;
      padding: 8px;
      background: #fff8e6;
      border: 1px solid #e6c200;
      border-radius: 4px;
      font-size: 11px;
    }
    .flip-options label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .slot-tabs {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      margin-bottom: 8px;
    }
    .slot-tab {
      padding: 6px 4px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      border: 1px solid #b8c9da;
      background: #fff;
      border-radius: 4px;
    }
    .slot-tab.active {
      background: #0066cc;
      color: #fff;
      border-color: #0055aa;
      font-weight: 700;
    }
    .slot-cal-actions {
      margin-bottom: 8px;
    }
    .slot-cal-actions button {
      width: 100%;
      padding: 5px 8px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .slot-cal-panel[hidden] { display: none; }
    .field-cal-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border: 1px solid #c5d0dc;
      background: #fff;
      padding: 6px;
      border-radius: 4px;
    }
    .field-cal-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px 4px;
      border-bottom: 1px solid #e8edf2;
    }
    .field-cal-row:last-child { border-bottom: none; }
    .field-cal-title { font-weight: 700; font-size: 11px; }
    .field-cal-title code { font-size: 9px; color: #666; font-weight: 400; }
    .field-cal-inputs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px 6px;
    }
    .field-cal-inputs label {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 9px;
      color: #445;
    }
    .field-cal-inputs input,
    .field-cal-inputs select {
      width: 100%;
      font-family: inherit;
      font-size: 11px;
      padding: 2px 3px;
    }
    .export-out {
      margin-top: 8px;
      padding: 6px;
      background: #1e293b;
      color: #e2e8f0;
      font-size: 9px;
      direction: ltr;
      text-align: left;
      max-height: 140px;
      overflow: auto;
      white-space: pre-wrap;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="screen-hint no-print">
    <strong>معايرة إيصالات المحمود</strong> — اختر «إيصال 1–4» ثم اضبط كل حقل من الـ 9 على حدة. ما تراه = ما يُطبع.
  </div>
  ${bodyContent}
  ${debug ? buildCalibrationScript() : ''}
</body>
</html>`;
}

export function openMahmoudReceiptPrintPreview(
  rows: MahmoudReceiptRow[],
  options?: { debug?: boolean; overlay?: boolean; autoPrint?: boolean },
) {
  const html = buildMahmoudPreprintedReceiptHtml(rows, {
    debug: options?.debug,
    overlay: options?.overlay,
    applyPrintTransform: false,
  });
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!doc || !win) {
    document.body.removeChild(iframe);
    throw new Error('تعذر تهيئة معاينة الطباعة');
  }
  doc.open();
  doc.write(html);
  doc.close();
  win.focus();
  window.setTimeout(() => {
    if (options?.autoPrint) win.print();
    window.setTimeout(() => iframe.remove(), 1200);
  }, options?.autoPrint ? 600 : 0);
}
