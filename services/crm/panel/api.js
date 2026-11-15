const TOKEN_KEY = 'rota-crm-token';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// sessionStorage: the token disappears when the tab closes. It can be unavailable (privacy modes).
export const session = {
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* keep going without persistence */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function api(path, { method = 'GET', body, query, token = session.get() } = {}) {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const error = data?.error ?? {};
    throw new ApiError(response.status, error.code ?? 'UNKNOWN', error.message ?? 'İstek başarısız.', error.details);
  }
  return data;
}
