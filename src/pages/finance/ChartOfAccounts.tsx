import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import { httpClient } from '../../lib/api/httpClient';
import { useAuth } from '../../context/AuthProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface AccountRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  normal_balance: 'debit' | 'credit';
  parent_account_id: string | null;
  is_control_account: boolean;
  control_party_type: string | null;
  is_postable: boolean;
  is_active: boolean;
  notes: string | null;
  children_count: number;
}

interface TreeNode extends AccountRow {
  children: TreeNode[];
}

type PanelMode = 'view' | 'add-root' | 'add-child' | 'rename';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES: { value: AccountType; label: string; normalBalance: 'debit' | 'credit' }[] = [
  { value: 'asset', label: 'أصول', normalBalance: 'debit' },
  { value: 'liability', label: 'خصوم', normalBalance: 'credit' },
  { value: 'equity', label: 'حقوق ملكية', normalBalance: 'credit' },
  { value: 'revenue', label: 'إيرادات', normalBalance: 'credit' },
  { value: 'expense', label: 'مصاريف', normalBalance: 'debit' },
];

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'خصوم',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصاريف',
};

const TYPE_FILTERS: { value: AccountType | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'asset', label: 'أصول' },
  { value: 'liability', label: 'خصوم' },
  { value: 'equity', label: 'حقوق ملكية' },
  { value: 'revenue', label: 'إيرادات' },
  { value: 'expense', label: 'مصاريف' },
];

// ─── Icons (SVG — no emoji per spec) ───────────────────────────────────────────

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2.2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 5l8 7-8 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function codeCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, 'en');
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
    nodes.sort((a, b) => codeCompare(a.account_code, b.account_code));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function ancestorChain(accounts: AccountRow[], accountId: string): AccountRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const chain: AccountRow[] = [];
  let cur: AccountRow | undefined = byId.get(accountId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_account_id ? byId.get(cur.parent_account_id) : undefined;
  }
  return chain;
}

function downloadCsv(rows: AccountRow[]) {
  const header = ['الرمز', 'اسم الحساب', 'النوع', 'الطبيعة', 'التصنيف'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [
      r.account_code,
      `"${r.account_name.replace(/"/g, '""')}"`,
      TYPE_LABELS[r.account_type],
      r.normal_balance === 'debit' ? 'مدين' : 'دائن',
      r.is_postable ? 'حركي' : 'تجميعي',
    ];
    lines.push(cells.join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'شجرة_الحسابات.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function ChartOfAccounts() {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('finance.write');

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<AccountType | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [panelMode, setPanelMode] = useState<PanelMode>('view');
  const [formParentId, setFormParentId] = useState<string | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formIsPostable, setFormIsPostable] = useState(true);
  const [formAccountType, setFormAccountType] = useState<AccountType>('asset');
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [codeSuggesting, setCodeSuggesting] = useState(false);

  const load = async (keepSelection = true) => {
    setLoading(true);
    try {
      const rows = await httpClient.get<AccountRow[]>('/chart-of-accounts');
      setAccounts(rows);
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        return new Set(rows.filter((r) => !r.is_postable).map((r) => r.id));
      });
      if (!keepSelection) setSelectedId(null);
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

  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const visibleIds = useMemo<Set<string> | null>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const matches = accounts.filter(
      (a) => (typeFilter === 'all' || a.account_type === typeFilter)
        && (a.account_name.toLowerCase().includes(q) || a.account_code.includes(q)),
    );
    const ids = new Set<string>();
    for (const m of matches) {
      for (const anc of ancestorChain(accounts, m.id)) ids.add(anc.id);
    }
    return ids;
  }, [accounts, search, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: accounts.length };
    for (const t of ACCOUNT_TYPES) counts[t.value] = accounts.filter((a) => a.account_type === t.value).length;
    return counts;
  }, [accounts]);

  const totalAccounts = accounts.length;
  const groupCount = accounts.filter((a) => !a.is_postable).length;
  const postingCount = accounts.filter((a) => a.is_postable).length;

  const selected = useMemo(() => accounts.find((a) => a.id === selectedId) ?? null, [accounts, selectedId]);
  const selectedPath = useMemo(() => (selected ? ancestorChain(accounts, selected.id) : []), [accounts, selected]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(accounts.filter((a) => !a.is_postable).map((a) => a.id)));
  const collapseAll = () => setExpanded(new Set());

  const openView = (id: string) => {
    setSelectedId(id);
    setPanelMode('view');
    setPanelError('');
  };

  const openAddRoot = () => {
    setSelectedId(null);
    setPanelMode('add-root');
    setFormParentId(null);
    setFormCode('');
    setFormName('');
    setFormNotes('');
    setFormIsPostable(true);
    setFormAccountType('asset');
    setPanelError('');
  };

  const openAddChild = async (parent: AccountRow) => {
    setSelectedId(parent.id);
    setPanelMode('add-child');
    setFormParentId(parent.id);
    setFormName('');
    setFormNotes('');
    setFormIsPostable(true);
    setPanelError('');
    setFormCode('');
    setCodeSuggesting(true);
    try {
      const res = await httpClient.get<{ code: string }>(`/chart-of-accounts/${parent.id}/next-code`);
      setFormCode(res.code);
    } catch {
      // الاقتراح تحسيني فقط — يبقى الحقل قابلاً للتعبئة اليدوية لو فشل.
    } finally {
      setCodeSuggesting(false);
    }
  };

  const openRename = (account: AccountRow) => {
    setSelectedId(account.id);
    setPanelMode('rename');
    setFormName(account.account_name);
    setFormNotes(account.notes ?? '');
    setPanelError('');
  };

  const saveCreate = async () => {
    setPanelError('');
    if (!formCode.trim() || !/^\d{3,10}$/.test(formCode.trim())) {
      setPanelError('رمز الحساب يجب أن يكون أرقاماً فقط، بطول 3 إلى 10 خانات.');
      return;
    }
    if (!formName.trim()) {
      setPanelError('اكتب اسم الحساب.');
      return;
    }
    const parent = formParentId ? accounts.find((a) => a.id === formParentId) : null;
    const typeDef = ACCOUNT_TYPES.find((t) => t.value === formAccountType)!;
    setSaving(true);
    try {
      const created = await httpClient.post<AccountRow>('/chart-of-accounts', {
        accountCode: formCode.trim(),
        accountName: formName.trim(),
        accountType: parent?.account_type ?? typeDef.value,
        normalBalance: parent?.normal_balance ?? typeDef.normalBalance,
        parentAccountId: formParentId,
        isPostable: formIsPostable,
        notes: formNotes.trim() || null,
      });
      showToast('تم إضافة الحساب', 'success');
      await load();
      setSelectedId(created.id);
      setPanelMode('view');
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : 'تعذر حفظ الحساب.');
    } finally {
      setSaving(false);
    }
  };

  const saveRename = async () => {
    if (!selected) return;
    setPanelError('');
    if (!formName.trim()) {
      setPanelError('اكتب اسم الحساب.');
      return;
    }
    setSaving(true);
    try {
      await httpClient.put<AccountRow>(`/chart-of-accounts/${selected.id}`, {
        accountName: formName.trim(),
        parentAccountId: selected.parent_account_id,
        notes: formNotes.trim() || null,
      });
      showToast('تم تحديث الحساب', 'success');
      await load();
      setPanelMode('view');
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : 'تعذر تحديث الحساب.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (account: AccountRow) => {
    if (!window.confirm(`إلغاء تفعيل حساب "${account.account_name}"؟`)) return;
    try {
      await httpClient.delete(`/chart-of-accounts/${account.id}`);
      showToast('تم إلغاء تفعيل الحساب', 'success');
      if (selectedId === account.id) setSelectedId(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'تعذر إلغاء التفعيل', 'error');
    }
  };

  // ─── Row rendering ──────────────────────────────────────────────────────

  const renderRow = (node: TreeNode, depth: number): React.ReactNode => {
    if (visibleIds && !visibleIds.has(node.id)) return null;
    const isGroup = !node.is_postable;
    const isExpanded = visibleIds ? true : expanded.has(node.id);
    const hasChildren = node.children.length > 0;

    return (
      <>
        <tr
          key={node.id}
          className={`coa-row ${isGroup ? 'group' : ''} ${selectedId === node.id ? 'selected' : ''}`}
          onClick={() => openView(node.id)}
        >
          <td>
            <span className="coa-row-code">{node.account_code}</span>
          </td>
          <td>
            <div className="coa-row-name" style={{ paddingInlineStart: `${depth * 28}px` }}>
              {hasChildren ? (
                <button
                  type="button"
                  className={`coa-chevron ${isExpanded ? '' : 'rotated'}`}
                  onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                  aria-label={isExpanded ? 'طي' : 'توسيع'}
                >
                  <ChevronIcon />
                </button>
              ) : (
                <span className="coa-dot" aria-hidden="true" />
              )}
              <span className="coa-row-name-text">{node.account_name}</span>
              {node.is_control_account && (
                <span className="coa-control-badge"><LockIcon /> تحكّم</span>
              )}
            </div>
          </td>
          <td><span className={`coa-type-badge ${node.account_type}`}>{TYPE_LABELS[node.account_type]}</span></td>
          <td style={{ fontSize: '12px', color: 'var(--coa-muted)' }}>{node.normal_balance === 'debit' ? 'مدين' : 'دائن'}</td>
          <td><span className="coa-class-badge">{isGroup ? 'تجميعي' : 'حركي'}</span></td>
          <td>
            <div className="coa-row-actions">
              {canWrite && (
                <button
                  type="button"
                  className="coa-icon-btn"
                  aria-label="إضافة حساب فرعي"
                  title="إضافة حساب فرعي"
                  disabled={node.is_control_account}
                  onClick={(e) => { e.stopPropagation(); void openAddChild(node); }}
                >
                  <PlusIcon />
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  className="coa-icon-btn"
                  aria-label="تعديل الاسم"
                  title="تعديل الاسم"
                  onClick={(e) => { e.stopPropagation(); openRename(node); }}
                >
                  <EditIcon />
                </button>
              )}
            </div>
          </td>
        </tr>
        {(isExpanded || visibleIds) && node.children.map((child) => renderRow(child, depth + 1))}
      </>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="coa">
      <Link to="/finance" className="coa-breadcrumb">← المالية</Link>

      <div className="coa-header">
        <div>
          <h1 className="coa-title">شجرة الحسابات</h1>
          <p className="coa-subtitle">إضافة وتعديل بنود الحسابات بتصنيف تجميعي/حركي ودعم فروع غير محدودة العمق.</p>
        </div>
        <div className="coa-header-actions">
          <button type="button" className="coa-btn" onClick={() => downloadCsv(accounts)}>تصدير</button>
          {canWrite && (
            <button type="button" className="coa-btn primary" onClick={openAddRoot}>حساب رئيسي جديد</button>
          )}
        </div>
      </div>

      <div className="coa-tiles">
        <div className="coa-tile">
          <div className="coa-tile-label">إجمالي الحسابات</div>
          <div className="coa-tile-value">{totalAccounts}</div>
        </div>
        <div className="coa-tile">
          <div className="coa-tile-label">حسابات رئيسية (تجميعية)</div>
          <div className="coa-tile-value">{groupCount}</div>
        </div>
        <div className="coa-tile">
          <div className="coa-tile-label">حسابات فرعية (حركية)</div>
          <div className="coa-tile-value">{postingCount}</div>
        </div>
      </div>

      <div className="coa-layout">
        <div className="coa-card">
          <div className="coa-toolbar">
            <input
              className="coa-search"
              placeholder="ابحثي بالاسم أو الرمز..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="بحث"
            />
            <button type="button" className="coa-btn" onClick={expandAll}>توسيع الكل</button>
            <button type="button" className="coa-btn" onClick={collapseAll}>طي الكل</button>
          </div>
          <div className="coa-chip-row">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`coa-chip ${typeFilter === t.value ? 'active' : ''}`}
                onClick={() => setTypeFilter(t.value)}
              >
                {t.label} <span className="count">({typeCounts[t.value] ?? 0})</span>
              </button>
            ))}
          </div>

          {loading ? (
            <p className="coa-empty">جاري التحميل...</p>
          ) : tree.length === 0 ? (
            <p className="coa-empty">لا توجد حسابات بعد.</p>
          ) : (
            <div className="coa-table-wrap">
              <table className="coa-table">
                <thead>
                  <tr>
                    <th>الرمز</th>
                    <th>اسم الحساب</th>
                    <th>النوع</th>
                    <th>الطبيعة</th>
                    <th>التصنيف</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tree
                    .filter((n) => typeFilter === 'all' || n.account_type === typeFilter)
                    .map((n) => renderRow(n, 0))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── Side panel ─── */}
        <div className="coa-card">
          {panelMode === 'view' && selected && (
            <>
              <div className="coa-panel-head">
                <span className="coa-panel-code">{selected.account_code}</span>
                <div className="coa-panel-name">{selected.account_name}</div>
                <span className={`coa-type-badge ${selected.account_type}`}>{TYPE_LABELS[selected.account_type]}</span>
                {selectedPath.length > 1 && (
                  <div className="coa-panel-path" style={{ marginTop: '8px' }}>
                    {selectedPath.map((a) => a.account_name).join(' ‹ ')}
                  </div>
                )}
              </div>
              <div className="coa-panel-body">
                <div className="coa-panel-grid">
                  <div className="coa-panel-stat">
                    <div className="coa-panel-stat-label">الطبيعة</div>
                    <div className="coa-panel-stat-value">{selected.normal_balance === 'debit' ? 'مدين' : 'دائن'}</div>
                  </div>
                  <div className="coa-panel-stat">
                    <div className="coa-panel-stat-label">التصنيف</div>
                    <div className="coa-panel-stat-value">{selected.is_postable ? 'حركي' : 'تجميعي'}</div>
                  </div>
                  <div className="coa-panel-stat">
                    <div className="coa-panel-stat-label">الفروع المباشرة</div>
                    <div className="coa-panel-stat-value">{selected.children_count}</div>
                  </div>
                  <div className="coa-panel-stat">
                    <div className="coa-panel-stat-label">الحالة</div>
                    <div className="coa-panel-stat-value">{selected.is_active ? 'نشط' : 'غير نشط'}</div>
                  </div>
                </div>

                {selected.notes && (
                  <div className="coa-field">
                    <label>ملاحظات</label>
                    <div style={{ fontSize: '13px', color: 'var(--coa-muted)' }}>{selected.notes}</div>
                  </div>
                )}

                {selected.is_control_account && (
                  <div className="coa-panel-note">
                    <LockIcon /> حساب تحكّم مرتبط بأطراف خارجية ({selected.control_party_type}) — لا يمكن إضافة فروع تحته أو تغيير تصنيفه.
                  </div>
                )}

                {canWrite && (
                  <div className="coa-panel-actions" style={{ marginTop: '6px' }}>
                    {!selected.is_control_account && (
                      <button type="button" className="coa-btn primary" onClick={() => void openAddChild(selected)}>إضافة حساب فرعي</button>
                    )}
                    <button type="button" className="coa-btn" onClick={() => openRename(selected)}>تعديل الاسم</button>
                    <button type="button" className="coa-btn danger" onClick={() => void deactivate(selected)}>إلغاء التفعيل</button>
                  </div>
                )}
              </div>
            </>
          )}

          {panelMode === 'view' && !selected && (
            <p className="coa-empty">اختاري حساباً من الشجرة لعرض تفاصيله.</p>
          )}

          {(panelMode === 'add-root' || panelMode === 'add-child') && (
            <div className="coa-panel-body">
              <h2 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>
                {panelMode === 'add-child' && formParentId
                  ? `تحت: ${accounts.find((a) => a.id === formParentId)?.account_name ?? ''}`
                  : 'حساب رئيسي جديد'}
              </h2>

              <div className="coa-field">
                <label>رمز الحساب</label>
                <input
                  className="coa-input code"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  placeholder={codeSuggesting ? '...' : 'مثال: 3200'}
                />
              </div>

              <div className="coa-field">
                <label>اسم الحساب</label>
                <input className="coa-input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثال: مسحوبات الشركاء" />
              </div>

              {panelMode === 'add-child' && formParentId && (
                <div className="coa-locked-field">
                  <div className="coa-locked-label">
                    <span>نوع الحساب وطبيعته</span>
                    <span className="coa-locked-tag">موروث</span>
                  </div>
                  <div className="coa-locked-value">
                    {TYPE_LABELS[accounts.find((a) => a.id === formParentId)?.account_type ?? 'asset']}
                    {' · '}
                    {(accounts.find((a) => a.id === formParentId)?.normal_balance ?? 'debit') === 'debit' ? 'مدين' : 'دائن'}
                  </div>
                </div>
              )}

              {panelMode === 'add-root' && (
                <div className="coa-field">
                  <label>نوع الحساب وطبيعته</label>
                  <select
                    className="coa-select"
                    value={formAccountType}
                    onChange={(e) => setFormAccountType(e.target.value as AccountType)}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label} · {t.normalBalance === 'debit' ? 'مدين' : 'دائن'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="coa-field">
                <label>التصنيف</label>
                <div className="coa-radio-row">
                  <label className={`coa-radio-opt ${formIsPostable ? 'active' : ''}`}>
                    <input type="radio" checked={formIsPostable} onChange={() => setFormIsPostable(true)} style={{ display: 'none' }} />
                    حركي
                  </label>
                  <label className={`coa-radio-opt ${!formIsPostable ? 'active' : ''}`}>
                    <input type="radio" checked={!formIsPostable} onChange={() => setFormIsPostable(false)} style={{ display: 'none' }} />
                    تجميعي
                  </label>
                </div>
              </div>

              <div className="coa-field">
                <label>ملاحظات (اختياري)</label>
                <textarea className="coa-textarea" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </div>

              {panelError && (
                <div className="coa-panel-alert">
                  <span>{panelError}</span>
                  <button type="button" onClick={() => setPanelError('')} aria-label="إغلاق التنبيه">✕</button>
                </div>
              )}

              <div className="coa-panel-actions">
                <button type="button" className="coa-btn primary" onClick={() => void saveCreate()} disabled={saving}>
                  {saving ? 'جارٍ الحفظ...' : 'حفظ الحساب'}
                </button>
                <button type="button" className="coa-btn" onClick={() => setPanelMode('view')} disabled={saving}>إلغاء</button>
              </div>
            </div>
          )}

          {panelMode === 'rename' && selected && (
            <div className="coa-panel-body">
              <h2 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>تعديل: {selected.account_code}</h2>
              <div className="coa-field">
                <label>اسم الحساب</label>
                <input className="coa-input" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="coa-field">
                <label>ملاحظات (اختياري)</label>
                <textarea className="coa-textarea" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
              </div>

              {panelError && (
                <div className="coa-panel-alert">
                  <span>{panelError}</span>
                  <button type="button" onClick={() => setPanelError('')} aria-label="إغلاق التنبيه">✕</button>
                </div>
              )}

              <div className="coa-panel-actions">
                <button type="button" className="coa-btn primary" onClick={() => void saveRename()} disabled={saving}>
                  {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
                </button>
                <button type="button" className="coa-btn" onClick={() => setPanelMode('view')} disabled={saving}>إلغاء</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
