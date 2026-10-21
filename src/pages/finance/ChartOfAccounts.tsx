import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';

interface AccountRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal_balance: 'debit' | 'credit';
  parent_account_id: string | null;
  is_control_account: boolean;
  control_party_type: string | null;
  notes: string | null;
}

const ACCOUNT_TYPES: { value: AccountRow['account_type']; label: string; normalBalance: 'debit' | 'credit' }[] = [
  { value: 'asset', label: 'أصول', normalBalance: 'debit' },
  { value: 'liability', label: 'خصوم', normalBalance: 'credit' },
  { value: 'equity', label: 'حقوق ملكية', normalBalance: 'credit' },
  { value: 'revenue', label: 'إيرادات', normalBalance: 'credit' },
  { value: 'expense', label: 'مصاريف', normalBalance: 'debit' },
];

const TYPE_LABELS: Record<AccountRow['account_type'], string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصاريف',
};

const inputStyle: React.CSSProperties = {
  minHeight: '44px',
  fontSize: '16px',
  padding: '8px 14px',
  borderRadius: '10px',
  border: '1px solid #cbd5e1',
  width: '100%',
  boxSizing: 'border-box',
  background: '#f8fafc',
};

const labelStyle: React.CSSProperties = { fontSize: '13.5px', fontWeight: 700, color: '#374151', marginBottom: '6px', display: 'block' };

interface TreeNode extends AccountRow {
  children: TreeNode[];
}

function buildTree(rows: AccountRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  rows.forEach((r) => byId.set(r.id, { ...r, children: [] }));
  const roots: TreeNode[] = [];
  byId.forEach((node) => {
    if (node.parent_account_id && byId.has(node.parent_account_id)) {
      byId.get(node.parent_account_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.account_code.localeCompare(b.account_code, 'en'));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export default function ChartOfAccounts() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountCode, setAccountCode] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountRow['account_type']>('expense');
  const [normalBalance, setNormalBalance] = useState<'debit' | 'credit'>('debit');
  const [parentAccountId, setParentAccountId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await httpClient.get<AccountRow[]>('/chart-of-accounts'));
    } catch {
      showToast('تعذر تحميل شجرة الحسابات', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = useMemo(() => buildTree(rows), [rows]);

  const resetForm = () => {
    setEditingId(null);
    setAccountCode('');
    setAccountName('');
    setAccountType('expense');
    setNormalBalance('debit');
    setParentAccountId('');
    setNotes('');
    setError('');
  };

  const startAddUnder = (parentId: string | '') => {
    resetForm();
    setParentAccountId(parentId);
  };

  const startEdit = (row: AccountRow) => {
    setEditingId(row.id);
    setAccountCode(row.account_code);
    setAccountName(row.account_name);
    setAccountType(row.account_type);
    setNormalBalance(row.normal_balance);
    setParentAccountId(row.parent_account_id ?? '');
    setNotes(row.notes ?? '');
    setError('');
  };

  const onTypeChange = (value: AccountRow['account_type']) => {
    setAccountType(value);
    const def = ACCOUNT_TYPES.find((t) => t.value === value);
    if (def) setNormalBalance(def.normalBalance);
  };

  const save = async () => {
    setError('');
    if (!editingId && !accountCode.trim()) {
      setError('اكتب رمز الحساب.');
      return;
    }
    if (!accountName.trim()) {
      setError('اكتب اسم الحساب.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const updated = await httpClient.put<AccountRow>(`/chart-of-accounts/${editingId}`, {
          accountName: accountName.trim(),
          parentAccountId: parentAccountId || null,
          notes: notes.trim() || null,
        });
        setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, ...updated } : r)));
        showToast('تم تحديث الحساب', 'success');
      } else {
        const created = await httpClient.post<AccountRow>('/chart-of-accounts', {
          accountCode: accountCode.trim(),
          accountName: accountName.trim(),
          accountType,
          normalBalance,
          parentAccountId: parentAccountId || null,
          notes: notes.trim() || null,
        });
        setRows((prev) => [...prev, created]);
        showToast('تم إضافة الحساب', 'success');
      }
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ — تأكد أن رمز الحساب غير مستخدم.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (row: AccountRow) => {
    if (!window.confirm(`إلغاء تفعيل حساب "${row.account_name}"؟`)) return;
    try {
      await httpClient.delete(`/chart-of-accounts/${row.id}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      if (editingId === row.id) resetForm();
      showToast('تم إلغاء تفعيل الحساب', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إلغاء التفعيل', 'error');
    }
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            paddingInlineStart: `${10 + depth * 22}px`,
            borderBottom: '1px solid #f1f5f9',
            background: editingId === node.id ? '#eef2ff' : 'transparent',
          }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleCollapse(node.id)}
            style={{
              width: '18px',
              background: 'none',
              border: 'none',
              cursor: hasChildren ? 'pointer' : 'default',
              color: '#9ca3af',
              fontSize: '12px',
            }}
          >
            {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
          </button>
          <span style={{ fontFamily: 'monospace', color: '#6b7280', fontSize: '13px', minWidth: '58px' }}>{node.account_code}</span>
          <span style={{ fontWeight: 700, color: '#111827', flex: 1 }}>{node.account_name}</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#4338ca',
              background: '#eef2ff',
              padding: '2px 8px',
              borderRadius: '999px',
            }}
          >
            {TYPE_LABELS[node.account_type]}
          </span>
          <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '36px', textAlign: 'center' }}>
            {node.normal_balance === 'debit' ? 'مدين' : 'دائن'}
          </span>
          <button
            type="button"
            onClick={() => startAddUnder(node.id)}
            title="إضافة حساب فرعي"
            style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontSize: '14px' }}
          >
            ⊕
          </button>
          <button
            type="button"
            onClick={() => startEdit(node)}
            title="تعديل"
            style={{ background: 'none', border: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: '14px' }}
          >
            ✏️
          </button>
          {!node.is_control_account && (
            <button
              type="button"
              onClick={() => void deactivate(node)}
              title="إلغاء تفعيل"
              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '13px' }}
            >
              حذف
            </button>
          )}
        </div>
        {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', paddingBottom: '32px' }}>
      <div>
        <Link to="/finance" style={{ fontSize: '14px', color: '#4f46e5', textDecoration: 'none', fontWeight: 600 }}>
          ← الذمم والمالية
        </Link>
        <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#111827', margin: '8px 0 4px' }}>🌳 شجرة الحسابات</h1>
        <p style={{ color: '#6b7280', fontSize: '13.5px', margin: 0 }}>
          إضافة وتعديل بنود الحسابات (مثل مسحوبات الشركاء) — كما في برنامج المحاسبة القديم.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 400px) 1fr', gap: '18px', alignItems: 'start' }}>
        {/* ───── Right: add/edit account ───── */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#111827' }}>
              {editingId ? '✏️ تعديل حساب' : 'إضافة حساب جديد'}
            </h2>
            <span style={{ fontSize: '20px' }}>{editingId ? '✏️' : '⊕'}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={labelStyle}>الحساب الأب (اختياري)</label>
              <select style={inputStyle} value={parentAccountId} onChange={(e) => setParentAccountId(e.target.value)}>
                <option value="">— حساب رئيسي (بدون أب) —</option>
                {rows
                  .slice()
                  .sort((a, b) => a.account_code.localeCompare(b.account_code, 'en'))
                  .filter((r) => r.id !== editingId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.account_code} — {r.account_name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>رمز الحساب</label>
              <input
                style={{ ...inputStyle, ...(editingId ? { background: '#f1f5f9', color: '#9ca3af' } : {}) }}
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                disabled={Boolean(editingId)}
                placeholder="مثال: 3200"
              />
            </div>

            <div>
              <label style={labelStyle}>اسم الحساب</label>
              <input style={inputStyle} value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="مثال: مسحوبات الشركاء" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={labelStyle}>نوع الحساب</label>
                <select
                  style={{ ...inputStyle, ...(editingId ? { background: '#f1f5f9', color: '#9ca3af' } : {}) }}
                  value={accountType}
                  onChange={(e) => onTypeChange(e.target.value as AccountRow['account_type'])}
                  disabled={Boolean(editingId)}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>الطبيعة</label>
                <select
                  style={{ ...inputStyle, ...(editingId ? { background: '#f1f5f9', color: '#9ca3af' } : {}) }}
                  value={normalBalance}
                  onChange={(e) => setNormalBalance(e.target.value as 'debit' | 'credit')}
                  disabled={Boolean(editingId)}
                >
                  <option value="debit">مدين</option>
                  <option value="credit">دائن</option>
                </select>
              </div>
            </div>

            <div>
              <label style={labelStyle}>ملاحظات (اختياري)</label>
              <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: '14px', margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                style={{
                  flex: 1,
                  minHeight: '46px',
                  background: '#4f46e5',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {saving ? 'جارٍ الحفظ...' : editingId ? 'تحديث' : 'حفظ'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  style={{
                    flex: 1,
                    minHeight: '46px',
                    background: '#fff',
                    color: '#374151',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '15px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  إلغاء
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ───── Left: tree ───── */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#111827' }}>الحسابات</h2>
            <button
              type="button"
              onClick={() => startAddUnder('')}
              style={{
                background: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
                borderRadius: '8px',
                padding: '6px 12px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              + حساب رئيسي
            </button>
          </div>

          {loading ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '30px' }}>جاري التحميل...</p>
          ) : tree.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: '30px' }}>لا توجد حسابات بعد.</p>
          ) : (
            <div>{tree.map((node) => renderNode(node, 0))}</div>
          )}
        </div>
      </div>
    </div>
  );
}
