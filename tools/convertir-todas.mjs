#!/usr/bin/env node
// Convierte TODAS las películas de una carpeta a HLS (usa convertir.mjs para cada una).
// Uso:  node tools/convertir-todas.mjs "C:\PELICULAS" [--gpu auto] [--rapido] [--audio spa|eng]
// - Salida en <carpeta>\salida\<slug>\
// - Si una ya está convertida, la salta (puedes cerrar y volver a abrir: continúa).
// - Al final genera SUBIR_A_R2.bat y CATALOGO.txt (datos para el Panel).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const passthrough = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rapido') passthrough.push('--rapido');
  else if (args[i] === '--audio' || args[i] === '--crf' || args[i] === '--gpu') passthrough.push(args[i], args[++i]);
}
const folder = path.resolve(args.find((a) => !a.startsWith('--') && !passthrough.includes(a)) || path.join(here, '..'));
const outRoot = path.join(folder, 'salida');
const EXT = /\.(mkv|mp4|avi|mov|m4v|webm|ts|wmv)$/i;

// "Los juegos del hambre Sinsajo Parte 1 (2014) Dual 1080p.mkv" -> nombre, año, slug
function parse(file) {
  let base = file.replace(EXT, '').replace(/_/g, ' ');
  const year = (base.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/) || [''])[0].replace(/[()]/g, '') || null;
  let name = base
    .replace(/\((19|20)\d{2}\)/g, '')
    .replace(/\b(dual|latino|lat|castellano|subtitulado|sub|esp|eng|1080p|720p|2160p|4k|uhd|hdr|x264|x265|hevc|bluray|brrip|webrip|web-dl|hdrip)\b/gi, '')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { name, year, slug };
}

const files = fs.readdirSync(folder).filter((f) => EXT.test(f) && fs.statSync(path.join(folder, f)).isFile()).sort();
if (!files.length) {
  console.log(`No encontré videos en ${folder}`);
  process.exit(0);
}

console.log(`\n❤ Series and Movies for My Love — conversión por lotes`);
console.log(`Carpeta: ${folder}\n${files.length} video(s):`);
const items = files.map((f) => ({ file: f, ...parse(f) }));
items.forEach((it, i) => console.log(`  ${i + 1}. ${it.file}\n     → slug: ${it.slug}`));

const ok = [], failed = [];
for (const [i, it] of items.entries()) {
  const master = path.join(outRoot, it.slug, 'master.m3u8');
  console.log(`\n================ ${i + 1}/${items.length}: ${it.name} ================`);
  if (fs.existsSync(master) && fs.existsSync(path.join(outRoot, it.slug, 'info.json'))) {
    console.log('   Ya estaba convertida, la salto.');
    ok.push(it);
    continue;
  }
  const r = spawnSync(process.execPath, [path.join(here, 'convertir.mjs'), path.join(folder, it.file), it.slug, '--salida', outRoot, ...passthrough], { stdio: 'inherit' });
  if (r.status === 0) ok.push(it);
  else failed.push(it);
}

// Archivos de ayuda para los siguientes pasos
for (const it of ok) {
  try { it.duration = JSON.parse(fs.readFileSync(path.join(outRoot, it.slug, 'info.json'), 'utf8')).duration; } catch {}
}
const bat = ['@echo off', 'chcp 65001 >nul', 'echo Subiendo peliculas a Cloudflare R2...', 'cd /d "%~dp0"',
  ...ok.map((it) => `rclone copy "salida\\${it.slug}" r2:smfml-videos/videos/${it.slug} --progress --transfers 16`),
  'echo.', 'echo Listo. Ahora dalas de alta en el Panel (ver CATALOGO.txt).', 'pause'].join('\r\n');
fs.writeFileSync(path.join(folder, 'SUBIR_A_R2.bat'), bat);

const cat = ok.map((it) => [
  `Nombre:        ${it.name}`,
  `Slug:          ${it.slug}`,
  `Año:           ${it.year || ''}`,
  `Carpeta HLS:   videos/${it.slug}`,
  `Póster:        videos/${it.slug}/poster.jpg`,
  `Duración (s):  ${it.duration || ''}`,
].join('\r\n')).join('\r\n\r\n------------------------------------------\r\n\r\n');
fs.writeFileSync(path.join(folder, 'CATALOGO.txt'), `DATOS PARA EL PANEL (Agregar película)\r\n\r\n${cat}\r\n`);

console.log(`\n\n✅ Convertidas: ${ok.length}   ❌ Con error: ${failed.length}`);
failed.forEach((it) => console.log(`   - ${it.file}`));
console.log(`\nSe crearon en ${folder}:`);
console.log(`   SUBIR_A_R2.bat  → doble clic para subirlas (requiere rclone configurado)`);
console.log(`   CATALOGO.txt    → nombre, slug y duración para el Panel\n`);
