export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const TOKEN_KEY = 'construction_erp_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// G-013: revoke the session server-side (best effort) before dropping the local token.
export async function logout() {
  const token = getToken();
  if (token) {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  }
  clearToken();
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `API request failed: ${response.status} ${response.statusText}`);
  }
  return payload as T;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  return request<T>(path);
}

export async function apiPost<T = any>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPatch<T = any>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function apiPut<T = any>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export async function apiBootstrapAdmin(body: unknown, bootstrapToken: string): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/auth/bootstrap-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bootstrap-token': bootstrapToken
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `Bootstrap failed: ${response.status} ${response.statusText}`);
  return payload;
}

type ApiClient = {
  <T = any>(path: string): Promise<T>;
  get: typeof apiGet;
  post: typeof apiPost;
  patch: typeof apiPatch;
  put: typeof apiPut;
  delete: typeof apiDelete;
};

export const api: ApiClient = Object.assign(
  <T = any>(path: string) => apiGet<T>(path),
  {
    get: apiGet,
    post: apiPost,
    patch: apiPatch,
    put: apiPut,
    delete: apiDelete
  }
);
