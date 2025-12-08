const API_BASE_URL =
  import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

function getAuthToken(): string | null {
  return localStorage.getItem('authToken');
}

export function clearAuthToken() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authUser');
}

export function storeAuth(token: string, user: { username: string; role: string }) {
  localStorage.setItem('authToken', token);
  localStorage.setItem('authUser', JSON.stringify(user));
}

export function getStoredUser(): { username: string; role: string } | null {
  const stored = localStorage.getItem('authUser');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch (err) {
    console.warn('Failed to parse stored user');
    return null;
  }
}

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

export { API_BASE_URL };
