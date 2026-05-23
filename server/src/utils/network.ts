import os from 'node:os';

/**
 * Returns all local LAN IPv4 addresses.
 * Includes 192.168.x.x, 10.x.x.x, 172.16-31.x.x
 * Excludes loopback (127.x.x.x), link-local (169.254.x.x), and internal interfaces.
 */
export function getLocalLanAddresses(): string[] {
  const addresses: string[] = [];
  const ifaces = os.networkInterfaces();

  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (!iface || iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
      if (
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
      ) {
        addresses.push(ip);
      }
    }
  }

  return addresses;
}

/** Best guess at the primary LAN IP (first found). */
export function getPrimaryLanAddress(): string | null {
  return getLocalLanAddresses()[0] ?? null;
}
