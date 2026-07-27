const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

app.setPath('userData', path.join(app.getPath('appData'), 'shahn'));

app.whenReady().then(async () => {
  let diagnostic;
  try {
    const userData = app.getPath('userData');
    const encrypted = fs.readFileSync(path.join(userData, 'desktop-secrets.bin'));
    const secrets = JSON.parse(safeStorage.decryptString(encrypted));
    if (!secrets.centralSyncDeviceId || !secrets.centralSyncDeviceToken) {
      throw new Error('SYNC_DEVICE_CREDENTIAL_MISSING');
    }
    const response = await fetch('https://www.abooerp.org/api/v1/sync/snapshot', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sync-device-id': secrets.centralSyncDeviceId,
        'x-sync-device-token': secrets.centralSyncDeviceToken,
      },
      body: JSON.stringify({ deviceId: secrets.centralSyncDeviceId }),
    });
    const body = await response.json().catch(() => null);
    const tableCounts = response.ok && body?.data?.data
      ? Object.fromEntries(Object.entries(body.data.data).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : null]))
      : undefined;
    diagnostic = {
      status: response.status,
      success: body?.success === true,
      error: body?.error ?? null,
      message: body?.message ?? null,
      cursor: body?.data?.cursor ?? null,
      tableCounts,
    };
  } catch (error) {
    diagnostic = { error: error?.message || String(error) };
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(app.getPath('userData'), 'sync-diagnostic.json'), JSON.stringify(diagnostic, null, 2));
    app.exit(process.exitCode || 0);
  }
});
