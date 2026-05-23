import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Building2, Phone, MapPin, Tag, UserCheck } from 'lucide-react';
import { customersGateway, type CustomerRecord } from '../../lib/api/customersGateway';
import { useToast } from '../../components/Toast';

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-gray-500 text-sm w-36 shrink-0">{label}</span>
      <span className="text-gray-900 text-sm font-medium">{value}</span>
    </div>
  );
}

export default function CustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    customersGateway
      .get(id)
      .then(setCustomer)
      .catch((err) => showToast(err instanceof Error ? err.message : 'تعذر تحميل بيانات العميل', 'error'))
      .finally(() => setLoading(false));
  }, [id, showToast]);

  if (loading) {
    return (
      <div className="page-container" dir="rtl">
        <p className="text-gray-500 py-10 text-center">جاري التحميل...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="page-container" dir="rtl">
        <p className="text-red-600 py-10 text-center">لم يتم العثور على العميل</p>
        <div className="text-center">
          <Link to="/customers" className="btn btn-secondary">عودة للعملاء</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link to="/customers" className="hover:text-blue-600">العملاء</Link>
        <ArrowRight size={14} />
        <span className="text-gray-900 font-medium">{customer.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700">
            <Building2 size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{customer.name}</h1>
              {customer.is_account_customer && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 font-semibold">
                  <UserCheck size={11} /> عميل حسابي
                </span>
              )}
            </div>
            {customer.company_name && (
              <p className="text-gray-500 text-sm">{customer.company_name}</p>
            )}
            <div className="flex gap-3 mt-1 text-xs text-gray-400">
              <span className="font-mono">{customer.code}</span>
              <span>{customer.customer_type === 'COMPANY' ? 'شركة / مؤسسة' : 'فرد'}</span>
              <span className={customer.status === 'active' ? 'text-green-600' : 'text-gray-400'}>
                {customer.status === 'active' ? '● نشط' : '○ متوقف'}
              </span>
            </div>
          </div>
        </div>
        <Link to={`/customers`} className="btn btn-secondary text-sm">
          <ArrowRight size={14} /> عودة
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact info */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Phone size={16} className="text-blue-500" /> بيانات التواصل
          </h2>
          <InfoRow label="الهاتف" value={customer.phone} />
          <InfoRow label="هاتف إضافي" value={customer.second_phone} />
        </div>

        {/* Address */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-blue-500" /> العنوان
          </h2>
          <InfoRow label="المحافظة / المدينة" value={customer.city} />
          <InfoRow label="المنطقة" value={customer.area} />
          <InfoRow label="العنوان التفصيلي" value={customer.address} />
        </div>

        {/* Financial info */}
        {customer.is_account_customer && (
          <div className="card p-5 border-emerald-200 bg-emerald-50/40">
            <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <UserCheck size={16} className="text-emerald-600" /> البيانات الحسابية
            </h2>
            <InfoRow label="حد الائتمان" value={customer.credit_limit > 0 ? String(customer.credit_limit) : 'غير محدد'} />
            <InfoRow label="العملة الافتراضية" value={customer.default_currency_code} />
            <div className="mt-3 flex gap-2">
              <Link
                to={`/finance/account-statement?partyType=customer&partyId=${customer.id}`}
                className="btn btn-secondary text-xs"
              >
                كشف الحساب
              </Link>
              <Link
                to={`/finance/debit-credit?partyType=customer&partyId=${customer.id}`}
                className="btn btn-secondary text-xs"
              >
                الدائن والمدين
              </Link>
            </div>
          </div>
        )}

        {/* Branch / agent */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Tag size={16} className="text-blue-500" /> الارتباطات التشغيلية
          </h2>
          <InfoRow label="الفرع" value={customer.branch_name} />
          <InfoRow label="الوكيل" value={customer.agent_name} />
          <InfoRow label="الرقم الضريبي" value={customer.tax_number} />
        </div>

        {/* Notes */}
        {customer.notes && (
          <div className="card p-5 lg:col-span-2">
            <h2 className="font-semibold text-gray-800 mb-2">ملاحظات</h2>
            <p className="text-gray-600 text-sm whitespace-pre-wrap">{customer.notes}</p>
          </div>
        )}
      </div>

      {/* Non-account customers note */}
      {!customer.is_account_customer && (
        <div className="mt-4 text-xs text-gray-500 bg-gray-50 rounded p-3">
          هذا العميل غير حسابي — لا يظهر في مركز الدائن والمدين ولا في كشف الحسابات.
          لتفعيل المتابعة المالية، قم بتعديل العميل وتفعيل خيار "عميل حسابي".
        </div>
      )}
    </div>
  );
}
