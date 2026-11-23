#!/usr/bin/env node
// Convierte una película a HLS adaptativo (varias calidades) + póster, listo para subir a R2.
//
// Uso:
//   node tools/convertir.mjs "<archivo de video>" <slug> [--salida carpeta] [--rapido] [--crf 18]
//
// Ejemplo (Windows):
//   node tools/convertir.mjs "C:\Peliculas\Titanic (1997).mkv" titanic
//
// Resultado:  salida/titanic/
//   master.m3u8              <- lista maestra (la que abre el reproductor)
//   1080p/index.m3u8 + seg_*.ts
//   720p/...  480p/...
//   poster.jpg               <- miniatura
//   info.json                <- duración y datos para darlo de alta en el panel
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};

const outRoot = opt('--salida', 'salida');
const crfTop = Number(opt('--crf', '18'));
const fast = flag('--rapido');
const [input, rawSlug] = args;

if (!input || !rawSlug) {
  console.log('Uso: node tools/convertir.mjs "<archivo de video>" <slug> [--salida carpeta] [--rapido] [--crf 18]');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`No existe el archivo: ${input}`);
  process.exit(1);
}
const slug = rawSlug.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

for (const bin of ['ffmpeg', 'ffprobe']) {
  if (spawnSync(bin, ['-version']).error) {
    console.error(`No encuentro "${bin}". Instálalo (winget install Gyan.FFmpeg) y reabre la terminal.`);
    process.exit(1);
  }
}

// --- 1. Analizar el archivo original
const probe = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('ffprobe no pudo leer el archivo:\n' + probe.stderr);
  process.exit(1);
}
const info = JSON.parse(probe.stdout);
const vStream = info.streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
const aStream = info.streams.find((s) => s.codec_type === 'audio');
if (!vStream) {
  console.error('El archivo no tiene pista de video.');
  process.exit(1);
}
const duration = Math.round(Number(info.format.duration || vStream.duration || 0));
const srcH = vStream.height;
const srcW = vStream.width;

// --- 2. Escalera de calidades (nunca se agranda por encima del original)
//  altura, bitrate máximo de video, CRF
const LADDER = [
  [2160, 16000, crfTop + 2],
  [1440, 10000, crfTop + 1],
  [1080, 7000, crfTop],
  [720, 3500, crfTop + 3],
  [480, 1600, crfTop + 5],
];
let renditions = LADDER.filter(([h]) => h <= srcH);
if (!renditions.length || renditions[0][0] < srcH) {
  // Resolución "rara" (p. ej. 800p o 360p): la calidad superior es la original
  const even = srcH - (srcH % 2);
  const bitrate = Math.max(1200, Math.round((even / 1080) * 7000));
  renditions.unshift([even, bitrate, crfTop]);
}
renditions = renditions.slice(0, 4);

const outDir = path.join(outRoot, slug);
fs.mkdirSync(outDir, { recursive: true });

console.log(`\n🎬 ${path.basename(input)}`);
console.log(`   Original: ${srcW}x${srcH}, ${Math.floor(duration / 60)} min, audio: ${aStream ? aStream.codec_name + ' ' + (aStream.channels || '?') + 'ch' : 'sin audio'}`);
console.log(`   Calidades: ${renditions.map(([h]) => h + 'p').join(', ')}  (${fast ? 'modo rápido' : 'preset slow, máxima calidad'})`);
console.log(`   Salida: ${outDir}\n`);

// --- 3. Comando ffmpeg con todas las calidades en una sola pasada
const n = renditions.length;
const split = `[0:v:0]split=${n}${renditions.map((_, i) => `[v${i}]`).join('')}`;
const scales = renditions.map(([h], i) => `[v${i}]scale=-2:${h}:flags=lanczos,format=yuv420p[v${i}o]`).join(';');

const ff = ['-hide_banner', '-y', '-i', input, '-filter_complex', `${split};${scales}`];
renditions.forEach(([h, maxrate, crf], i) => {
  ff.push('-map', `[v${i}o]`,
    `-c:v:${i}`, 'libx264', `-crf:v:${i}`, String(crf),
    `-maxrate:v:${i}`, `${maxrate}k`, `-bufsize:v:${i}`, `${maxrate * 2}k`,
    `-profile:v:${i}`, 'high');
});
if (aStream) {
  renditions.forEach(() => ff.push('-map', '0:a:0'));
  ff.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000');
}
ff.push(
  '-preset', fast ? 'veryfast' : 'slow',
  '-force_key_frames', 'expr:gte(t,n_forced*6)', '-sc_threshold', '0',
  '-sn', '-dn',
  '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
  '-hls_segment_filename', path.join(outDir, '%v', 'seg_%05d.ts'),
  '-master_pl_name', 'master.m3u8',
  '-var_stream_map', renditions.map(([h], i) => (aStream ? `v:${i},a:${i},name:${h}p` : `v:${i},name:${h}p`)).join(' '),
  '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
  path.join(outDir, '%v', 'index.m3u8'),
);

const started = Date.now();
await new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ff, { stdio: ['ignore', 'pipe', 'pipe'] });
  let errText = '';
  p.stderr.on('data', (d) => (errText += d));
  p.stdout.on('data', (d) => {
    const m = String(d).match(/out_time_ms=(\d+)/g);
    if (m && duration) {
      const t = Number(m[m.length - 1].split('=')[1]) / 1e6;
      const pct = Math.min(100, (t / duration) * 100);
      const elapsed = (Date.now() - started) / 1000;
      const eta = pct > 0.5 ? Math.round((elapsed / pct) * (100 - pct) / 60) : '?';
      process.stdout.write(`\r   Convirtiendo… ${pct.toFixed(1)} %   (faltan ~${eta} min)   `);
    }
  });
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errText || `ffmpeg terminó con código ${code}`))));
}).catch((e) => {
  console.error('\n❌ Error de ffmpeg:\n' + e.message);
  process.exit(1);
});

// --- 4. Póster (cuadro al 15 % de la película)
const at = Math.max(1, Math.round(duration * 0.15));
spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', input,
  '-frames:v', '1', '-vf', 'scale=1280:-2,format=yuvj420p', '-q:v', '3', path.join(outDir, 'poster.jpg')]);

// --- 5. Resumen
const sizeOf = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((acc, e) => acc + (e.isDirectory() ? sizeOf(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const gb = sizeOf(outDir) / 1024 ** 3;
const meta = {
  slug,
  hls_prefix: `videos/${slug}`,
  poster_key: `videos/${slug}/poster.jpg`,
  duration,
  calidades: renditions.map(([h]) => `${h}p`),
  original: path.basename(input),
};
fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify(meta, null, 2));

console.log(`\n\n✅ Listo en ${Math.round((Date.now() - started) / 60000)} min — ${gb.toFixed(2)} GB`);
console.log(`\nSiguiente paso, súbelo a R2:`);
console.log(`   rclone copy "${outDir}" r2:smfml-videos/videos/${slug} --progress --transfers 16`);
console.log(`\nY dalo de alta en el panel de administración con:`);
console.log(`   Carpeta HLS: videos/${slug}     Póster: videos/${slug}/poster.jpg     Duración: ${duration}\n`);
