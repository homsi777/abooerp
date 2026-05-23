/**
 * True when this UI runs against the local API (جهاز / تطبيق الرئيسي)،
 * وليس عميل LAN يشير إلى IP آخر — يُستخدم لعرض إشعار التحديث فقط على الرئيسي.
 */
export async function isPrimaryWorkstationForSyncBanner(): Promise<boolean> {
  try {
    const runtime = (window as any)?.runtime?.getConfig;
    if (typeof runtime === 'function') {
      const cfg = await runtime();
      if (cfg?.backendResolutionMode === 'localhost') return true;
      if (cfg?.backendResolutionMode === 'manual_lan' || cfg?.backendResolutionMode === 'auto_lan') return false;
    }
  } catch {
    /* ignore */
  }
  const lan = typeof localStorage !== 'undefined' ? localStorage.getItem('lan.apiBaseUrl') || '' : '';
  if (!lan) return true;
  return /127\.0\.0\.1|localhost/i.test(lan);
}
