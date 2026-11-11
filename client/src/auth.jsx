import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then((r) => setUser(r.data.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('debo:logout', out);
    return () => window.removeEventListener('debo:logout', out);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.data.token); setUser(r.data.user); return r.data.user;
  }, []);
  const register = useCallback(async (payload) => {
    const r = await api.post('/auth/register', payload);
    setToken(r.data.token); setUser(r.data.user); return r.data.user;
  }, []);
  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  const refresh = useCallback(async () => { const r = await api.get('/auth/me'); setUser(r.data.user); }, []);

  return <Ctx.Provider value={{ user, ready, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}
