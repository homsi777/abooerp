import { z } from 'zod';
import { TerminologyRepository } from '../repositories/terminologyRepository.js';
const defaultTerminology = {
    customer: 'العميل',
    agent: 'الوكيل',
    branch: 'الفرع',
    city: 'المدينة',
    governorate: 'المحافظة',
    shipment: 'الشحنة',
    manifest: 'بيان التحميل (Manifest)',
    delivery: 'التسليم',
    sender: 'المرسل',
    receiver: 'المستلم',
    goodsType: 'نوع البضاعة',
    piecesCount: 'عدد القطع',
    trackingNumber: 'رقم التتبع',
    shippingLabel: 'لصاقة الشحن',
    vehicle: 'المركبة',
    driver: 'السائق',
    trip: 'الرحلة',
    route: 'خط السير',
    load: 'التحميل',
    expense: 'المصروف',
    salary: 'الراتب',
    advance: 'السلفة',
    cashBox: 'الصندوق',
    voucher: 'السند',
    receiptVoucher: 'سند القبض',
    paymentVoucher: 'سند الدفع',
    dailyJournal: 'دفتر اليومية',
    record: 'القيد المحاسبي',
    commission: 'العمولة',
    settlement: 'التسوية',
    debit: 'مدين',
    credit: 'دائن',
    balance: 'الرصيد',
    report: 'التقرير',
    statement: 'كشف الحساب',
    summaryCard: 'بطاقة الملخص',
    kpi: 'مؤشر الأداء',
    printPreview: 'معاينة الطباعة',
    export: 'التصدير',
    filters: 'الفلاتر',
    user: 'المستخدم',
    role: 'الدور',
    permission: 'الصلاحية',
    activityLog: 'سجل النشاط',
    auditLog: 'سجل التدقيق',
    backup: 'النسخ الاحتياطي',
    restore: 'الاستعادة',
    settings: 'الإعدادات',
};
const payloadSchema = z.record(z.string(), z.string().max(120));
export class TerminologyService {
    repository;
    constructor(repository = new TerminologyRepository()) {
        this.repository = repository;
    }
    async get(companyId) {
        const row = await this.repository.getByCompany(companyId);
        return { ...defaultTerminology, ...(row?.terms ?? {}) };
    }
    async update(companyId, payload, userId) {
        const parsed = payloadSchema.parse(payload);
        const sanitized = { ...defaultTerminology };
        for (const [key, value] of Object.entries(parsed)) {
            if (!(key in defaultTerminology))
                continue;
            sanitized[key] = value.trim() || defaultTerminology[key];
        }
        const row = await this.repository.upsert(companyId, sanitized, userId);
        return { ...defaultTerminology, ...(row.terms ?? {}) };
    }
}
