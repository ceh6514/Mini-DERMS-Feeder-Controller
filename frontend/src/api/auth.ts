import { API_BASE_URL, authFetch, clearAuthToken, getStoredUser, storeAuth } from './http';

export type UserRole = 'viewer' | 'operator' | 'admin';

export interface AuthUser {
  username: string;
  role: UserRole;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export async function loginRequest(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await authFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Login failed');
  }

  return res.json();
}

export function persistAuth(token: string, user: AuthUser) {
  storeAuth(token, user);
}

export function loadPersistedAuth(): { token: string | null; user: AuthUser | null } {
  return { token: localStorage.getItem('authToken'), user: getStoredUser() as AuthUser | null };
}

export function clearPersistedAuth() {
  clearAuthToken();
}

export { API_BASE_URL };
