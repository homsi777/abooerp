import type { Voucher } from '../../pages/finance/voucherTypes';
import { formatCurrency, convertToUsd, getExchangeRatesToUsd } from '../../lib/currency/currency';

type RegisterFilters = {
  searchTerm: string;
  typeFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
};

type Props = {
  vouchers: Voucher[];
  filters: RegisterFilters;
  onFiltersChange: (patch: Partial<RegisterFilters>) => void;
  displayRelatedParty: (voucher: Voucher) => string;
  voucherStatusLabel: (s: string) => string;
  statusColors: Record<string, string>;
  isAgent: boolean;
  canUpdateVoucher: boolean;
  onEdit: (voucher: Voucher) => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
};

export type { RegisterFilters };

export default function VoucherRegisterPanel({
  vouchers,
  filters,
  onFiltersChange,
  displayRelatedParty,
  voucherStatusLabel,
  statusColors,
  isAgent,
  canUpdateVoucher,
  onEdit,
  onExportCsv,
  onExportPdf,
}: Props) {
  const rates = getExchangeRatesToUsd();

  return (
    <div className="space-y-3">
      <div className="card voucher-register-filters">
        <div className="voucher-register-filters-head">
          <strong>سجل السندات</strong>
          <span>{vouchers.length} سند</span>
        </div>
        <div className="voucher-register-filters-grid">
          <input
            type="text"
            placeholder="بحث برقم السند أو الجهة..."
            className="form-input"
            value={filters.searchTerm}
            onChange={(e) => onFiltersChange({ searchTerm: e.target.value })}
          />
          <select
            className="form-select"
            value={filters.typeFilter}
            onChange={(e) => onFiltersChange({ typeFilter: e.target.value })}
          >
            <option value="">كل الأنواع</option>
            <option value="سند قبض">سند قبض</option>
            <option value="سند دفع">سند دفع</option>
          </select>
          <select
            className="form-select"
            value={filters.statusFilter}
            onChange={(e) => onFiltersChange({ statusFilter: e.target.value })}
          >
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="confirmed">مؤكد</option>
            <option value="cancelled">ملغى</option>
          </select>
          <input
            type="date"
            className="form-input"
            value={filters.dateFrom}
            onChange={(e) => onFiltersChange({ dateFrom: e.target.value })}
            title="من تاريخ"
          />
          <input
            type="date"
            className="form-input"
            value={filters.dateTo}
            onChange={(e) => onFiltersChange({ dateTo: e.target.value })}
            title="إلى تاريخ"
          />
          <button type="button" className="toolbar-btn" onClick={onExportCsv}>
            CSV
          </button>
          <button type="button" className="toolbar-btn" onClick={onExportPdf}>
            PDF
          </button>
        </div>
      </div>

      <div className="card overflow-auto">
        <table className="data-grid">
          <thead>
            <tr>
              <th>رقم السند</th>
              <th>النوع</th>
              <th>التاريخ</th>
              <th>الجهة</th>
              <th>المبلغ الأصلي</th>
              <th>USD</th>
              <th>الصندوق</th>
              <th>البيان</th>
              <th>الحالة</th>
              {!isAgent && canUpdateVoucher && <th>إجراء</th>}
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 ? (
              <tr>
                <td colSpan={isAgent || !canUpdateVoucher ? 9 : 10} className="text-center text-slate-500 py-6">
                  لا توجد سندات مطابقة للفلتر
                </td>
              </tr>
            ) : (
              vouchers.map((voucher) => (
                <tr
                  key={`${voucher.kind}-${voucher.id}`}
                  className={
                    voucher.kind === 'receipt'
                      ? 'bg-green-50 hover:bg-green-100/60'
                      : voucher.kind === 'payment'
                        ? 'bg-red-50 hover:bg-red-100/60'
                        : undefined
                  }
                >
                  <td>{voucher.voucherNo}</td>
                  <td>{voucher.voucherType}</td>
                  <td>{voucher.date}</td>
                  <td>{displayRelatedParty(voucher)}</td>
                  <td className="text-left">{formatCurrency(voucher.amount, voucher.currency)}</td>
                  <td className="text-left">
                    {formatCurrency(voucher.amountUsd || convertToUsd(voucher.amount, voucher.currency, rates), 'USD')}
                  </td>
                  <td>{voucher.cashBox}</td>
                  <td>{voucher.description}</td>
                  <td>
                    <span className={`status-badge ${statusColors[voucher.status] ?? 'bg-gray-100 text-gray-800'}`}>
                      {voucherStatusLabel(voucher.status)}
                    </span>
                  </td>
                  {!isAgent && canUpdateVoucher && (
                    <td>
                      <button type="button" className="toolbar-btn" onClick={() => onEdit(voucher)}>
                        تعديل
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
