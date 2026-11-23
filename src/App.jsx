import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Title from './pages/Title.jsx';
import Watch from './pages/Watch.jsx';
import Admin from './pages/Admin.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = cargando

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="splash"><span className="heart">❤</span></div>;

  if (!user) {
    return (
      <AuthCtx.Provider value={{ user, setUser }}>
        <Login />
      </AuthCtx.Provider>
    );
  }

  return (
    <AuthCtx.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/ver/:videoId" element={<Watch />} />
        <Route
          path="*"
          element={
            <>
              <Navbar />
              <main>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/titulo/:id" element={<Title />} />
                  <Route path="/admin" element={user.is_admin ? <Admin /> : <Navigate to="/" />} />
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </main>
            </>
          }
        />
      </Routes>
    </AuthCtx.Provider>
  );
}
