// Cliente de la API (misma URL del sitio; la cookie de sesión viaja sola)
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  me: () => request('/auth/me'),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  titles: (q = '') => request(`/titles${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  title: (id) => request(`/titles/${id}`),
  play: (videoId) => request(`/videos/${videoId}/play`),
  saveProgress: (video_id, position, duration) => request('/progress', { method: 'POST', body: { video_id, position, duration } }),
  continueWatching: () => request('/progress'),
  createTitle: (data) => request('/admin/titles', { method: 'POST', body: data }),
  createVideo: (data) => request('/admin/videos', { method: 'POST', body: data }),
  deleteTitle: (id) => request(`/admin/titles/${id}`, { method: 'DELETE' }),
  storages: () => request('/admin/storages'),
  createUser: (data) => request('/admin/users', { method: 'POST', body: data }),
};

export const posterUrl = (key) => (key ? `/media/poster/${key}` : null);

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
