import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthProvider';
import { realtimeClient } from '../../lib/realtime/realtimeClient';
import { isOwnCorrelationId } from '../../lib/realtime/ownWriteCorrelation';
import { isPrimaryWorkstationForSyncBanner } from '../../lib/runtime/isPrimaryWorkstation';

/**
 * تحديث شبه لحظي عبر SSE لجميع العملاء (بدون تنقل أو إغلاق صفحة).
 * إشعار بسيط في الأعلى يظهر فقط على محطة العمل الرئيسية (اتصال localhost).
 */
export default function PrimaryRemoteUpdateBanner() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;

    const unsub = realtimeClient.subscribe('*', (ev) => {
      if (ev.type === 'connected') return;
      if (isOwnCorrelationId(ev.correlationId)) return;

      window.dispatchEvent(new CustomEvent('erp:remote-data-change', { detail: ev }));

      void isPrimaryWorkstationForSyncBanner().then((primary) => {
        if (!primary) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          setVisible(true);
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => setVisible(false), 7000);
        }, 350);
      });
    });

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [user]);

  if (!visible) return null;

  return (
    <div
      role="status"
      dir="rtl"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: 600,
        color: '#0c4a6e',
        background: 'linear-gradient(90deg, #e0f2fe, #dbeafe)',
        borderBottom: '1px solid #7dd3fc',
        boxShadow: '0 2px 8px rgba(14,165,233,0.15)',
      }}
    >
      <span>تم تحديث البيانات من جهاز آخر على الشبكة — يمكنك متابعة العمل؛ القوائم المرتبطة تتحدث تلقائياً عند الحاجة.</span>
      <button
        type="button"
        aria-label="إخفاء الإشعار"
        onClick={() => setVisible(false)}
        style={{
          border: 'none',
          background: 'rgba(255,255,255,0.7)',
          borderRadius: '6px',
          width: '28px',
          height: '28px',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
          color: '#0369a1',
        }}
      >
        ×
      </button>
    </div>
  );
}
