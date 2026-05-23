import { useEffect, useState } from 'react';
import { httpClient } from '../../lib/api/httpClient';

interface Agent { id: string; name: string; }
interface AgentBot {
  id?: string;
  agent_id: string;
  bot_token: string;
  chat_id: string;
  bot_username: string;
  is_enabled: boolean;
  notes: string;
}

interface Props {
  editId?: string | null;
  agents: Agent[];
  onClose: () => void;
  onSaved: () => void;
}

export default function AgentTelegramBotModal({ editId, agents, onClose, onSaved }: Props) {
  const isEdit = Boolean(editId);
  const [form, setForm] = useState<AgentBot>({
    agent_id: agents[0]?.id ?? '',
    bot_token: '',
    chat_id: '',
    bot_username: '',
    is_enabled: true,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    httpClient.get<AgentBot>(`/telegram/agent-bots/${editId}/full`)
      .then((data) => setForm({
        agent_id: data.agent_id,
        bot_token: data.bot_token,
        chat_id: data.chat_id,
        bot_username: data.bot_username ?? '',
        is_enabled: data.is_enabled,
        notes: data.notes ?? '',
      }))
      .catch(() => setError('تعذّر تحميل بيانات البوت'));
  }, [editId]);

  const handleSave = async () => {
    if (!form.agent_id) { setError('يجب اختيار وكيل'); return; }
    if (!form.bot_token.trim()) { setError('يجب إدخال Bot Token'); return; }
    if (!form.chat_id.trim()) { setError('يجب إدخال Chat ID'); return; }

    setSaving(true);
    setError(null);
    try {
      if (isEdit && editId) {
        await httpClient.put(`/telegram/agent-bots/${editId}`, {
          agentId: form.agent_id,
          botToken: form.bot_token,
          chatId: form.chat_id,
          botUsername: form.bot_username || null,
          isEnabled: form.is_enabled,
          notes: form.notes || null,
        });
      } else {
        await httpClient.post('/telegram/agent-bots', {
          agentId: form.agent_id,
          botToken: form.bot_token,
          chatId: form.chat_id,
          botUsername: form.bot_username || null,
          isEnabled: form.is_enabled,
          notes: form.notes || null,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, content: React.ReactNode) => (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', color: 'rgba(255,255,255,.65)', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>{label}</label>
      {content}
    </div>
  );

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
    borderRadius: '8px', color: '#fff', fontSize: '13px', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} dir="rtl">
      <div style={{
        width: '480px', background: '#1a1a2e', border: '1px solid rgba(255,255,255,.1)',
        borderRadius: '16px', padding: '28px', boxShadow: '0 24px 60px rgba(0,0,0,.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '22px' }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>
            {isEdit ? '✏️ تعديل بوت وكيل' : '➕ إضافة بوت وكيل'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>

        {field('الوكيل', (
          <select
            value={form.agent_id}
            onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
            style={{ ...inputStyle }}
          >
            {agents.map((a) => <option key={a.id} value={a.id} style={{ background: '#1a1a2e' }}>{a.name}</option>)}
          </select>
        ))}

        {field('Bot Token', (
          <input
            type="text"
            value={form.bot_token}
            onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
            placeholder="1234567890:AABBccDDEEff..."
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}
          />
        ))}

        {field('Chat ID', (
          <input
            type="text"
            value={form.chat_id}
            onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
            placeholder="6818349532 أو @channel_name"
            style={{ ...inputStyle, fontFamily: 'monospace' }}
          />
        ))}

        {field('Bot Username (اختياري)', (
          <input
            type="text"
            value={form.bot_username}
            onChange={(e) => setForm({ ...form, bot_username: e.target.value })}
            placeholder="@MyBot"
            style={inputStyle}
          />
        ))}

        {field('ملاحظات (اختياري)', (
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <input
            type="checkbox"
            id="bot-enabled"
            checked={form.is_enabled}
            onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="bot-enabled" style={{ color: 'rgba(255,255,255,.75)', fontSize: '13px', cursor: 'pointer' }}>
            مفعّل (يرسل إشعارات الشحنات)
          </label>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '14px',
            background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)',
            color: '#fca5a5', fontSize: '13px',
          }}>❌ {error}</div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              flex: 1, padding: '11px',
              background: saving ? 'rgba(255,255,255,.07)' : 'linear-gradient(135deg,#0ea5e9,#0284c7)',
              border: 'none', borderRadius: '8px', color: '#fff',
              fontSize: '14px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving ? '⏳ جارٍ الحفظ...' : 'حفظ'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '11px 20px', background: 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.12)', borderRadius: '8px',
              color: 'rgba(255,255,255,.7)', fontSize: '14px', cursor: 'pointer',
            }}
          >إلغاء</button>
        </div>
      </div>
    </div>
  );
}
