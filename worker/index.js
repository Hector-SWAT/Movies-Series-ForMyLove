// Series & Movies For My Love Aleshito — Worker principal
// Sirve: API (/api/*), video protegido desde R2 (/media/*) y el frontend (dist/).
import { makeToken, readToken, hashPassword, checkPassword } from './crypto.js';
import { AwsClient } from 'aws4fetch';

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

// Sitios donde vive el frontend (p. ej. tu dominio de Vercel). Se configuran en wrangler.toml → ALLOWED_ORIGINS
function allowedOrigins(env, url) {
  return new Set([url.origin, ...String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)]);
}

// ¿La petición de video viene de tu página? Revisa Origin (hls.js) o Referer (Safari/iPhone).
function mediaOriginOk(request, env, url) {
  const allowed = allowedOrigins(env, url);
  const origin = request.headers.get('origin');
  if (origin) return allowed.has(origin) ? origin : false;
  const ref = request.headers.get('referer');
  if (ref) {
    try { return allowed.has(new URL(ref).origin) ? true : false; } catch { return false; }
  }
  // Sin Origin ni Referer: solo se permite si el navegador indica que no es de otro sitio
  return isCrossSite(request) ? false : true;
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
    const sql = `SELECT id, slug, name, kind, year, genre, description, poster_key, storage FROM titles
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
    const token = await makeToken(secret(env), { t: 'media', p: prefix, s: v.storage || null, uid: user.id, exp });
    // El token va DENTRO de la ruta: así las rutas relativas de los .m3u8 lo heredan solas.
    return json({
      // URL absoluta del Worker: el video va directo de Cloudflare al navegador (no pasa por Vercel)
      src: `${url.origin}/media/${token}/${prefix}/master.m3u8`,
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

    // Cuentas de almacenamiento configuradas (secretos R2_<NOMBRE>)
    if (path === '/admin/storages' && method === 'GET') {
      const extra = Object.keys(env)
        .filter((k) => /^R2_[A-Z0-9_]+$/.test(k) && k !== 'R2_S3_BASE_OVERRIDE')
        .map((k) => k.slice(3).toLowerCase())
        .sort();
      return json(['principal', ...extra]);
    }

    if (path === '/admin/titles' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.slug || !b.name || !['movie', 'series'].includes(b.kind)) return err(400, 'slug, name y kind (movie|series) son obligatorios');
      const slug = String(b.slug).trim().toLowerCase();
      const storage = cleanStorage(b.storage);
      if (storage === false) return err(400, 'Nombre de cuenta inválido (solo letras, números y _)');
      const r = await env.DB.prepare(
        'INSERT INTO titles (slug, name, kind, year, genre, description, poster_key, storage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(slug, b.name, b.kind, b.year || null, b.genre || null, b.description || null, b.poster_key || null, storage).run();
      const titleId = r.meta.last_row_id;
      // Atajo: para una película se crea su video de una vez
      if (b.kind === 'movie' && b.hls_prefix) {
        await env.DB.prepare('INSERT INTO videos (title_id, hls_prefix, name, duration, storage) VALUES (?, ?, ?, ?, ?)')
          .bind(titleId, b.hls_prefix, b.name, b.duration || null, storage).run();
      }
      return json({ id: titleId }, 201);
    }

    if (path === '/admin/videos' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.title_id || !b.hls_prefix) return err(400, 'title_id y hls_prefix son obligatorios');
      const storage = cleanStorage(b.storage);
      if (storage === false) return err(400, 'Nombre de cuenta inválido (solo letras, números y _)');
      const r = await env.DB.prepare('INSERT INTO videos (title_id, season, episode, name, hls_prefix, duration, storage) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(b.title_id, b.season || null, b.episode || null, b.name || null, b.hls_prefix, b.duration || null, storage).run();
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

// ---------------------------------------------------------------- ALMACENAMIENTO
// "" / null = bucket principal (binding BUCKET). Otro nombre (p. ej. "cuenta2") = bucket de OTRA cuenta
// de Cloudflare, leído por la API S3 con el secreto R2_CUENTA2 = "ACCOUNT_ID|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY"
function cleanStorage(v) {
  if (v == null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'principal') return null;
  const s = String(v).trim().toLowerCase();
  return /^[a-z0-9_]{1,32}$/.test(s) ? s : false;
}

const s3Clients = new Map();
function remoteStorage(env, name) {
  const raw = env[`R2_${name.toUpperCase()}`];
  if (!raw) throw new Error(`Falta el secreto R2_${name.toUpperCase()} (npx wrangler secret put R2_${name.toUpperCase()})`);
  if (!s3Clients.has(raw)) {
    const [accountId, bucket, accessKeyId, secretAccessKey] = raw.split('|').map((x) => x.trim());
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(`R2_${name.toUpperCase()} debe tener el formato ACCOUNT_ID|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY`);
    }
    s3Clients.set(raw, {
      base: env.R2_S3_BASE_OVERRIDE ? `${env.R2_S3_BASE_OVERRIDE}/${bucket}` : `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
      client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
    });
  }
  return s3Clients.get(raw);
}

// Lee un objeto del bucket que corresponda. Devuelve { status, headers, body } listo para responder.
async function readObject(env, storage, key, request) {
  if (!storage) {
    const obj = request.method === 'HEAD'
      ? await env.BUCKET.head(key)
      : await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
    if (!obj) return null;
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    if (!('body' in obj) || obj.body === undefined) {
      headers.set('content-length', String(obj.size));
      return { status: request.method === 'HEAD' ? 200 : 304, headers, body: null };
    }
    if (obj.range && request.headers.has('range')) {
      const { offset = 0, length = obj.size - offset } = obj.range;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set('content-length', String(length));
      return { status: 206, headers, body: obj.body };
    }
    headers.set('content-length', String(obj.size));
    return { status: 200, headers, body: obj.body };
  }

  // Bucket de otra cuenta (API S3 de R2)
  const { base, client } = remoteStorage(env, storage);
  const fwd = {};
  for (const h of ['range', 'if-none-match', 'if-modified-since']) {
    const v = request.headers.get(h);
    if (v) fwd[h] = v;
  }
  const path = key.split('/').map(encodeURIComponent).join('/');
  const res = await client.fetch(`${base}/${path}`, { method: request.method, headers: fwd });
  if (res.status === 404) return null;
  if (![200, 206, 304].includes(res.status)) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Bucket "${storage}" respondió ${res.status}: ${detail.slice(0, 200)}`);
  }
  const headers = new Headers();
  for (const h of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return { status: res.status, headers, body: request.method === 'HEAD' ? null : res.body };
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
  const originCheck = mediaOriginOk(request, env, url);
  const cors = {};
  if (typeof originCheck === 'string') {
    cors['access-control-allow-origin'] = originCheck;
    cors['access-control-expose-headers'] = 'content-length, content-range, accept-ranges';
    cors['vary'] = 'Origin';
  }
  if (request.method === 'OPTIONS') {
    if (!originCheck) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'range', 'access-control-max-age': '86400' },
    });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Método no permitido', { status: 405 });
  if (!originCheck) return new Response('Prohibido', { status: 403 });

  // /media/poster/<key>  -> pósters (solo requiere sesión)
  // /media/<token>/<key> -> video (requiere sesión + URL firmada vigente para esa carpeta)
  const rest = url.pathname.replace(/^\/media\//, '');
  const slash = rest.indexOf('/');
  if (slash < 0) return new Response('No encontrado', { status: 404 });
  const first = rest.slice(0, slash);
  const key = decodeURIComponent(rest.slice(slash + 1));
  if (key.includes('..')) return new Response('Ruta inválida', { status: 400 });

  let storage = null;
  if (first === 'poster') {
    // Pósters: requieren la cookie de sesión (en Vercel llegan por el proxy de vercel.json)
    const user = await currentUser(request, env);
    if (!user) return new Response('Inicia sesión', { status: 401, headers: cors });
    if (!/\.(jpe?g|png|webp)$/i.test(key)) return new Response('Prohibido', { status: 403, headers: cors });
    const row = await env.DB.prepare('SELECT storage FROM titles WHERE poster_key = ? LIMIT 1').bind(key).first();
    storage = row?.storage || null;
  } else {
    // Video: la URL firmada (por usuario, carpeta y con caducidad) es la autorización
    const t = await readToken(secret(env), first);
    if (!t || t.t !== 'media' || !key.startsWith(t.p + '/')) {
      return new Response('URL expirada o inválida', { status: 403, headers: cors });
    }
    storage = t.s || null;
  }

  const obj = await readObject(env, storage, key, request);
  if (!obj) return new Response('No encontrado', { status: 404, headers: cors });

  const headers = obj.headers;
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  headers.set('accept-ranges', 'bytes');
  const ext = key.split('.').pop().toLowerCase();
  if (TYPES[ext]) headers.set('content-type', TYPES[ext]);
  // Playlists: sin caché; segmentos y pósters: caché privada en el navegador
  headers.set('cache-control', ext === 'm3u8' ? 'private, no-cache' : 'private, max-age=86400');
  return new Response(obj.body, { status: obj.status, headers });
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
