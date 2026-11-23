// Series and Movies for My Love — Worker principal
// Sirve: API (/api/*), video protegido desde R2 (/media/*) y el frontend (dist/).
import { makeToken, readToken, hashPassword, checkPassword } from './crypto.js';

const COOKIE = 'smfml_session';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const err = (status, message) => json({ error: message }, status);

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function secret(env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new Error('Falta AUTH_SECRET (mínimo 32 caracteres). Usa: npx wrangler secret put AUTH_SECRET');
  }
  return env.AUTH_SECRET;
}

async function currentUser(request, env) {
  const payload = await readToken(secret(env), getCookie(request, COOKIE));
  if (!payload || payload.t !== 'session') return null;
  return env.DB.prepare('SELECT id, username, display_name, is_admin FROM users WHERE id = ?').bind(payload.uid).first();
}

// Bloquea peticiones que vienen de OTRO sitio (hotlinking / embeber en otra página).
function isCrossSite(request) {
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site';
}

// ---------------------------------------------------------------- API
async function handleApi(request, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  if (isCrossSite(request)) return err(403, 'Origen no permitido');

  // --- Login
  if (path === '/auth/login' && method === 'POST') {
    const { username, password } = await request.json().catch(() => ({}));
    if (!username || !password) return err(400, 'Usuario y contraseña requeridos');
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(username).trim().toLowerCase()).first();
    if (!user || !(await checkPassword(password, user.password_hash))) return err(401, 'Usuario o contraseña incorrectos');
    const days = Number(env.SESSION_DAYS || 30);
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const token = await makeToken(secret(env), { t: 'session', uid: user.id, exp });
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return json(
      { id: user.id, username: user.username, display_name: user.display_name, is_admin: !!user.is_admin },
      200,
      { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${days * 86400}${secure}` },
    );
  }

  if (path === '/auth/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
  }

  // --- Todo lo demás requiere sesión
  const user = await currentUser(request, env);
  if (!user) return err(401, 'Inicia sesión');

  if (path === '/auth/me') return json({ ...user, is_admin: !!user.is_admin });

  // Catálogo (con búsqueda opcional ?q=)
  if (path === '/titles' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const sql = `SELECT id, slug, name, kind, year, genre, description, poster_key FROM titles
                 ${q ? 'WHERE name LIKE ?1 OR genre LIKE ?1 OR description LIKE ?1' : ''}
                 ORDER BY created_at DESC`;
    const stmt = q ? env.DB.prepare(sql).bind(`%${q}%`) : env.DB.prepare(sql);
    const { results } = await stmt.all();
    return json(results);
  }

  const titleMatch = path.match(/^\/titles\/(\d+)$/);
  if (titleMatch && method === 'GET') {
    const id = Number(titleMatch[1]);
    const title = await env.DB.prepare('SELECT * FROM titles WHERE id = ?').bind(id).first();
    if (!title) return err(404, 'No encontrado');
    const { results: videos } = await env.DB.prepare(
      `SELECT v.id, v.season, v.episode, v.name, v.duration, p.position, p.duration AS watched_duration
       FROM videos v LEFT JOIN progress p ON p.video_id = v.id AND p.user_id = ?
       WHERE v.title_id = ? ORDER BY v.season, v.episode, v.id`,
    ).bind(user.id, id).all();
    return json({ ...title, videos });
  }

  // Pedir permiso para reproducir: devuelve URL firmada temporal
  const playMatch = path.match(/^\/videos\/(\d+)\/play$/);
  if (playMatch && method === 'GET') {
    const id = Number(playMatch[1]);
    const v = await env.DB.prepare(
      `SELECT v.*, t.name AS title_name, t.kind, t.id AS title_id, p.position
       FROM videos v JOIN titles t ON t.id = v.title_id
       LEFT JOIN progress p ON p.video_id = v.id AND p.user_id = ?
       WHERE v.id = ?`,
    ).bind(user.id, id).first();
    if (!v) return err(404, 'Video no encontrado');
    const prefix = v.hls_prefix.replace(/\/+$/, '');
    const exp = Math.floor(Date.now() / 1000) + Number(env.MEDIA_TOKEN_HOURS || 6) * 3600;
    const token = await makeToken(secret(env), { t: 'media', p: prefix, uid: user.id, exp });
    // El token va DENTRO de la ruta: así las rutas relativas de los .m3u8 lo heredan solas.
    return json({
      src: `/media/${token}/${prefix}/master.m3u8`,
      video: { id: v.id, name: v.name, season: v.season, episode: v.episode, title_id: v.title_id, title_name: v.title_name, kind: v.kind },
      resume_at: v.position || 0,
    });
  }

  // Guardar progreso
  if (path === '/progress' && method === 'POST') {
    const { video_id, position, duration } = await request.json().catch(() => ({}));
    if (!video_id || typeof position !== 'number') return err(400, 'Datos inválidos');
    await env.DB.prepare(
      `INSERT INTO progress (user_id, video_id, position, duration, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, video_id) DO UPDATE SET position = excluded.position, duration = excluded.duration, updated_at = excluded.updated_at`,
    ).bind(user.id, video_id, position, duration ?? null).run();
    return json({ ok: true });
  }

  // "Seguir viendo": lo último que no se terminó (menos del 95 %)
  if (path === '/progress' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT p.video_id, p.position, p.duration, p.updated_at, v.season, v.episode, v.name AS video_name,
              t.id AS title_id, t.name, t.kind, t.poster_key
       FROM progress p JOIN videos v ON v.id = p.video_id JOIN titles t ON t.id = v.title_id
       WHERE p.user_id = ? AND p.position > 30 AND (p.duration IS NULL OR p.position < p.duration * 0.95)
       ORDER BY p.updated_at DESC LIMIT 20`,
    ).bind(user.id).all();
    return json(results);
  }

  // ------------------------------------------------ Administración
  if (path.startsWith('/admin/')) {
    if (!user.is_admin) return err(403, 'Solo administradores');

    if (path === '/admin/titles' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.slug || !b.name || !['movie', 'series'].includes(b.kind)) return err(400, 'slug, name y kind (movie|series) son obligatorios');
      const slug = String(b.slug).trim().toLowerCase();
      const r = await env.DB.prepare(
        'INSERT INTO titles (slug, name, kind, year, genre, description, poster_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(slug, b.name, b.kind, b.year || null, b.genre || null, b.description || null, b.poster_key || null).run();
      const titleId = r.meta.last_row_id;
      // Atajo: para una película se crea su video de una vez
      if (b.kind === 'movie' && b.hls_prefix) {
        await env.DB.prepare('INSERT INTO videos (title_id, hls_prefix, name, duration) VALUES (?, ?, ?, ?)')
          .bind(titleId, b.hls_prefix, b.name, b.duration || null).run();
      }
      return json({ id: titleId }, 201);
    }

    if (path === '/admin/videos' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.title_id || !b.hls_prefix) return err(400, 'title_id y hls_prefix son obligatorios');
      const r = await env.DB.prepare('INSERT INTO videos (title_id, season, episode, name, hls_prefix, duration) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(b.title_id, b.season || null, b.episode || null, b.name || null, b.hls_prefix, b.duration || null).run();
      return json({ id: r.meta.last_row_id }, 201);
    }

    const delMatch = path.match(/^\/admin\/titles\/(\d+)$/);
    if (delMatch && method === 'DELETE') {
      const id = Number(delMatch[1]);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM progress WHERE video_id IN (SELECT id FROM videos WHERE title_id = ?)').bind(id),
        env.DB.prepare('DELETE FROM videos WHERE title_id = ?').bind(id),
        env.DB.prepare('DELETE FROM titles WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }

    if (path === '/admin/users' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.username || !b.password || b.password.length < 8) return err(400, 'Usuario y contraseña (mín. 8 caracteres) obligatorios');
      try {
        const r = await env.DB.prepare('INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)')
          .bind(String(b.username).trim().toLowerCase(), await hashPassword(b.password), b.display_name || null, b.is_admin ? 1 : 0).run();
        return json({ id: r.meta.last_row_id }, 201);
      } catch {
        return err(409, 'Ese usuario ya existe');
      }
    }
  }

  return err(404, 'Ruta no encontrada');
}

// ---------------------------------------------------------------- MEDIA (R2)
const TYPES = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  vtt: 'text/vtt; charset=utf-8',
};

async function handleMedia(request, env, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Método no permitido', { status: 405 });
  if (isCrossSite(request)) return new Response('Prohibido', { status: 403 });

  // /media/poster/<key>  -> pósters (solo requiere sesión)
  // /media/<token>/<key> -> video (requiere sesión + URL firmada vigente para esa carpeta)
  const rest = url.pathname.replace(/^\/media\//, '');
  const slash = rest.indexOf('/');
  if (slash < 0) return new Response('No encontrado', { status: 404 });
  const first = rest.slice(0, slash);
  const key = decodeURIComponent(rest.slice(slash + 1));
  if (key.includes('..')) return new Response('Ruta inválida', { status: 400 });

  const user = await currentUser(request, env);
  if (!user) return new Response('Inicia sesión', { status: 401 });

  if (first === 'poster') {
    if (!/\.(jpe?g|png|webp)$/i.test(key)) return new Response('Prohibido', { status: 403 });
  } else {
    const t = await readToken(secret(env), first);
    if (!t || t.t !== 'media' || t.uid !== user.id || !key.startsWith(t.p + '/')) {
      return new Response('URL expirada o inválida', { status: 403 });
    }
  }

  const obj = request.method === 'HEAD'
    ? await env.BUCKET.head(key)
    : await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('No encontrado', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  const ext = key.split('.').pop().toLowerCase();
  if (TYPES[ext]) headers.set('content-type', TYPES[ext]);
  // Playlists: sin caché; segmentos y pósters: caché privada en el navegador
  headers.set('cache-control', ext === 'm3u8' ? 'private, no-cache' : 'private, max-age=86400');

  if (!('body' in obj) || obj.body === undefined) {
    // HEAD o condicional "not modified"
    headers.set('content-length', String(obj.size));
    return new Response(null, { status: request.method === 'HEAD' ? 200 : 304, headers });
  }

  let status = 200;
  if (obj.range && request.headers.has('range')) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    status = 206;
  } else {
    headers.set('content-length', String(obj.size));
  }
  return new Response(obj.body, { status, headers });
}

// ---------------------------------------------------------------- ENTRADA
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (url.pathname.startsWith('/media/')) return await handleMedia(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return err(500, e.message || 'Error interno');
    }
  },
};
