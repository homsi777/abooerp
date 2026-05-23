import { useCallback, useEffect, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';
import { useToast } from '../../components/Toast';
import AgentTelegramBotModal from '../../components/settings/AgentTelegramBotModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentBot {
  id: string;
  agent_id: string;
  agent_name: string;
  bot_token: string;
  chat_id: string;
  bot_username: string | null;
  is_enabled: boolean;
  last_test_at: string | null;
  notes: string | null;
}

interface NotificationBot {
  id: string;
  name: string;
  bot_token: string;   // مخفي (masked) من الـ API
  is_active: boolean;
  is_default: boolean;
  notes: string | null;
  last_test_at: string | null;
}

interface Agent { id: string; name: string; telegram_chat_id?: string | null; }
interface CustomerOption { id: string; name: string; phone?: string | null; }
interface SenderReceiverOption { id: string; full_name: string; phone?: string | null; }

interface TelegramInboxCandidate {
  update_id: number;
  chat_id: string;
  message_text: string;
  message_at: string | null;
  display_name: string;
  username: string | null;
}

interface TelegramPartyLink {
  id: string;
  party_type: 'agent' | 'customer' | 'sender_receiver';
  party_id: string;
  party_name: string | null;
  chat_id: string;
  bot_name: string | null;
  last_message: string | null;
  last_message_at: string | null;
}

// ── Shared Sub-Components ─────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accentColor }: {
  icon: string; label: string; value: string | number; sub?: string; accentColor: string;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #d1d5db',
      borderTop: `3px solid ${accentColor}`, borderRadius: 8,
      padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: `${accentColor}18`, border: `1px solid ${accentColor}33`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 500, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1f2937', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function Badge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: active ? '#d1fae5' : '#f3f4f6',
      color: active ? '#065f46' : '#6b7280',
      border: `1px solid ${active ? '#6ee7b7' : '#d1d5db'}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#10b981' : '#9ca3af' }} />
      {label ?? (active ? 'مفعّل' : 'معطّل')}
    </span>
  );
}

function ActionBtn({ children, variant = 'default', onClick, disabled, title }: {
  children: React.ReactNode; variant?: 'default' | 'primary' | 'danger' | 'warning' | 'success';
  onClick: () => void; disabled?: boolean; title?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    default:  { background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' },
    primary:  { background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd' },
    success:  { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' },
    danger:   { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
    warning:  { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ padding: '5px 11px', fontSize: 12, borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, transition: 'opacity .15s', fontWeight: 600, ...styles[variant] }}>
      {children}
    </button>
  );
}

function SectionHeader({ icon, title, sub, iconBg, iconBorder, action }: {
  icon: string; title: string; sub?: string; iconBg: string; iconBorder: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 7, background: iconBg, border: `1px solid ${iconBorder}`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1f2937' }}>{title}</span>
        {sub && <span style={{ fontSize: 11, color: '#6b7280', padding: '2px 7px',
          background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 5 }}>{sub}</span>}
      </div>
      {action}
    </div>
  );
}

// ── Notification Bot Form Modal ───────────────────────────────────────────────

function NotificationBotModal({
  editBot, onClose, onSaved,
}: {
  editBot: NotificationBot | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [name, setName]         = useState(editBot?.name ?? '');
  const [token, setToken]       = useState('');
  const [notes, setNotes]       = useState(editBot?.notes ?? '');
  const [isDefault, setDefault] = useState(editBot?.is_default ?? false);
  const [saving, setSaving]     = useState(false);

  const save = async () => {
    if (!name.trim()) { showToast('اسم البوت مطلوب', 'error'); return; }
    if (!editBot && !token.trim()) { showToast('توكن البوت مطلوب', 'error'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { name, is_default: isDefault, notes: notes || null };
      if (token.trim()) payload.bot_token = token.trim();
      if (editBot) {
        await httpClient.put(`/telegram/notification-bots/${editBot.id}`, payload);
      } else {
        await httpClient.post('/telegram/notification-bots', payload);
      }
      showToast(editBot ? 'تم تحديث البوت' : 'تمت إضافة البوت', 'success');
      onSaved();
    } catch (e: any) {
      showToast(e?.message ?? 'فشل الحفظ', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} dir="rtl">
      <div style={{ background: '#fff', borderRadius: 10, padding: 28, width: 460,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', border: '1px solid #d1d5db' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
          paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1f2937' }}>
            {editBot ? '✏️ تعديل بوت الإشعارات' : '➕ إضافة بوت إشعارات'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18,
            cursor: 'pointer', color: '#6b7280' }}>✕</button>
        </div>

        <div className="space-y-4">
          <div className="form-group">
            <label className="form-label">اسم البوت *</label>
            <input className="form-input w-full" placeholder="مثال: بوت إشعارات الفرع الرئيسي"
              value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">
              توكن البوت (Bot Token) {editBot && <span style={{ color: '#9ca3af', fontWeight: 400 }}>— اتركه فارغاً للإبقاء على الحالي</span>}
            </label>
            <input className="form-input w-full" dir="ltr" placeholder="123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={token} onChange={e => setToken(e.target.value)} />
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>
              احصل عليه من <strong>@BotFather</strong> على تيليجرام
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">ملاحظات (اختياري)</label>
            <input className="form-input w-full" placeholder="مثال: للفرع الشمالي فقط"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={isDefault} onChange={e => setDefault(e.target.checked)} />
            <span style={{ fontWeight: 600, color: '#1f2937' }}>تعيين كبوت افتراضي</span>
            <span style={{ color: '#9ca3af', fontSize: 11 }}>(يُستخدم لإرسال الإشعارات عند غياب بوت مخصص)</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 22, paddingTop: 14, borderTop: '1px solid #e5e7eb' }}>
          <button className="toolbar-btn primary" onClick={() => void save()} disabled={saving} style={{ flex: 1 }}>
            {saving ? 'جارٍ الحفظ...' : editBot ? 'حفظ التعديلات' : 'إضافة البوت'}
          </button>
          <button className="toolbar-btn" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ── Test Chat ID Modal ────────────────────────────────────────────────────────

function TestModal({ bot, onClose, onTested }: { bot: NotificationBot; onClose: () => void; onTested: () => void; }) {
  const { showToast } = useToast();
  const [chatId, setChatId] = useState('');
  const [testing, setTesting] = useState(false);

  const test = async () => {
    if (!chatId.trim()) { showToast('أدخل Chat ID', 'error'); return; }
    setTesting(true);
    try {
      const res = await httpClient.post<{ message?: string }>(`/telegram/notification-bots/${bot.id}/test`, { chat_id: chatId });
      showToast((res as any).message ?? 'وصلت رسالة الاختبار ✅', 'success');
      onTested();
      onClose();
    } catch (e: any) { showToast(e?.message ?? 'فشل الاختبار', 'error'); }
    finally { setTesting(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} dir="rtl">
      <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 380,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', border: '1px solid #d1d5db' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>🧪 اختبار: {bot.name}</h3>
        <div className="form-group">
          <label className="form-label">Chat ID لاستقبال رسالة الاختبار</label>
          <input className="form-input w-full" dir="ltr" placeholder="123456789"
            value={chatId} onChange={e => setChatId(e.target.value)} />
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>
            أرسل /start للبوت ثم افتح @userinfobot للحصول على Chat ID
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button className="toolbar-btn primary" onClick={() => void test()} disabled={testing} style={{ flex: 1 }}>
            {testing ? 'جارٍ الإرسال...' : 'إرسال رسالة اختبار'}
          </button>
          <button className="toolbar-btn" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function InboxLinkModal({
  bot,
  agents,
  customers,
  sendersReceivers,
  onClose,
  onLinked,
}: {
  bot: NotificationBot;
  agents: Agent[];
  customers: CustomerOption[];
  sendersReceivers: SenderReceiverOption[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [candidates, setCandidates] = useState<TelegramInboxCandidate[]>([]);
  const [selected, setSelected] = useState<TelegramInboxCandidate | null>(null);
  const [partyType, setPartyType] = useState<'agent' | 'customer' | 'sender_receiver'>('agent');
  const [partyId, setPartyId] = useState('');

  const loadCandidates = async () => {
    setLoading(true);
    try {
      const data = await httpClient.get<TelegramInboxCandidate[]>(`/telegram/notification-bots/${bot.id}/inbox-candidates?limit=40`);
      setCandidates(Array.isArray(data) ? data : []);
      if (!selected && Array.isArray(data) && data[0]) setSelected(data[0]);
    } catch (e: any) {
      showToast(e?.message ?? 'فشل جلب الرسائل من البوت', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot.id]);

  const options =
    partyType === 'agent'
      ? agents.map((a) => ({ id: a.id, label: a.name }))
      : partyType === 'customer'
        ? customers.map((c) => ({ id: c.id, label: c.name }))
        : sendersReceivers.map((s) => ({ id: s.id, label: s.full_name }));

  const bind = async () => {
    if (!selected) { showToast('اختر رسالة أولاً', 'error'); return; }
    if (!partyId) { showToast('اختر الطرف المطلوب ربطه', 'error'); return; }
    setLinking(true);
    try {
      await httpClient.post('/telegram/notification-bots/party-links/bind', {
        party_type: partyType,
        party_id: partyId,
        chat_id: selected.chat_id,
        notification_bot_id: bot.id,
        last_message: selected.message_text,
        last_message_at: selected.message_at,
        last_seen_username: selected.username,
        last_seen_name: selected.display_name,
        source_update_id: selected.update_id,
      });
      showToast('تم ربط Chat ID بنجاح', 'success');
      setPartyId('');
      onLinked();
    } catch (e: any) {
      showToast(e?.message ?? 'فشل الربط', 'error');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1002, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} dir="rtl">
      <div style={{ background: '#fff', borderRadius: 12, width: 'min(980px, 95vw)', maxHeight: '88vh', overflow: 'auto', padding: 20, border: '1px solid #d1d5db' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid #e5e7eb', paddingBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>📥 جلب ذكي من البوت: {bot.name}</h3>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>يعرض آخر رسائل المستخدمين مع Chat ID لربطها بالوكيل/العميل/المرسل-المستلم</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="toolbar-btn" onClick={() => void loadCandidates()} disabled={loading}>{loading ? 'جارٍ الجلب...' : '🔄 جلب الآن'}</button>
            <button className="toolbar-btn" onClick={onClose}>إغلاق</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: '#f9fafb', padding: '8px 10px', fontSize: 12, fontWeight: 700 }}>آخر الرسائل</div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {candidates.length === 0 ? (
                <div style={{ padding: 14, color: '#9ca3af', fontSize: 12 }}>لا توجد رسائل حالياً. اطلب من المستخدم إرسال أي رسالة للبوت ثم اضغط جلب.</div>
              ) : (
                <table className="data-grid">
                  <thead>
                    <tr><th>الاسم</th><th>Chat ID</th><th>الرسالة</th><th /></tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={`${c.chat_id}-${c.update_id}`}>
                        <td>
                          <div style={{ fontWeight: 700 }}>{c.display_name}</div>
                          <div style={{ fontSize: 11, color: '#6b7280' }}>{c.username ?? '—'}</div>
                        </td>
                        <td><code>{c.chat_id}</code></td>
                        <td style={{ maxWidth: 240, whiteSpace: 'pre-wrap' }}>{c.message_text}</td>
                        <td>
                          <ActionBtn variant={selected?.chat_id === c.chat_id ? 'success' : 'default'} onClick={() => setSelected(c)}>
                            {selected?.chat_id === c.chat_id ? '✓ مختار' : 'اختيار'}
                          </ActionBtn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>ربط الرسالة بالطرف</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              {selected ? `المستخدم المختار: ${selected.display_name} (${selected.chat_id})` : 'اختر رسالة من الجدول أولاً'}
            </div>

            <div className="form-group">
              <label className="form-label">نوع الطرف</label>
              <select className="form-select w-full" value={partyType} onChange={(e) => { setPartyType(e.target.value as any); setPartyId(''); }}>
                <option value="agent">وكيل</option>
                <option value="customer">عميل</option>
                <option value="sender_receiver">مرسل / مستلم</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">الاسم</label>
              <select className="form-select w-full" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">اختر...</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="toolbar-btn primary" disabled={linking || !selected || !partyId} onClick={() => void bind()}>
                {linking ? 'جارٍ الربط...' : '🔗 ربط Chat ID'}
              </button>
              <button className="toolbar-btn" onClick={onClose}>إلغاء</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TelegramSettings() {
  const { showToast } = useToast();
  const [agentBots, setAgentBots]       = useState<AgentBot[]>([]);
  const [notifBots, setNotifBots]       = useState<NotificationBot[]>([]);
  const [agents, setAgents]             = useState<Agent[]>([]);
  const [customers, setCustomers]       = useState<CustomerOption[]>([]);
  const [sendersReceivers, setSendersReceivers] = useState<SenderReceiverOption[]>([]);
  const [partyLinks, setPartyLinks]     = useState<TelegramPartyLink[]>([]);
  const [loading, setLoading]           = useState(true);

  // Modals
  const [showAgentModal, setShowAgentModal]   = useState(false);
  const [agentEditId, setAgentEditId]         = useState<string | null>(null);
  const [showNotifModal, setShowNotifModal]   = useState(false);
  const [notifEditBot, setNotifEditBot]       = useState<NotificationBot | null>(null);
  const [testingBot, setTestingBot]           = useState<NotificationBot | null>(null);
  const [inboxBot, setInboxBot]               = useState<NotificationBot | null>(null);
  const [testingAgentId, setTestingAgentId]   = useState<string | null>(null);

  const loadAgentBots = useCallback(async () => {
    const data = await httpClient.get<AgentBot[]>('/telegram/agent-bots').catch(() => []);
    setAgentBots(Array.isArray(data) ? data : []);
  }, []);

  const loadNotifBots = useCallback(async () => {
    const data = await httpClient.get<NotificationBot[]>('/telegram/notification-bots').catch(() => []);
    setNotifBots(Array.isArray(data) ? data : []);
  }, []);

  const loadPartyLinks = useCallback(async () => {
    const data = await httpClient.get<TelegramPartyLink[]>('/telegram/notification-bots/party-links/all').catch(() => []);
    setPartyLinks(Array.isArray(data) ? data : []);
  }, []);

  const loadCustomers = useCallback(async () => {
    const data = await httpClient.get<CustomerOption[]>('/customers?limit=300').catch(() => []);
    setCustomers(Array.isArray(data) ? data : []);
  }, []);

  const loadSendersReceivers = useCallback(async () => {
    const payload = await httpClient.get<SenderReceiverOption[] | { data?: SenderReceiverOption[] }>('/senders-receivers').catch(() => []);
    const rows = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.data) ? (payload as any).data : [];
    setSendersReceivers(rows);
  }, []);

  useEffect(() => {
    Promise.all([
      httpClient.get<Agent[]>('/agents?includeInactive=false').catch(() => [] as Agent[]),
      loadAgentBots(),
      loadNotifBots(),
      loadCustomers(),
      loadSendersReceivers(),
      loadPartyLinks(),
    ]).then(([agentList]) => {
      setAgents(Array.isArray(agentList) ? agentList : []);
    }).finally(() => setLoading(false));
  }, [loadAgentBots, loadNotifBots, loadCustomers, loadSendersReceivers, loadPartyLinks]);

  const deleteAgentBot = async (bot: AgentBot) => {
    if (!window.confirm(`حذف بوت وكيل "${bot.agent_name}"؟`)) return;
    try { await httpClient.delete(`/telegram/agent-bots/${bot.id}`); showToast('تم الحذف', 'success'); await loadAgentBots(); }
    catch { showToast('فشل الحذف', 'error'); }
  };

  const disableAgentBot = async (bot: AgentBot) => {
    try { await httpClient.post(`/telegram/agent-bots/${bot.id}/disable`, {}); showToast('تم التعطيل', 'success'); await loadAgentBots(); }
    catch { showToast('فشل التعطيل', 'error'); }
  };

  const testAgentBot = async (bot: AgentBot) => {
    setTestingAgentId(bot.id);
    try {
      const res = await httpClient.post<{ success: boolean; error?: string }>(`/telegram/agent-bots/${bot.id}/test`, {});
      if ((res as any).success) { showToast(`وصلت رسالة الاختبار للوكيل ${bot.agent_name}`, 'success'); await loadAgentBots(); }
      else showToast(`فشل: ${(res as any).error ?? 'خطأ'}`, 'error');
    } catch { showToast('فشل الاختبار', 'error'); }
    finally { setTestingAgentId(null); }
  };

  const deleteNotifBot = async (bot: NotificationBot) => {
    if (!window.confirm(`حذف بوت الإشعارات "${bot.name}"؟`)) return;
    try { await httpClient.delete(`/telegram/notification-bots/${bot.id}`); showToast('تم الحذف', 'success'); await loadNotifBots(); }
    catch { showToast('فشل الحذف', 'error'); }
  };

  const setDefaultBot = async (bot: NotificationBot) => {
    try { await httpClient.post(`/telegram/notification-bots/${bot.id}/set-default`, {}); showToast('تم تعيينه كافتراضي', 'success'); await loadNotifBots(); }
    catch { showToast('فشل التعيين', 'error'); }
  };

  const agentsWithChatId  = agents.filter(a => a.telegram_chat_id);
  const activeNotifBots   = notifBots.filter(b => b.is_active).length;
  const enabledAgentBots  = agentBots.filter(b => b.is_enabled).length;

  if (loading) return <div className="card" style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>جارٍ التحميل...</div>;

  return (
    <div dir="rtl" className="space-y-4">

      {/* ── Modals ── */}
      {showAgentModal && (
        <AgentTelegramBotModal
          editId={agentEditId} agents={agents}
          onClose={() => { setShowAgentModal(false); setAgentEditId(null); }}
          onSaved={async () => { setShowAgentModal(false); setAgentEditId(null); await loadAgentBots(); showToast('تم حفظ البوت', 'success'); }}
        />
      )}
      {showNotifModal && (
        <NotificationBotModal
          editBot={notifEditBot}
          onClose={() => { setShowNotifModal(false); setNotifEditBot(null); }}
          onSaved={async () => { setShowNotifModal(false); setNotifEditBot(null); await loadNotifBots(); }}
        />
      )}
      {testingBot && (
        <TestModal bot={testingBot} onClose={() => setTestingBot(null)} onTested={() => void loadNotifBots()} />
      )}
      {inboxBot && (
        <InboxLinkModal
          bot={inboxBot}
          agents={agents}
          customers={customers}
          sendersReceivers={sendersReceivers}
          onClose={() => setInboxBot(null)}
          onLinked={async () => { await loadPartyLinks(); }}
        />
      )}

      {/* ── Page Header ── */}
      <div className="card" style={{ borderTop: '3px solid #0ea5e9', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#0ea5e9,#0284c7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
            boxShadow: '0 4px 14px rgba(14,165,233,.3)', flexShrink: 0 }}>✈️</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1f2937' }}>إشعارات تيليجرام</h1>
            <p style={{ margin: '3px 0 0', color: '#6b7280', fontSize: 12 }}>
              إدارة بوتات الإشعارات وربط الوكلاء لاستقبال تنبيهات الشحن
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon="📢" label="بوتات إشعارات الشحن"
          value={notifBots.length} sub={`${activeNotifBots} مفعّل`} accentColor="#10b981" />
        <StatCard icon="👤" label="وكلاء مربوطون بـ Chat ID"
          value={agentsWithChatId.length} sub="إشعار مباشر عند الشحن" accentColor="#0ea5e9" />
        <StatCard icon="📡" label="بوتات مخصصة للوكلاء"
          value={agentBots.length} sub={`${enabledAgentBots} مفعّل`} accentColor="#8b5cf6" />
      </div>

      {/* ── How it works ── */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRight: '4px solid #1e40af',
        borderRadius: 8, padding: '14px 18px', display: 'flex', gap: 14 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
        <div>
          <div style={{ color: '#1e40af', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            كيف تعمل الإشعارات؟ — ترتيب الأولوية
          </div>
          <div style={{ color: '#374151', fontSize: 12, lineHeight: 2 }}>
            <strong>1️⃣ بوت مخصص للوكيل:</strong> إذا كان للوكيل بوت خاص في القسم الثالث — يُرسل منه.<br/>
            <strong>2️⃣ بوت إشعارات الشحن + Chat ID:</strong> إذا كان للوكيل Chat ID وهناك بوت إشعارات مفعّل هنا — يُرسل منه.<br/>
            <strong>3️⃣ احتياطي:</strong> توكن من ملف server/.env إن لم يوجد أي من السابق.
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 1 — بوتات إشعارات الشحن (الجديدة)
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card">
        <SectionHeader
          icon="📢" title="بوتات إشعارات الشحن" sub="بوت تضعه شركة الشحن لإرسال إشعارات للوكلاء"
          iconBg="#d1fae5" iconBorder="#6ee7b7"
          action={
            <button className="toolbar-btn primary" onClick={() => { setNotifEditBot(null); setShowNotifModal(true); }}>
              + إضافة بوت
            </button>
          }
        />

        {notifBots.length === 0 ? (
          <div style={{ border: '2px dashed #d1d5db', borderRadius: 8, padding: '36px 20px',
            textAlign: 'center', background: '#f9fafb' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
            <div style={{ color: '#374151', fontWeight: 600, fontSize: 13 }}>لا يوجد بوت إشعارات بعد</div>
            <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>
              أضف توكن بوت تيليجرام خاص بشركتك ليُرسل إشعارات الشحن للوكلاء تلقائياً
            </div>
          </div>
        ) : (
          <table className="data-grid">
            <thead>
              <tr>
                <th>اسم البوت</th>
                <th>التوكن</th>
                <th>الحالة</th>
                <th>افتراضي</th>
                <th>آخر اختبار</th>
                <th style={{ textAlign: 'center' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {notifBots.map(bot => (
                <tr key={bot.id}>
                  <td>
                    <div style={{ fontWeight: 700, color: '#1f2937' }}>{bot.name}</div>
                    {bot.notes && <div style={{ fontSize: 11, color: '#9ca3af' }}>{bot.notes}</div>}
                  </td>
                  <td>
                    <code style={{ background: '#f3f4f6', border: '1px solid #e5e7eb',
                      color: '#374151', padding: '2px 7px', borderRadius: 5, fontSize: 11 }}>
                      {bot.bot_token}
                    </code>
                  </td>
                  <td><Badge active={bot.is_active} /></td>
                  <td>
                    {bot.is_default
                      ? <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a',
                          borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>⭐ افتراضي</span>
                      : <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>}
                  </td>
                  <td style={{ color: '#6b7280', fontSize: 11 }}>
                    {bot.last_test_at ? new Date(bot.last_test_at).toLocaleString('ar-SY') : <span style={{ color: '#9ca3af' }}>لم يُختبر</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                      <ActionBtn variant="warning" title="جلب ذكي وربط Chat ID" onClick={() => setInboxBot(bot)}>📥 جلب</ActionBtn>
                      <ActionBtn variant="primary" title="اختبار" onClick={() => setTestingBot(bot)}>🧪 اختبار</ActionBtn>
                      {!bot.is_default && (
                        <ActionBtn variant="success" title="تعيين كافتراضي" onClick={() => void setDefaultBot(bot)}>⭐</ActionBtn>
                      )}
                      <ActionBtn title="تعديل" onClick={() => { setNotifEditBot(bot); setShowNotifModal(true); }}>✏️ تعديل</ActionBtn>
                      <ActionBtn variant="danger" title="حذف" onClick={() => void deleteNotifBot(bot)}>🗑 حذف</ActionBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 2.5 — روابط تيليغرام مع الأطراف
      ════════════════════════════════════════════════════════════════════ */}
      {partyLinks.length > 0 && (
        <div className="card">
          <SectionHeader
            icon="🔗"
            title="روابط Chat ID مع الأطراف"
            sub="تم استخراجها من رسائل البوت وربطها بالأسماء"
            iconBg="#fef3c7"
            iconBorder="#fde68a"
          />
          <table className="data-grid">
            <thead>
              <tr>
                <th>نوع الطرف</th>
                <th>الاسم</th>
                <th>Chat ID</th>
                <th>البوت</th>
                <th>آخر رسالة</th>
              </tr>
            </thead>
            <tbody>
              {partyLinks.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.party_type === 'agent' ? 'وكيل' : l.party_type === 'customer' ? 'عميل' : 'مرسل/مستلم'}
                  </td>
                  <td style={{ fontWeight: 700 }}>{l.party_name ?? '-'}</td>
                  <td><code>{l.chat_id}</code></td>
                  <td>{l.bot_name ?? 'افتراضي'}</td>
                  <td style={{ maxWidth: 280, whiteSpace: 'pre-wrap' }}>{l.last_message ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 2 — وكلاء مربوطون بـ Chat ID
      ════════════════════════════════════════════════════════════════════ */}
      {agentsWithChatId.length > 0 && (
        <div className="card">
          <SectionHeader icon="👥" title="وكلاء مربوطون — Chat ID مباشر"
            iconBg="#e0f2fe" iconBorder="#7dd3fc"
            sub="للتعديل: الإعدادات ← الوكلاء" />
          <table className="data-grid">
            <thead>
              <tr><th>الوكيل</th><th>Chat ID</th><th>البوت المستخدم</th></tr>
            </thead>
            <tbody>
              {agentsWithChatId.map(agent => (
                <tr key={agent.id}>
                  <td style={{ fontWeight: 600, color: '#1f2937' }}>{agent.name}</td>
                  <td>
                    <code style={{ background: '#f0fdf4', border: '1px solid #bbf7d0',
                      color: '#166534', padding: '2px 8px', borderRadius: 5, fontSize: 12 }}>
                      {agent.telegram_chat_id}
                    </code>
                  </td>
                  <td>
                    {notifBots.find(b => b.is_active && b.is_default)
                      ? <Badge active={true} label={notifBots.find(b => b.is_default)!.name} />
                      : notifBots.find(b => b.is_active)
                        ? <Badge active={true} label={notifBots.find(b => b.is_active)!.name} />
                        : <Badge active={false} label="لا يوجد بوت مفعّل" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 3 — بوتات مخصصة للوكلاء
      ════════════════════════════════════════════════════════════════════ */}
      <div className="card">
        <SectionHeader icon="📡" title="بوتات مخصصة للوكلاء" sub="Token مستقل لكل وكيل"
          iconBg="#ede9fe" iconBorder="#c4b5fd"
          action={
            <button className="toolbar-btn primary"
              onClick={() => { setAgentEditId(null); setShowAgentModal(true); }}
              disabled={agents.length === 0}>
              + إضافة بوت وكيل
            </button>
          }
        />

        {agentBots.length === 0 ? (
          <div style={{ border: '2px dashed #d1d5db', borderRadius: 8, padding: '36px 20px',
            textAlign: 'center', background: '#f9fafb' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ color: '#374151', fontWeight: 600, fontSize: 13 }}>لا توجد بوتات مخصصة</div>
            <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>
              بوتات مخصصة للوكلاء بـ Token مستقل — للمزيد من المرونة
            </div>
          </div>
        ) : (
          <table className="data-grid">
            <thead>
              <tr><th>الوكيل</th><th>Bot Username</th><th>Chat ID</th><th>الحالة</th><th>آخر اختبار</th><th style={{ textAlign: 'center' }}>إجراءات</th></tr>
            </thead>
            <tbody>
              {agentBots.map(bot => (
                <tr key={bot.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: '#1f2937' }}>{bot.agent_name ?? '-'}</div>
                    {bot.notes && <div style={{ fontSize: 11, color: '#9ca3af' }}>{bot.notes}</div>}
                  </td>
                  <td>
                    {bot.bot_username
                      ? <code style={{ background: '#eff6ff', border: '1px solid #bfdbfe',
                          color: '#1d4ed8', padding: '2px 7px', borderRadius: 5, fontSize: 11 }}>@{bot.bot_username}</code>
                      : <span style={{ color: '#9ca3af' }}>—</span>}
                  </td>
                  <td>
                    <code style={{ background: '#f3f4f6', border: '1px solid #e5e7eb',
                      color: '#374151', padding: '2px 7px', borderRadius: 5, fontSize: 11 }}>{bot.chat_id}</code>
                  </td>
                  <td><Badge active={bot.is_enabled} /></td>
                  <td style={{ color: '#6b7280', fontSize: 11 }}>
                    {bot.last_test_at ? new Date(bot.last_test_at).toLocaleString('ar-SY') : <span style={{ color: '#9ca3af' }}>لم يُختبر</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
                      <ActionBtn variant="primary" disabled={testingAgentId === bot.id || !bot.is_enabled}
                        onClick={() => void testAgentBot(bot)}>{testingAgentId === bot.id ? '⏳' : '🧪'}</ActionBtn>
                      <ActionBtn onClick={() => { setAgentEditId(bot.id); setShowAgentModal(true); }}>✏️</ActionBtn>
                      {bot.is_enabled && <ActionBtn variant="warning" onClick={() => void disableAgentBot(bot)}>⏸</ActionBtn>}
                      <ActionBtn variant="danger" onClick={() => void deleteAgentBot(bot)}>🗑</ActionBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
