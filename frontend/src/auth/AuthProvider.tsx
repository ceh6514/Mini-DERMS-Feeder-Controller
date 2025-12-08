import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthContextValue,
  AuthUser,
  clearPersistedAuth,
  loadPersistedAuth,
  loginRequest,
  persistAuth,
} from '../api/auth';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const persisted = loadPersistedAuth();
    if (persisted.user) {
      setUser(persisted.user);
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const { token, user: authenticatedUser } = await loginRequest(username, password);
    persistAuth(token, authenticatedUser);
    setUser(authenticatedUser);
  };

  const logout = () => {
    clearPersistedAuth();
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(() => ({ user, loading, login, logout }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
