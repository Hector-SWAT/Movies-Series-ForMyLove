import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Hls from 'hls.js';
import { api } from '../api.js';

export default function Watch() {
  const { videoId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [meta, setMeta] = useState(null);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1); // -1 = automático
  const [current, setCurrent] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    let lastSaved = 0;
    let reloads = 0;

    const save = () => {
      if (!video || !video.duration || video.currentTime < 5) return;
      api.saveProgress(Number(videoId), video.currentTime, video.duration).catch(() => {});
    };

    // Carga (o recarga si la URL firmada expiró) conservando la posición
    const load = async (resumeAt) => {
      const data = await api.play(videoId);
      if (cancelled) return;
      setMeta(data);
      const start = resumeAt ?? data.resume_at ?? 0;

      if (Hls.isSupported()) {
        hlsRef.current?.destroy();
        const hls = new Hls({
          startPosition: start > 5 ? start : -1,
          capLevelToPlayerSize: false,      // no recortar calidad por el tamaño de la ventana
          abrEwmaDefaultEstimate: 6_000_000, // empezar asumiendo buena conexión (≈1080p)
          maxBufferLength: 60,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
          setLevels(d.levels.map((l, i) => ({ i, h: l.height, kbps: Math.round(l.bitrate / 1000) })));
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => setCurrent(hls.levels[d.level]?.height ?? null));
        hls.on(Hls.Events.ERROR, async (_, d) => {
          if (!d.fatal) return;
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.response?.code === 403 && reloads < 3) {
            reloads += 1;
            load(video.currentTime).catch((e) => setError(e.message)); // URL firmada vencida: pedir una nueva
          } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError('No se pudo reproducir el video.');
          }
        });
        hls.loadSource(data.src);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari / iPhone reproduce HLS de forma nativa
        video.src = data.src;
        video.addEventListener('loadedmetadata', () => {
          if (start > 5) video.currentTime = start;
          video.play().catch(() => {});
        }, { once: true });
      } else {
        setError('Tu navegador no soporta HLS.');
      }

      // Siguiente episodio (solo series)
      if (data.video.kind === 'series') {
        api.title(data.video.title_id).then((t) => {
          const idx = t.videos.findIndex((v) => v.id === data.video.id);
          setNext(t.videos[idx + 1] || null);
        }).catch(() => {});
      } else setNext(null);
    };

    load().catch((e) => setError(e.message));

    const onTime = () => {
      if (Date.now() - lastSaved > 10000) {
        lastSaved = Date.now();
        save();
      }
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', save);
    window.addEventListener('beforeunload', save);

    return () => {
      cancelled = true;
      save();
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('pause', save);
      window.removeEventListener('beforeunload', save);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setLevels([]);
      setLevel(-1);
    };
  }, [videoId]);

  const changeLevel = (l) => {
    setLevel(l);
    if (hlsRef.current) hlsRef.current.currentLevel = l; // -1 vuelve a automático
  };

  const onEnded = () => {
    if (next) navigate(`/ver/${next.id}`);
  };

  const label = meta
    ? meta.video.kind === 'series'
      ? `${meta.video.title_name} · T${meta.video.season ?? 1}:E${meta.video.episode ?? '?'}${meta.video.name ? ' — ' + meta.video.name : ''}`
      : meta.video.title_name
    : '';

  return (
    <div className="watch">
      <div className="watch__top">
        <Link to={meta ? `/titulo/${meta.video.title_id}` : '/'} className="watch__back">← Volver</Link>
        <span className="watch__label">{label}</span>
        <div className="watch__tools">
          {levels.length > 0 && (
            <select value={level} onChange={(e) => changeLevel(Number(e.target.value))} title="Calidad">
              <option value={-1}>Auto{level === -1 && current ? ` (${current}p)` : ''}</option>
              {[...levels].sort((a, b) => b.h - a.h).map((l) => (
                <option key={l.i} value={l.i}>{l.h}p</option>
              ))}
            </select>
          )}
          {next && <Link className="btn btn--ghost" to={`/ver/${next.id}`}>Siguiente ›</Link>}
        </div>
      </div>
      {error && <div className="error watch__error">{error}</div>}
      <video ref={videoRef} className="watch__video" controls playsInline onEnded={onEnded} />
    </div>
  );
}
