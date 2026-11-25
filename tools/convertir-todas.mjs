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
let outArg = null; // --salida "C:\PELICULAS\salida"
const solo = []; // --solo "texto": convierte solo los archivos cuyo nombre contenga ese texto
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--solo') { solo.push(args[++i].toLowerCase()); args[i] = '--x'; continue; }
  if (args[i] === '--salida') { outArg = args[++i]; args[i] = '--x'; continue; }
  if (args[i] === '--rapido') passthrough.push('--rapido');
  else if (args[i] === '--audio' || args[i] === '--crf' || args[i] === '--gpu') passthrough.push(args[i], args[++i]);
}
const folder = path.resolve(args.find((a, i) => !a.startsWith('--') && !passthrough.includes(a)) || path.join(here, '..'));
const outRoot = path.resolve(outArg || path.join(folder, 'salida'));
const helpDir = path.dirname(outRoot); // aquí se escriben SUBIR_A_R2.bat y CATALOGO.txt
const EXT = /\.(mkv|mp4|avi|mov|m4v|webm|ts|wmv)$/i;

// "Los juegos del hambre Sinsajo Parte 1 (2014) Dual 1080p.mkv" -> nombre, año, slug
const slugify = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Series: "The Snoopy Show (2021) - S01E01 - Happiness Is a Dancing Dog.mkv"
//   -> serie "The Snoopy Show", T1 E1, episodio "Happiness Is a Dancing Dog", slug "the-snoopy-show-t1e01"
function parseEpisode(file) {
  const base = file.replace(EXT, '').replace(/_/g, ' ');
  const m = base.match(/^(.*?)[\s.\-]*\bS(\d{1,2})\s*E(\d{1,3})\b[\s.\-]*(.*)$/i);
  if (!m) return null;
  const year = (m[1].match(/\((19|20)\d{2}\)/) || [''])[0].replace(/[()]/g, '') || null;
  const show = m[1].replace(/\((19|20)\d{2}\)/g, '').replace(/[\s.\-]+$/, '').trim();
  const season = Number(m[2]), episode = Number(m[3]);
  const epName = m[4].replace(/\b(1080p|720p|2160p|x264|x265|hevc|web-?dl|webrip|bluray|dual|latino)\b.*$/i, '').replace(/[\s.\-]+$/, '').trim();
  return {
    series: true, show, year, season, episode, epName,
    name: show, showSlug: slugify(show),
    slug: `${slugify(show)}-t${season}e${String(episode).padStart(2, '0')}`,
  };
}

function parse(file) {
  const ep = parseEpisode(file);
  if (ep) return ep;
  let base = file.replace(EXT, '').replace(/_/g, ' ');
  const year = (base.match(/\((19|20)\d{2}\)|\b(19|20)\d{2}\b/) || [''])[0].replace(/[()]/g, '') || null;
  let name = base
    .replace(/\((19|20)\d{2}\)/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\b(imax|dual|latino|lat|castellano|subtitulado|sub|esp|eng|1080p|720p|2160p|4k|uhd|hdr|x264|x265|hevc|bluray|brrip|webrip|web-dl|hdrip)\b/gi, '')
    .replace(/\s+-\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const slug = slugify(name);
  return { name, year, slug };
}

const files = fs.readdirSync(folder)
  .filter((f) => EXT.test(f) && fs.statSync(path.join(folder, f)).isFile())
  .filter((f) => !solo.length || solo.some((t) => f.toLowerCase().includes(t)))
  .sort();
if (!files.length) {
  console.log(`No encontré videos en ${folder}`);
  process.exit(0);
}

console.log(`\n❤ Series and Movies for My Love — conversión por lotes`);
console.log(`Carpeta: ${folder}\n${files.length} video(s):`);
const items = files.map((f) => ({ file: f, ...parse(f) }));
items.forEach((it, i) => console.log(`  ${i + 1}. ${it.file}\n     → ${it.series ? `serie "${it.show}" T${it.season} E${it.episode}, ` : ''}slug: ${it.slug}`));

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

// Archivos de ayuda: incluyen TODAS las películas terminadas en salida\ (no solo las de esta vez)
const done = [];
for (const dir of fs.existsSync(outRoot) ? fs.readdirSync(outRoot) : []) {
  try {
    if (!fs.existsSync(path.join(outRoot, dir, 'master.m3u8'))) continue;
    const inf = JSON.parse(fs.readFileSync(path.join(outRoot, dir, 'info.json'), 'utf8'));
    const p = parse(inf.original || dir);
    done.push({ ...p, slug: dir, name: p.name || dir, duration: inf.duration });
  } catch {}
}
const bat = [
  '@echo off', 'chcp 65001 >nul', 'title Subir peliculas a Cloudflare R2', 'cd /d "%~dp0"',
  'rem Uso: SUBIR_A_R2.bat            -> sube a la cuenta principal (remoto r2)',
  'rem      SUBIR_A_R2.bat r2cuenta2  -> sube a otra cuenta',
  'set REMOTO=%~1', 'if "%REMOTO%"=="" set REMOTO=r2',
  'where rclone >nul 2>nul', 'if errorlevel 1 ( echo Falta rclone: winget install -e --id Rclone.Rclone & pause & exit /b )',
  'rclone listremotes | findstr /b /c:"%REMOTO%:" >nul',
  'if errorlevel 1 ( echo No existe la conexion "%REMOTO%" en rclone. Configurala con: rclone config create %REMOTO% s3 ... & pause & exit /b )',
  'echo Subiendo a %REMOTO%:smfml-videos solo lo TERMINADO...',
  `for /d %%D in ("${path.basename(outRoot)}\\*") do (`,
  '  if exist "%%D\\info.json" (',
  '    echo ==== %%~nxD ====',
  '    rclone copy "%%D" "%REMOTO%:smfml-videos/videos/%%~nxD" --progress --transfers 16 --checkers 32',
  '  ) else ( echo ---- Saltando %%~nxD: todavia no termina )',
  ')',
  'echo.', 'echo Listo. Datos para el Panel en CATALOGO.txt', 'pause',
].join('\r\n');
fs.writeFileSync(path.join(helpDir, 'SUBIR_A_R2.bat'), bat);

const movies = done.filter((d) => !d.series);
const seriesMap = new Map();
for (const d of done.filter((d) => d.series)) {
  if (!seriesMap.has(d.showSlug)) seriesMap.set(d.showSlug, { show: d.show, year: d.year, eps: [] });
  seriesMap.get(d.showSlug).eps.push(d);
}
const L = [];
L.push('DATOS PARA EL PANEL', '');
if (movies.length) {
  L.push('=========== PELÍCULAS  (Panel → Agregar película o serie, Tipo: Película) ===========', '');
  for (const it of movies) {
    L.push(`Nombre:        ${it.name}`, `Slug:          ${it.slug}`, `Año:           ${it.year || ''}`,
      `Carpeta HLS:   videos/${it.slug}`, `Póster:        videos/${it.slug}/poster.jpg`, `Duración (s):  ${it.duration || ''}`, '');
  }
}
for (const [showSlug, sr] of seriesMap) {
  sr.eps.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const first = sr.eps[0];
  L.push(`=========== SERIE: ${sr.show} ===========`, '',
    '1) Panel → Agregar película o serie:',
    '   Tipo:    Serie',
    `   Nombre:  ${sr.show}`,
    `   Slug:    ${showSlug}`,
    `   Año:     ${sr.year || ''}`,
    `   Póster:  videos/${first.slug}/poster.jpg`, '',
    '2) Panel → Agregar episodio a una serie (uno por renglón):', '',
    '   Temp | Ep | Nombre del episodio | Carpeta HLS | Duración (s)');
  for (const e of sr.eps) L.push(`   ${e.season} | ${e.episode} | ${e.epName} | videos/${e.slug} | ${e.duration || ''}`);
  L.push('');
}
fs.writeFileSync(path.join(helpDir, 'CATALOGO.txt'), L.join('\r\n'));

console.log(`\n\n✅ Convertidas: ${ok.length}   ❌ Con error: ${failed.length}`);
failed.forEach((it) => console.log(`   - ${it.file}`));
console.log(`\nSe crearon en ${helpDir}:`);
console.log(`   SUBIR_A_R2.bat  → doble clic para subir a la cuenta principal; "SUBIR_A_R2.bat r2cuenta2" para otra cuenta`);
console.log(`   CATALOGO.txt    → nombre, slug y duración para el Panel\n`);
