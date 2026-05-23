import { useEffect } from 'react';

function getDiagnosticsRuntime() {
  return (window as any)?.diagnosticsRuntime;
}

export default function RuntimeConnectivityBootstrap() {
  useEffect(() => {
    const runtime = getDiagnosticsRuntime();
    if (!runtime?.healthCheck) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = 1500;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void probe();
      }, delayMs);
    };

    const probe = async () => {
      try {
        const result = await runtime.healthCheck();
        const online = Boolean(result?.ok);
        window.dispatchEvent(new CustomEvent('erp:runtime-connectivity', { detail: { online, result } }));
        await runtime.appendLog?.({
          level: online ? 'info' : 'warn',
          message: online ? 'connectivity_probe_ok' : 'connectivity_probe_offline',
          metadata: { latencyMs: result?.latencyMs, status: result?.status },
        });
        retryDelayMs = online ? 5000 : Math.min(30000, retryDelayMs * 2);
      } catch (error) {
        window.dispatchEvent(new CustomEvent('erp:runtime-connectivity', { detail: { online: false } }));
        await runtime.appendLog?.({
          level: 'error',
          message: 'connectivity_probe_error',
          metadata: { reason: (error as Error)?.message || 'unknown' },
        });
        retryDelayMs = Math.min(30000, retryDelayMs * 2);
      } finally {
        schedule(retryDelayMs);
      }
    };

    const onOnline = () => {
      retryDelayMs = 1000;
      schedule(0);
    };
    const onOffline = () => {
      retryDelayMs = 3000;
      schedule(0);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    schedule(0);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return null;
}
