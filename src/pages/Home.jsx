import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, posterUrl } from '../api.js';
import Row, { Card } from '../components/Row.jsx';

export default function Home() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [titles, setTitles] = useState(null);
  const [cont, setCont] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.titles(q).then(setTitles).catch((e) => setError(e.message));
  }, [q]);
  useEffect(() => {
    api.continueWatching().then(setCont).catch(() => {});
  }, []);

  if (error) return <div className="page"><div className="error">{error}</div></div>;
  if (!titles) return <div className="page"><div className="loading">Cargando…</div></div>;

  if (q) {
    return (
      <div className="page page--padtop">
        <h2 className="row__title">Resultados para “{q}”</h2>
        {titles.length === 0 ? <p className="muted">No encontramos nada con ese nombre.</p> : (
          <div className="grid">
            {titles.map((t) => <Card key={t.id} to={`/titulo/${t.id}`} poster={t.poster_key} name={t.name} sub={[t.year, t.kind === 'series' ? 'Serie' : 'Película'].filter(Boolean).join(' · ')} />)}
          </div>
        )}
      </div>
    );
  }

  if (titles.length === 0) {
    return (
      <div className="page page--padtop empty">
        <div className="login__heart">❤</div>
        <h2>Aún no hay nada por aquí</h2>
        <p className="muted">Convierte una película, súbela a R2 y dala de alta en el Panel.</p>
      </div>
    );
  }

  const hero = titles[0];
  const movies = titles.filter((t) => t.kind === 'movie');
  const series = titles.filter((t) => t.kind === 'series');

  return (
    <div className="page">
      <section className="hero" style={hero.poster_key ? { backgroundImage: `url(${posterUrl(hero.poster_key)})` } : undefined}>
        <div className="hero__shade" />
        <div className="hero__content">
          <span className="tag">{hero.kind === 'series' ? 'Serie' : 'Película'} · Recién agregada</span>
          <h1 className="hero__title">{hero.name}</h1>
          {hero.description && <p className="hero__desc">{hero.description}</p>}
          <Link to={`/titulo/${hero.id}`} className="btn btn--primary">▶ Ver ahora</Link>
        </div>
      </section>

      {cont.length > 0 && (
        <Row title="Seguir viendo">
          {cont.map((c) => (
            <Card key={c.video_id} to={`/ver/${c.video_id}`} poster={c.poster_key} name={c.name}
              sub={c.kind === 'series' ? `T${c.season ?? 1} · E${c.episode ?? '?'}${c.video_name ? ' · ' + c.video_name : ''}` : null}
              progress={c.duration ? c.position / c.duration : 0} />
          ))}
        </Row>
      )}
      {movies.length > 0 && (
        <Row title="Películas">
          {movies.map((t) => <Card key={t.id} to={`/titulo/${t.id}`} poster={t.poster_key} name={t.name} sub={[t.year, t.genre].filter(Boolean).join(' · ')} />)}
        </Row>
      )}
      {series.length > 0 && (
        <Row title="Series">
          {series.map((t) => <Card key={t.id} to={`/titulo/${t.id}`} poster={t.poster_key} name={t.name} sub={[t.year, t.genre].filter(Boolean).join(' · ')} />)}
        </Row>
      )}
    </div>
  );
}
