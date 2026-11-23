// Utilidades criptográficas con Web Crypto (disponible en Cloudflare Workers).
const enc = new TextEncoder();

export function b64url(bytes) {
  let s = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(secret, data) {
  const key = await hmacKey(secret);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function verify(secret, data, sig) {
  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify('HMAC', key, fromB64url(sig), enc.encode(data));
  } catch {
    return false;
  }
}

/** Token compacto: base64url(json).firma  — se usa para la sesión y para URLs de video. */
export async function makeToken(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await sign(secret, body)}`;
}

export async function readToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !(await verify(secret, body, sig))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Contraseñas: PBKDF2-SHA256, 100 000 iteraciones (máximo que permite Workers).
// Formato: pbkdf2$<iteraciones>$<salt>$<hash>
const ITER = 100000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function checkPassword(password, stored) {
  const [alg, iter, salt, hash] = (stored || '').split('$');
  if (alg !== 'pbkdf2') return false;
  const calc = b64url(await pbkdf2(password, fromB64url(salt), Number(iter)));
  // comparación en tiempo constante
  if (calc.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
