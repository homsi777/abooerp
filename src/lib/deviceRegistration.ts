export type DeviceRegistrationStatus = 'ok' | 'pending' | 'blocked' | 'unknown' | 'skipped';

import { httpClient } from './api/httpClient';

function parseRegistrationResponse(payload: unknown): DeviceRegistrationStatus {
  if (!payload || typeof payload !== 'object') return 'unknown';
  const record = payload as { success?: boolean; error?: string; data?: { status?: string } };
  if (record.success === true) return 'ok';
  const err = String(record.error ?? '');
  if (err.includes('DEVICE_BLOCKED')) return 'blocked';
  if (err.includes('DEVICE_PENDING_APPROVAL')) return 'pending';
  return 'unknown';
}

/** Register this Electron/desktop machine with the remote API (before login). */
export async function registerDesktopDevice(apiBaseUrl: string): Promise<DeviceRegistrationStatus> {
  try {
    const runtime = (window as any)?.runtime;
    let machineId = '';
    const deviceName = navigator.platform || 'Desktop Client';
    const osType = navigator.platform || '';

    if (runtime?.getMachineId) {
      machineId = (await runtime.getMachineId()) ?? '';
    }
    if (!machineId) return 'skipped';

    const base = apiBaseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-device-id': machineId,
      'x-electron-runtime': '1',
    };

    const response = await fetch(`${base}/system/register-device`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ machineId, deviceName, osType }),
      signal: AbortSignal.timeout(12000),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 202) return 'pending';
    if (!response.ok) return parseRegistrationResponse(payload);
    return parseRegistrationResponse(payload);
  } catch {
    return 'unknown';
  }
}

export async function registerDesktopDeviceFromLogin(): Promise<DeviceRegistrationStatus> {
  try {
    const runtime = (window as any)?.runtime;
    let machineId = '';
    if (runtime?.getMachineId) {
      machineId = (await runtime.getMachineId()) ?? '';
    }
    if (!machineId) return 'skipped';

    await httpClient.post<{ status?: string; deviceId?: string }>('/system/register-device', {
      machineId,
      deviceName: navigator.platform || 'Desktop Client',
      osType: navigator.platform || '',
    });
    return 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('DEVICE_BLOCKED')) return 'blocked';
    if (msg.includes('DEVICE_PENDING_APPROVAL')) return 'pending';
    return 'unknown';
  }
}
