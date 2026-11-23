# ❤ Series and Movies for My Love

Plataforma privada de streaming: películas y series en HLS adaptativo (1080p/720p/480p, hasta 4K), con login, catálogo, búsqueda, "seguir viendo", episodios por temporada y panel de administración.

**Todo corre en Cloudflare** (un solo Worker):

| Pieza | Servicio | Costo |
|---|---|---|
| Películas (HLS) | Cloudflare **R2** (privado) | 10 GB gratis, luego ~$0.015 USD/GB al mes. **La salida de datos es gratis** |
| API + usuarios + catálogo | Cloudflare **Workers + D1** | Gratis hasta 100 000 peticiones/día |
| Página web (React) | La sirve el mismo Worker | Gratis |

> Una película de 2 h en 1080p queda en ~4–6 GB con las 3 calidades. Ver una película completa son ~1 200 peticiones, así que el plan gratis alcanza para unas 80 películas vistas por día. El plan Workers Paid ($5 USD/mes) sube el límite a 10 millones.

**¿Por qué no en el hosting de Namecheap?** Su política de uso para hosting compartido limita el video a 10 GB por cuenta (unas 2 películas), prohíbe subir contenido para streaming y limita la cantidad de archivos (inodes). HLS genera miles de archivos por película. El dominio de Namecheap sí lo puedes usar (paso 9).

---

## Arquitectura

```
Tu PC                          Cloudflare
──────                         ─────────────────────────────────────────
película.mkv                   ┌─ Worker "series-and-movies-for-my-love" ─┐
   │ ffmpeg (tools/convertir)  │  /           → página React (dist/)      │
   ▼                           │  /api/*      → login, catálogo, progreso │──► D1 (SQLite)
salida/<slug>/  ── rclone ──►  │  /media/...  → video protegido          │──► R2 (privado)
 master.m3u8, 1080p/, ...      └──────────────────────────────────────────┘
```

**Seguridad del video:**
- El bucket R2 es privado. Nadie puede acceder directo.
- Para reproducir, la API entrega una **URL firmada** (HMAC) válida 6 horas, solo para esa película y ese usuario.
- Además se exige la **cookie de sesión** (`HttpOnly`, `SameSite=Strict`). Si copian el enlace en otro navegador u otra página, no funciona.
- Se rechazan peticiones de otros sitios (`Sec-Fetch-Site: cross-site`), lo que bloquea el hotlinking.

---

## Paso 1 — Instalar herramientas (una vez, en Windows)

Abre **PowerShell** y ejecuta:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
winget install Rclone.Rclone
winget install Git.Git
```

Cierra y vuelve a abrir PowerShell. Comprueba:

```powershell
node -v ; ffmpeg -version ; rclone version ; git --version
```

## Paso 2 — Descargar el proyecto

```powershell
cd $HOME\Documents
git clone https://github.com/Hector-SWAT/Movies-Series-ForMyLove.git
cd Movies-Series-ForMyLove
npm install
```

## Paso 3 — Crear la cuenta de Cloudflare, el bucket R2 y la base D1

1. Crea una cuenta gratis en https://dash.cloudflare.com
2. En el menú, entra a **R2 Object Storage**, actívalo (pide tarjeta pero tiene 10 GB gratis) y crea un bucket llamado **`smfml-videos`**. Déjalo **privado**: no actives el acceso público.
3. En PowerShell, dentro del proyecto:

```powershell
npx wrangler login                       # abre el navegador para autorizar
npx wrangler d1 create smfml-db          # crea la base de datos
```

4. El último comando imprime un `database_id`. Cópialo y pégalo en **`wrangler.toml`**, en lugar de `REEMPLAZA_CON_TU_DATABASE_ID`.
5. Crea las tablas y el secreto de firmas:

```powershell
npm run db:remote
# Genera un secreto aleatorio y guárdalo en Cloudflare:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npx wrangler secret put AUTH_SECRET      # pega el texto que salió arriba
```

## Paso 4 — Publicar la plataforma

```powershell
npm run deploy
```

Al terminar te da la URL, algo como `https://series-and-movies-for-my-love.<tu-cuenta>.workers.dev`.

## Paso 5 — Crear los usuarios

```powershell
# Tú (administrador):
node tools/crear-usuario.mjs hector "TuContraseñaSegura" "Héctor" --admin --remote
# Tu pareja (usuario normal):
node tools/crear-usuario.mjs miamor "OtraContraseña" "Mi amor" --remote
```

Después puedes crear más usuarios desde **Panel → Crear usuario**.

## Paso 6 — Convertir una película a HLS

```powershell
node tools/convertir.mjs "D:\Peliculas\Titanic (1997).mkv" titanic
```

- `titanic` es el **slug**: el identificador, en minúsculas y sin espacios. Usa el mismo en los pasos 7 y 8.
- Genera `salida\titanic\` con `master.m3u8`, una carpeta por calidad, `poster.jpg` e `info.json`.
- **Calidad:** la calidad más alta usa la resolución original (nunca se agranda) con CRF 18, que a simple vista no se distingue del original. Si la película es 4K, se genera también la versión 4K.
- El audio 5.1 se convierte a estéreo AAC, el formato que reproducen todos los navegadores.
- Tiempo aproximado: en preset `slow`, una película de 2 h tarda de 1 a 3 h según tu PC. Para pruebas usa `--rapido` (mucho más rápido, con archivos un poco más grandes).
- Opciones: `--crf 16` (más calidad, más peso) o `--salida E:\hls` (otra carpeta).

**Convertir todas las de una carpeta:** copia `tools\convertir.mjs`, `tools\convertir-todas.mjs` y `tools\CONVERTIR_TODAS.bat` a una subcarpeta `_conversor` dentro de tu carpeta de películas (p. ej. `C:\PELICULAS\_conversor`) y da doble clic en `CONVERTIR_TODAS.bat`. Instala Node/FFmpeg si faltan, convierte todo a `C:\PELICULAS\salida`, salta las ya convertidas y genera `SUBIR_A_R2.bat` y `CATALOGO.txt`. Por defecto elige la pista de audio en español (`--audio eng` para inglés).

**Series:** convierte cada episodio con su propio slug, por ejemplo `friends-t1e01`, `friends-t1e02`…

## Paso 7 — Subir la película a R2

**Configurar rclone (una vez):**
1. En Cloudflare, ve a **R2 → Manage API tokens → Create API token**. Elige permiso **Object Read & Write** solo para el bucket `smfml-videos`. Copia el **Access Key ID**, el **Secret Access Key** y el endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
2. En PowerShell:

```powershell
rclone config create r2 s3 provider=Cloudflare access_key_id=TU_ACCESS_KEY secret_access_key=TU_SECRET endpoint=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com acl=private
```

**Subir cada película:**

```powershell
rclone copy "salida\titanic" r2:smfml-videos/videos/titanic --progress --transfers 16
```

> Siempre dentro de `videos/<slug>`. Así lo espera el panel.

## Paso 8 — Darla de alta en el catálogo

Entra a tu sitio, inicia sesión como administrador y abre **Panel**:

- **Película:** Tipo *Película*, el nombre y el slug (`titanic`). La carpeta HLS y el póster se rellenan solos. La duración en segundos está en `salida\titanic\info.json`. Guarda.
- **Serie:** primero crea la serie (Tipo *Serie*, slug `friends`, póster `videos/friends-t1e01/poster.jpg`). Luego, en **Agregar episodio**, elige la serie, la temporada, el episodio y la carpeta `videos/friends-t1e01`.

¡Listo! Ya se puede ver desde cualquier navegador: PC, celular, iPhone/Safari o Smart TV con navegador.

## Paso 9 — (Opcional) Usar tu dominio de Namecheap

1. En Cloudflare, ve a **Add a site**, escribe tu dominio y elige el plan Free.
2. Cloudflare te da 2 nameservers. En Namecheap, entra a **Domain List → Manage → Nameservers → Custom DNS** y pégalos. Puede tardar unas horas.
3. En Cloudflare, ve a **Workers & Pages → series-and-movies-for-my-love → Settings → Domains & Routes → Add → Custom domain**, por ejemplo `cine.tudominio.com`.

> Cuidado: si cambias los nameservers, el correo y los sitios que tengas en el hosting de Namecheap necesitan sus registros DNS en Cloudflare. Cloudflare los importa automáticamente al agregar el sitio; revisa que estén los registros `A`, `MX` y `TXT`.

---

## Desarrollo local (probar sin subir nada)

```powershell
copy .dev.vars.example .dev.vars
npm run db:local
node tools/crear-usuario.mjs hector "MiClave123" "Héctor" --admin
npm run dev            # http://localhost:8787
```

Subir una película de prueba al R2 **local** (pocos archivos):

```powershell
node tools/convertir.mjs "prueba.mp4" prueba --rapido
Get-ChildItem salida\prueba -Recurse -File | ForEach-Object {
  $k = "videos/prueba/" + $_.FullName.Substring((Resolve-Path salida\prueba).Path.Length + 1).Replace('\','/')
  npx wrangler r2 object put "smfml-videos/$k" --file="$($_.FullName)" --local
}
```

## Estructura

```
worker/index.js       API, login, URLs firmadas y streaming desde R2
worker/crypto.js      HMAC, tokens y hash de contraseñas (PBKDF2)
schema.sql            tablas: users, titles, videos, progress
src/                  frontend React (Vite + hls.js)
  pages/Home.jsx      portada, "seguir viendo", películas y series
  pages/Title.jsx     detalle y episodios por temporada
  pages/Watch.jsx     reproductor: calidad Auto/manual, reanudar, siguiente episodio
  pages/Admin.jsx     alta de títulos, episodios y usuarios
tools/convertir.mjs   ffmpeg → HLS multi-calidad + póster
tools/crear-usuario.mjs
wrangler.toml         configuración de Cloudflare
```

## Solución de problemas

| Problema | Causa / solución |
|---|---|
| `Falta AUTH_SECRET` | No ejecutaste `npx wrangler secret put AUTH_SECRET` (paso 3) |
| La película no carga (404) | La carpeta en R2 no coincide: debe existir `videos/<slug>/master.m3u8` |
| `URL expirada o inválida` | Normal después de 6 h; el reproductor pide otra URL solo |
| Se ve en 480p al inicio | El modo Auto se adapta a tu internet; elige 1080p en el selector de calidad |
| Error 1101 / límite diario | Pasaste las 100 000 peticiones gratis del día; espera o activa Workers Paid |

> ⚠️ Uso privado. Solo sube contenido que tengas derecho a reproducir y mantén la plataforma con login.
