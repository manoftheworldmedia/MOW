/** Thin API client. Persists the JWT in localStorage and attaches it. */
const TOKEN_KEY = 'mow_cms_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; err.errors = data.errors; err.code = data.code;
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) => req('POST', '/api/auth/login', { email, password }),
  me: () => req('GET', '/api/auth/me'),

  projects: () => req('GET', '/api/projects'),
  createProject: (p) => req('POST', '/api/projects', p),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),
  verifyProject: (id) => req('GET', `/api/projects/${id}/verify`),

  schemas: (pid) => req('GET', `/api/projects/${pid}/schemas`),

  content: (pid, name) => req('GET', `/api/projects/${pid}/content/${name}`),
  doc: (pid, name, path) => req('GET', `/api/projects/${pid}/content/${name}/doc${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  validate: (pid, name, value) => req('POST', `/api/projects/${pid}/content/${name}/validate`, { value }),
  stage: (pid, name, payload) => req('POST', `/api/projects/${pid}/content/${name}/stage`, payload),

  staged: (pid) => req('GET', `/api/projects/${pid}/staged`),
  unstage: (pid, path) => req('DELETE', `/api/projects/${pid}/staged${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  stagedDiff: (pid, path) => req('POST', `/api/projects/${pid}/staged/diff`, { path }),
  publish: (pid, message) => req('POST', `/api/projects/${pid}/publish`, { message }),

  revisions: (pid, path) => req('GET', `/api/projects/${pid}/revisions${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  rollback: (pid, path, sha) => req('POST', `/api/projects/${pid}/rollback`, { path, sha }),

  users: () => req('GET', '/api/users'),
  createUser: (u) => req('POST', '/api/users', u),
  updateUser: (id, p) => req('PATCH', `/api/users/${id}`, p),
  deleteUser: (id) => req('DELETE', `/api/users/${id}`),
};
