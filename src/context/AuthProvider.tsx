import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearSessionTokens,
  getAccessToken,
  getActiveBranchId,
  getRefreshToken,
  isAccessTokenLikelyExpired,
  setActiveBranchId,
  setSessionTokens,
} from './authStorage';
import { configureHttpClientAuth, httpClient } from '../lib/api/httpClient';
import { realtimeClient } from '../lib/realtime/realtimeClient';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  permissions: string[];
  userType: 'admin' | 'employee' | 'agent' | 'accountant' | 'branch_supervisor' | 'delivery' | 'viewer';
  companyId: string;
  branchId: string | null;
  allowedBranchIds: string[];
  agentId: string | null;
}

type LoginResult = {
  user: AuthUser;
  session: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: string;
  };
};

type AuthContextValue = {
  user: AuthUser | null;
  permissions: string[];
  activeBranchId: string | null;
  loading: boolean;
  login: (username: string, password: string, branchId?: string | null) => Promise<AuthUser>;
  logout: (reason?: string) => Promise<void>;
  refresh: () => Promise<boolean>;
  setActiveBranch: (branchId: string | null) => Promise<void>;
  hasPermission: (permission: string) => boolean;
  sessionExpiredMessage: string | null;
  clearSessionExpiredMessage: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

let sessionRestoreInFlight: Promise<void> | null = null;
let refreshInFlight: Promise<boolean> | null = null;

function getElectronRuntime(): any {
  return (window as any)?.runtime;
}

async function persistElectronSession(accessToken: string | null) {
  const runtime = getElectronRuntime();
  if (!runtime?.setSessionToken) return;
  await runtime.setSessionToken(accessToken);
}

async function persistElectronBranch(activeBranchId: string | null) {
  const runtime = getElectronRuntime();
  if (!runtime?.setActiveBranch) return;
  await runtime.setActiveBranch(activeBranchId);
}

async function loadElectronStoredBranch(): Promise<string | null> {
  const runtime = getElectronRuntime();
  if (!runtime?.getActiveBranch) return null;
  try {
    const branchId = await runtime.getActiveBranch();
    return branchId || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeBranchId, setActiveBranchIdState] = useState<string | null>(() => getActiveBranchId());
  const [loading, setLoading] = useState(true);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);

  const setActiveBranch = useCallback(
    async (branchId: string | null) => {
      setActiveBranchIdState(branchId);
      setActiveBranchId(branchId);
      await persistElectronBranch(branchId);
    },
    [setActiveBranchIdState],
  );

  const logout = useCallback(async (_reason?: string) => {
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await httpClient.post('/auth/logout', { refreshToken });
      }
    } catch {
      // Ignore network/logout errors during cleanup.
    } finally {
      realtimeClient.disconnect();
      clearSessionTokens();
      await persistElectronSession(null);
      await persistElectronBranch(null);
      setUser(null);
      setActiveBranchIdState(null);
    }
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (refreshInFlight) return refreshInFlight;
    const run = (async (): Promise<boolean> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const response = await httpClient.post<LoginResult>('/auth/refresh', {
          refreshToken,
          branchId: activeBranchId || undefined,
        });
        const branchId = activeBranchId || response.user.branchId || response.user.allowedBranchIds?.[0] || null;
        setSessionTokens(response.session.accessToken, response.session.refreshToken);
        await persistElectronSession(response.session.accessToken);
        await setActiveBranch(branchId);
        setUser({
          ...response.user,
          branchId,
        });
        return true;
      } catch {
        clearSessionTokens();
        await persistElectronSession(null);
        await persistElectronBranch(null);
        setUser(null);
        setActiveBranchIdState(null);
        return false;
      }
    })();
    refreshInFlight = run;
    run.finally(() => {
      if (refreshInFlight === run) {
        refreshInFlight = null;
      }
    });
    return run;
  }, [activeBranchId, setActiveBranch]);

  const restoreSession = useCallback(() => {
    if (sessionRestoreInFlight) {
      return sessionRestoreInFlight;
    }
    const run = (async () => {
      try {
        const access = getAccessToken();
        if (!access) {
          if (getRefreshToken()) {
            const ok = await refresh();
            if (ok) {
              return;
            }
          }
          return;
        }
        if (isAccessTokenLikelyExpired(access) && getRefreshToken()) {
          const ok = await refresh();
          if (ok) {
            return;
          }
          clearSessionTokens();
          await persistElectronSession(null);
          setUser(null);
          return;
        }

        const token = access;
        try {
          const me = await httpClient.get<AuthUser>('/auth/me');
          const branchId = me.branchId ?? activeBranchId ?? me.allowedBranchIds?.[0] ?? null;
          if (branchId && me.allowedBranchIds?.length && !me.allowedBranchIds.includes(branchId)) {
            await logout('invalid-branch');
            setSessionExpiredMessage('الفرع المخزن لم يعد مسموحًا لهذا المستخدم. يرجى اختيار فرع جديد.');
            return;
          }
          setUser(me);
          await setActiveBranch(branchId);
          await persistElectronSession(token);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message.includes('branch scope')) {
            await logout('invalid-branch-scope');
            setSessionExpiredMessage('صلاحية الفرع غير متاحة. يرجى إعادة تسجيل الدخول.');
            return;
          }
          const refreshed = await refresh();
          if (!refreshed) {
            clearSessionTokens();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
    sessionRestoreInFlight = run;
    run.finally(() => {
      if (sessionRestoreInFlight === run) {
        sessionRestoreInFlight = null;
      }
    });
    return run;
  }, [activeBranchId, logout, refresh, setActiveBranch]);

  useEffect(() => {
    configureHttpClientAuth({
      getAccessToken,
      getActiveBranchId,
      onUnauthorized: async (message) => {
        if (message?.includes('Invalid or expired access token') || message?.includes('Session expired')) {
          const refreshed = await refresh();
          if (refreshed) return 'retry';
        }
        setSessionExpiredMessage(message || 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا');
        await logout('unauthorized');
      },
      onForbidden: async (message) => {
        if (message?.includes('branch scope')) {
          setSessionExpiredMessage('الفرع الحالي غير مسموح لهذا المستخدم.');
        }
      },
      onConflict: async (message) => {
        void message;
      },
    });
    void restoreSession();
  }, [logout, refresh, restoreSession]);

  useEffect(() => {
    if (activeBranchId) return;
    loadElectronStoredBranch().then((branchId) => {
      if (branchId) {
        setActiveBranchId(branchId);
        setActiveBranchIdState(branchId);
      }
    });
  }, [activeBranchId]);

  const login = useCallback(async (username: string, password: string, selectedBranchId?: string | null) => {
    const response = await httpClient.post<LoginResult>('/auth/login', {
      username,
      password,
      branchId: selectedBranchId || undefined,
    });
    const branchId = selectedBranchId || response.user.branchId || response.user.allowedBranchIds?.[0] || null;
    setSessionTokens(response.session.accessToken, response.session.refreshToken);
    await persistElectronSession(response.session.accessToken);
    await setActiveBranch(branchId);
    setUser({
      ...response.user,
      branchId,
    });
    setSessionExpiredMessage(null);
    // Connect realtime SSE stream after login
    const apiBase = localStorage.getItem('lan.apiBaseUrl') ?? (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4010/api/v1');
    realtimeClient.connect(apiBase, getAccessToken);
    return {
      ...response.user,
      branchId,
    };
  }, [setActiveBranch]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions: user?.permissions || [],
      activeBranchId,
      loading,
      login,
      logout,
      refresh,
      setActiveBranch,
      hasPermission: (permission: string) => Boolean(user?.permissions?.includes(permission)),
      sessionExpiredMessage,
      clearSessionExpiredMessage: () => setSessionExpiredMessage(null),
    }),
    [user, activeBranchId, loading, login, logout, refresh, setActiveBranch, sessionExpiredMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
