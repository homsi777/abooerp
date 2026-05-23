import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { httpClient } from '../../lib/api/httpClient';
import { normalizeShipmentStatus } from '../../lib/shipments/shipmentStatus';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  is_active: boolean;
};

type ShipmentRow = { id: string; branch_id?: string | null; status: string; created_at: string };
type UserRow = { id: string; branch_id?: string | null };
type BranchForm = { id?: string; code: string; name: string; city: string; address: string; phone: string; is_active: boolean };

const emptyBranch: BranchForm = { code: '', name: '', city: '', address: '', phone: '', is_active: true };

export default function BranchesModule() {
  const navigate = useNavigate();
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<BranchForm | null>(null);
  const [filters, setFilters] = useState({ search: '', status: '', city: '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [branchRows, shipmentRows, userRows] = await Promise.all([
        httpClient.get<BranchRecord[]>('/branches?includeInactive=true'),
        httpClient.get<ShipmentRow[]>('/shipments'),
        httpClient.get<UserRow[]>('/users').catch(() => []),
      ]);
      setBranches(branchRows);
      setShipments(shipmentRows);
      setUsers(userRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات الفروع.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return branches
      .filter((branch) => {
        if (filters.status === 'active' && !branch.is_active) return false;
        if (filters.status === 'inactive' && branch.is_active) return false;
        if (filters.city && !(branch.city || '').toLowerCase().includes(filters.city.trim().toLowerCase())) return false;
        if (q && !`${branch.code} ${branch.name} ${branch.phone || ''}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((branch) => {
        const relatedShipments = shipments.filter((shipment) => shipment.branch_id === branch.id);
        const delivered = relatedShipments.filter((shipment) => normalizeShipmentStatus(shipment.status) === 'DELIVERED').length;
        const active = relatedShipments.filter((shipment) => {
          const status = normalizeShipmentStatus(shipment.status);
          return status === 'IN_TRANSIT' || status === 'OUT_FOR_DELIVERY';
        }).length;
        return {
          ...branch,
          outbound: relatedShipments.length,
          delivered,
          active,
          lastActivity: relatedShipments[0]?.created_at || null,
          userCount: users.filter((user) => user.branch_id === branch.id).length,
        };
      });
  }, [branches, filters, shipments, users]);

  const beginEdit = (branch?: BranchRecord) => {
    setError('');
    setSuccess('');
    setEditing(branch ? {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      city: branch.city || '',
      address: branch.address || '',
      phone: branch.phone || '',
      is_active: branch.is_active,
    } : { ...emptyBranch, code: `BR-${Date.now().toString().slice(-6)}` });
  };

  const saveBranch = async () => {
    if (!editing) return;
    if (!editing.code.trim() || !editing.name.trim()) {
      setError('كود الفرع واسم الفرع حقول مطلوبة.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        code: editing.code.trim(),
        name: editing.name.trim(),
        city: editing.city.trim() || undefined,
        address: editing.address.trim() || undefined,
        phone: editing.phone.trim() || undefined,
        is_active: editing.is_active,
      };
      if (editing.id) {
        await httpClient.put(`/branches/${editing.id}`, payload);
        setSuccess('تم تحديث بيانات الفرع بنجاح.');
      } else {
        await httpClient.post('/branches', payload);
        setSuccess('تمت إضافة الفرع بنجاح.');
      }
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ بيانات الفرع.');
    } finally {
      setSaving(false);
    }
  };

  const toggleBranch = async (branch: BranchRecord) => {
    setSaving(true);
    setError('');
    try {
      await httpClient.put(`/branches/${branch.id}`, { is_active: !branch.is_active });
      setSuccess(branch.is_active ? 'تم تعطيل الفرع.' : 'تم تفعيل الفرع.');
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'تعذر تغيير حالة الفرع.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">الفروع</h2>
          <p className="text-sm text-gray-600">إدارة الفروع ونطاقاتها التشغيلية ومستخدميها.</p>
        </div>
        <button type="button" className="toolbar-btn primary" onClick={() => beginEdit()}>إضافة فرع</button>
      </div>

      {editing ? (
        <div className="card mb-3">
          <div className="card-header">{editing.id ? 'تعديل فرع' : 'إضافة فرع جديد'}</div>
          <div className="grid grid-cols-4 gap-3">
            <label className="form-group"><span className="form-label">كود الفرع</span><input className="form-input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">اسم الفرع</span><input className="form-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">المدينة / المحافظة</span><input className="form-input" value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">الهاتف</span><input className="form-input" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label>
            <label className="form-group col-span-2"><span className="form-label">العنوان</span><input className="form-input" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></label>
            <label className="form-group"><span className="form-label">الحالة</span><select className="form-select" value={editing.is_active ? 'active' : 'inactive'} onChange={(e) => setEditing({ ...editing, is_active: e.target.value === 'active' })}><option value="active">نشط</option><option value="inactive">معطل</option></select></label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="toolbar-btn success" disabled={saving} onClick={() => void saveBranch()}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
            <button type="button" className="toolbar-btn" onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      ) : null}

      <div className="card mb-3">
        <div className="grid grid-cols-6 gap-2">
          <input className="form-input" placeholder="بحث عام" value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} />
          <select className="form-select" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}><option value="">الحالة</option><option value="active">نشط</option><option value="inactive">معطل</option></select>
          <input className="form-input" placeholder="المدينة / المنطقة" value={filters.city} onChange={(event) => setFilters((prev) => ({ ...prev, city: event.target.value }))} />
          <button type="button" className="toolbar-btn primary" onClick={() => void load()}>تطبيق</button>
          <button type="button" className="toolbar-btn" onClick={() => setFilters({ search: '', status: '', city: '' })}>إعادة ضبط</button>
          <span />
        </div>
      </div>

      <div className="card flex-1 overflow-auto">
        {error ? <div className="text-sm text-red-700 mb-2">{error}</div> : null}
        {success ? <div className="text-sm text-emerald-700 mb-2">{success}</div> : null}
        <table className="data-grid">
          <thead><tr><th>#</th><th>كود الفرع</th><th>اسم الفرع</th><th>المدينة</th><th>الهاتف</th><th>الحالة</th><th>الشحنات</th><th>قيد التسليم</th><th>مسلمة</th><th>المستخدمون</th><th>آخر نشاط</th><th>إجراءات</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td><td>{row.code}</td><td>{row.name}</td><td>{row.city || '-'}</td><td>{row.phone || '-'}</td><td>{row.is_active ? 'نشط' : 'معطل'}</td><td>{row.outbound}</td><td>{row.active}</td><td>{row.delivered}</td><td>{row.userCount}</td><td>{row.lastActivity ? new Date(row.lastActivity).toLocaleString('ar-SY') : '-'}</td>
                <td><div className="flex gap-2 text-xs"><Link to={`/branches/${row.id}`}>ملف الفرع</Link><button type="button" className="text-indigo-700" onClick={() => beginEdit(row)}>تعديل</button><button type="button" className="text-amber-700" onClick={() => void toggleBranch(row)}>{row.is_active ? 'تعطيل' : 'تفعيل'}</button><button type="button" className="text-indigo-700" onClick={() => navigate(`/finance/account-statement?branchId=${row.id}`)}>كشف الحساب</button></div></td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? <tr><td colSpan={12} className="text-center p-6 text-gray-500">لا توجد بيانات بعد. ابدأ بإضافة فرع جديد.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
