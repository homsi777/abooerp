import { useCallback, useEffect, useRef, useState } from 'react';
import { getResolvedApiBaseUrl } from '../api/httpClient';

export type CloudConnectionStatus = 'checking' | 'online' | 'offline';

const CHECK_INTERVAL_MS = 30000;
const CHECK_TIMEOUT_MS = 4000;

function healthUrlFromApiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/api/v1')) return `${trimmed.slice(0, -'/api/v1'.length)}/api/health`;
  if (trimmed.endsWith('/api')) return `${trimmed}/health`;
  return `${trimmed}/api/health`;
}

export function useCloudConnectionStatus() {
  const [status, setStatus] = useState<CloudConnectionStatus>('checking');
  const lastCheckAtRef = useRef(0);
  const runningRef = useRef(false);

  const checkNow = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastCheckAtRef.current < 2500) return;
    if (runningRef.current) return;
    lastCheckAtRef.current = now;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('offline');
      return;
    }

    runningRef.current = true;
    setStatus((prev) => (prev === 'online' ? prev : 'checking'));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const baseUrl = await getResolvedApiBaseUrl();
      const response = await fetch(healthUrlFromApiBase(baseUrl), {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      setStatus(response.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    } finally {
      window.clearTimeout(timeout);
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkNow(true);
    const interval = window.setInterval(() => {
      void checkNow();
    }, CHECK_INTERVAL_MS);
    const handleOnline = () => void checkNow(true);
    const handleOffline = () => setStatus('offline');
    const handleFocus = () => void checkNow();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkNow]);

  return { status, checkNow };
}
