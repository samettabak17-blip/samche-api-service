import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { session } from '../../lib/session';
import type { AuthUser, LoginResponse } from '../../types/api';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login(email: string, password: string): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');

  const clearSession = useCallback(() => {
    session.clear();
    queryClient.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, [queryClient]);

  const restoreSession = useCallback(async () => {
    if (!session.getToken()) {
      setStatus('unauthenticated');
      return;
    }

    try {
      const response = await apiClient.get<{ user: AuthUser }>('/api/v1/auth/me');
      setUser(response.user);
      setStatus('authenticated');
    } catch {
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    apiClient.setUnauthorizedHandler(clearSession);
    void restoreSession();

    return () => apiClient.setUnauthorizedHandler(undefined);
  }, [clearSession, restoreSession]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.post<LoginResponse>('/api/v1/auth/login', { email, password });
    session.setToken(response.token);

    try {
      const me = await apiClient.get<{ user: AuthUser }>('/api/v1/auth/me');
      setUser(me.user);
      setStatus('authenticated');
    } catch (error) {
      clearSession();
      throw error;
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => ({ user, status, login, logout: clearSession }), [clearSession, login, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}

