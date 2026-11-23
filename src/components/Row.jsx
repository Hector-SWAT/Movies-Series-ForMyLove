import { Link } from 'react-router-dom';
import { posterUrl } from '../api.js';

export function Card({ to, poster, name, sub, progress }) {
  const src = posterUrl(poster);
  return (
    <Link to={to} className="card">
      <div className="card__img">
        {src ? <img src={src} alt={name} loading="lazy" /> : <div className="card__ph">{name}</div>}
        {progress != null && (
          <div className="card__bar"><span style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
        )}
      </div>
      <div className="card__name">{name}</div>
      {sub && <div className="card__sub">{sub}</div>}
    </Link>
  );
}

export default function Row({ title, children }) {
  return (
    <section className="row">
      <h2 className="row__title">{title}</h2>
      <div className="row__track">{children}</div>
    </section>
  );
}
