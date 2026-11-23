#!/usr/bin/env node
// Crea un usuario directamente en la base D1.
// Uso:
//   node tools/crear-usuario.mjs <usuario> <contraseña> ["Nombre visible"] [--admin] [--remote]
// Sin --remote lo crea en la base LOCAL (pruebas). Con --remote, en la de producción.
import { webcrypto as crypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const isAdmin = args.includes('--admin');
const remote = args.includes('--remote');
const [username, password, displayName] = args.filter((a) => !a.startsWith('--'));

if (!username || !password) {
  console.log('Uso: node tools/crear-usuario.mjs <usuario> <contraseña> ["Nombre visible"] [--admin] [--remote]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString('base64url');
const ITER = 100000; // mismo formato que worker/crypto.js
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
const stored = `pbkdf2$${ITER}$${b64url(salt)}$${b64url(hash)}`;

const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const sql = `INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (${q(username.trim().toLowerCase())}, ${q(stored)}, ${q(displayName)}, ${isAdmin ? 1 : 0});`;

const file = path.join(os.tmpdir(), `smfml-user-${Date.now()}.sql`);
fs.writeFileSync(file, sql);
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'smfml-db', remote ? '--remote' : '--local', `--file=${file}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
fs.unlinkSync(file);
if (r.status === 0) console.log(`\n✅ Usuario "${username}" creado ${isAdmin ? '(administrador) ' : ''}en la base ${remote ? 'de PRODUCCIÓN' : 'local'}.`);
else process.exit(r.status || 1);
