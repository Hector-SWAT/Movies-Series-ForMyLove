import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Navbar() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Búsqueda mientras escribes (con pequeña espera)
  useEffect(() => {
    const t = setTimeout(() => {
      const current = params.get('q') || '';
      if (q.trim() !== current) navigate(q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : '/', { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
  };

  return (
    <header className={`nav ${scrolled ? 'nav--solid' : ''}`}>
      <Link to="/" className="brand" onClick={() => setQ('')}>
        <span className="brand__heart">❤</span>
        <span className="brand__text">Series and Movies <em>for My Love</em></span>
      </Link>
      <div className="nav__right">
        <input className="search" type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        {user.is_admin && <Link to="/admin" className="nav__link">Panel</Link>}
        <button className="nav__link nav__btn" onClick={logout} title={user.username}>
          Salir
        </button>
      </div>
    </header>
  );
}
