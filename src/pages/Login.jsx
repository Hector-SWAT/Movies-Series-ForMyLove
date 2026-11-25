import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { setUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api.login(username, password));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__glow" />
      <form className="login__box" onSubmit={submit}>
        <div className="login__heart">❤</div>
        <h1 className="login__title">Series &amp; Movies<br /><em>For My Love Aleshito</em></h1>
        <p className="login__sub">Nuestro cine privado</p>
        <input placeholder="Usuario" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input placeholder="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}
