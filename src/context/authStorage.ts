const ACCESS_TOKEN_KEY = 'auth.accessToken';
const REFRESH_TOKEN_KEY = 'auth.refreshToken';
const ACTIVE_BRANCH_ID_KEY = 'auth.activeBranchId';

// Tokens live in sessionStorage so they are wiped the moment the window/process
// closes. This forces a fresh login on every app restart (security requirement).
// Branch preference is non-sensitive so it stays in localStorage.
export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

/** Best-effort JWT `exp` check (no crypto); avoids /auth/me with a clearly expired access token. */
export function isAccessTokenLikelyExpired(token: string, leewaySec = 15): boolean {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return true;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    const json = atob(pad ? b64 + '===='.slice(pad) : b64);
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return Date.now() / 1000 >= payload.exp - leewaySec;
  } catch {
    return true;
  }
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setSessionTokens(accessToken: string, refreshToken: string) {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearSessionTokens() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ACTIVE_BRANCH_ID_KEY);
}

export function getActiveBranchId(): string | null {
  return localStorage.getItem(ACTIVE_BRANCH_ID_KEY);
}

export function setActiveBranchId(branchId: string | null) {
  if (!branchId) {
    localStorage.removeItem(ACTIVE_BRANCH_ID_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_BRANCH_ID_KEY, branchId);
}
