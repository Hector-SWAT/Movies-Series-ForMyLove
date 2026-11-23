import { useEffect, useState } from 'react';
import { api } from '../api.js';

const emptyTitle = { kind: 'movie', slug: '', name: '', year: '', genre: '', description: '', poster_key: '', hls_prefix: '', duration: '' };
const emptyEp = { title_id: '', season: 1, episode: 1, name: '', hls_prefix: '', duration: '' };

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export default function Admin() {
  const [titles, setTitles] = useState([]);
  const [t, setT] = useState(emptyTitle);
  const [ep, setEp] = useState(emptyEp);
  const [u, setU] = useState({ username: '', password: '', display_name: '', is_admin: false });
  const [msg, setMsg] = useState('');

  const reload = () => api.titles().then(setTitles);
  useEffect(() => { reload(); }, []);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };
  const num = (v) => (v === '' || v == null ? null : Number(v));

  // Al escribir el slug se autocompletan las rutas de R2
  const setSlug = (slug) => {
    const s = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    setT({ ...t, slug: s, poster_key: s ? `videos/${s}/poster.jpg` : '', hls_prefix: t.kind === 'movie' && s ? `videos/${s}` : '' });
  };

  const saveTitle = async (e) => {
    e.preventDefault();
    try {
      await api.createTitle({ ...t, year: num(t.year), duration: num(t.duration), hls_prefix: t.kind === 'movie' ? t.hls_prefix : null });
      setT(emptyTitle);
      reload();
      flash('✅ Título agregado');
    } catch (err) { flash('❌ ' + err.message); }
  };

  const saveEp = async (e) => {
    e.preventDefault();
    try {
      await api.createVideo({ ...ep, title_id: Number(ep.title_id), season: num(ep.season), episode: num(ep.episode), duration: num(ep.duration) });
      setEp({ ...ep, episode: Number(ep.episode) + 1, name: '', hls_prefix: '', duration: '' });
      flash('✅ Episodio agregado');
    } catch (err) { flash('❌ ' + err.message); }
  };

  const saveUser = async (e) => {
    e.preventDefault();
    try {
      await api.createUser(u);
      setU({ username: '', password: '', display_name: '', is_admin: false });
      flash('✅ Usuario creado');
    } catch (err) { flash('❌ ' + err.message); }
  };

  const del = async (id, name) => {
    if (!window.confirm(`¿Quitar "${name}" del catálogo? (Los archivos en R2 no se borran)`)) return;
    await api.deleteTitle(id);
    reload();
  };

  const series = titles.filter((x) => x.kind === 'series');

  return (
    <div className="page page--padtop admin">
      <h1 className="admin__title">Panel de administración</h1>
      {msg && <div className="toast">{msg}</div>}

      <div className="admin__grid">
        <form className="panel" onSubmit={saveTitle}>
          <h2>Agregar película o serie</h2>
          <Field label="Tipo">
            <select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value, hls_prefix: e.target.value === 'movie' && t.slug ? `videos/${t.slug}` : '' })}>
              <option value="movie">Película</option>
              <option value="series">Serie</option>
            </select>
          </Field>
          <Field label="Nombre"><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} required /></Field>
          <Field label="Slug (el mismo que usaste al convertir)"><input value={t.slug} onChange={(e) => setSlug(e.target.value)} placeholder="titanic" required /></Field>
          <div className="field-row">
            <Field label="Año"><input type="number" value={t.year} onChange={(e) => setT({ ...t, year: e.target.value })} /></Field>
            <Field label="Género"><input value={t.genre} onChange={(e) => setT({ ...t, genre: e.target.value })} placeholder="Romance" /></Field>
          </div>
          <Field label="Descripción"><textarea rows={3} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} /></Field>
          <Field label="Póster en R2"><input value={t.poster_key} onChange={(e) => setT({ ...t, poster_key: e.target.value })} placeholder="videos/titanic/poster.jpg" /></Field>
          {t.kind === 'movie' && (
            <div className="field-row">
              <Field label="Carpeta HLS en R2"><input value={t.hls_prefix} onChange={(e) => setT({ ...t, hls_prefix: e.target.value })} placeholder="videos/titanic" required /></Field>
              <Field label="Duración (seg)"><input type="number" value={t.duration} onChange={(e) => setT({ ...t, duration: e.target.value })} /></Field>
            </div>
          )}
          <button className="btn btn--primary">Guardar</button>
        </form>

        <form className="panel" onSubmit={saveEp}>
          <h2>Agregar episodio a una serie</h2>
          <Field label="Serie">
            <select value={ep.title_id} onChange={(e) => setEp({ ...ep, title_id: e.target.value })} required>
              <option value="">— Elige —</option>
              {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="field-row">
            <Field label="Temporada"><input type="number" min="1" value={ep.season} onChange={(e) => setEp({ ...ep, season: e.target.value })} /></Field>
            <Field label="Episodio"><input type="number" min="1" value={ep.episode} onChange={(e) => setEp({ ...ep, episode: e.target.value })} /></Field>
          </div>
          <Field label="Nombre del episodio"><input value={ep.name} onChange={(e) => setEp({ ...ep, name: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Carpeta HLS en R2"><input value={ep.hls_prefix} onChange={(e) => setEp({ ...ep, hls_prefix: e.target.value })} placeholder="videos/friends-t1e01" required /></Field>
            <Field label="Duración (seg)"><input type="number" value={ep.duration} onChange={(e) => setEp({ ...ep, duration: e.target.value })} /></Field>
          </div>
          <button className="btn btn--primary">Guardar episodio</button>

          <h2 className="mt">Crear usuario</h2>
          <div className="field-row">
            <Field label="Usuario"><input value={u.username} onChange={(e) => setU({ ...u, username: e.target.value })} /></Field>
            <Field label="Contraseña (mín. 8)"><input type="password" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></Field>
          </div>
          <Field label="Nombre visible"><input value={u.display_name} onChange={(e) => setU({ ...u, display_name: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={u.is_admin} onChange={(e) => setU({ ...u, is_admin: e.target.checked })} /> Administrador</label>
          <button className="btn btn--ghost" type="button" onClick={saveUser} disabled={!u.username || u.password.length < 8}>Crear usuario</button>
        </form>
      </div>

      <section className="panel mt">
        <h2>Catálogo ({titles.length})</h2>
        <table className="table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Slug</th><th /></tr></thead>
          <tbody>
            {titles.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td>{x.kind === 'series' ? 'Serie' : 'Película'}</td>
                <td><code>{x.slug}</code></td>
                <td><button className="link-danger" onClick={() => del(x.id, x.name)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
