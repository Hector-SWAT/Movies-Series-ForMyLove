import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtTime, posterUrl } from '../api.js';

export default function Title() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [season, setSeason] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.title(id).then((d) => {
      setT(d);
      const seasons = [...new Set(d.videos.map((v) => v.season ?? 1))];
      setSeason(seasons[0] ?? 1);
    }).catch((e) => setError(e.message));
  }, [id]);

  const seasons = useMemo(() => (t ? [...new Set(t.videos.map((v) => v.season ?? 1))] : []), [t]);

  if (error) return <div className="page page--padtop"><div className="error">{error}</div></div>;
  if (!t) return <div className="page page--padtop"><div className="loading">Cargando…</div></div>;

  // Botón principal: continuar donde se quedó o empezar desde el primero
  const started = t.videos.filter((v) => v.position > 30 && (!v.watched_duration || v.position < v.watched_duration * 0.95));
  const main = started[0] || t.videos[0];
  const episodes = t.videos.filter((v) => (v.season ?? 1) === season);

  return (
    <div className="page">
      <section className="hero hero--detail" style={t.poster_key ? { backgroundImage: `url(${posterUrl(t.poster_key)})` } : undefined}>
        <div className="hero__shade" />
        <div className="hero__content">
          <span className="tag">{t.kind === 'series' ? 'Serie' : 'Película'}{t.year ? ` · ${t.year}` : ''}{t.genre ? ` · ${t.genre}` : ''}</span>
          <h1 className="hero__title">{t.name}</h1>
          {t.description && <p className="hero__desc">{t.description}</p>}
          {main ? (
            <Link to={`/ver/${main.id}`} className="btn btn--primary">
              ▶ {started[0] ? 'Continuar' : 'Reproducir'}{t.kind === 'series' && main ? ` T${main.season ?? 1}:E${main.episode ?? 1}` : ''}
            </Link>
          ) : <p className="muted">Todavía no tiene videos.</p>}
        </div>
      </section>

      {t.kind === 'series' && t.videos.length > 0 && (
        <section className="episodes">
          <div className="episodes__head">
            <h2 className="row__title">Episodios</h2>
            {seasons.length > 1 && (
              <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
                {seasons.map((s) => <option key={s} value={s}>Temporada {s}</option>)}
              </select>
            )}
          </div>
          {episodes.map((v) => (
            <Link key={v.id} to={`/ver/${v.id}`} className="episode">
              <span className="episode__num">{v.episode ?? '•'}</span>
              <span className="episode__info">
                <strong>{v.name || `Episodio ${v.episode}`}</strong>
                {v.duration ? <small>{fmtTime(v.duration)}</small> : null}
                {v.position > 0 && v.watched_duration ? (
                  <span className="card__bar"><span style={{ width: `${Math.min(100, (v.position / v.watched_duration) * 100)}%` }} /></span>
                ) : null}
              </span>
              <span className="episode__play">▶</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
