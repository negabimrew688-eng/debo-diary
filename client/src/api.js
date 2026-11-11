import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';

const TOKEN_KEY = 'debo_token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } };

export const api = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || ''}/api/v1`, timeout: 20000 });

api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event('debo:logout'));
    }
    return Promise.reject(err);
  }
);

export function errMsg(err) {
  const d = err?.response?.data;
  if (!d) return err?.message === 'Network Error' ? 'Cannot reach the server. Check your connection.' : err?.message || 'Something went wrong';
  if (d.details?.length) return `${d.error}: ${d.details.map((x) => `${x.field ? x.field + ' ' : ''}${x.message}`).join('; ')}`;
  return d.error || 'Something went wrong';
}

export function useFetch(url, params, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params || {});
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(url, { params })
      .then((r) => !cancelled && setState({ data: r.data, error: null, loading: false }))
      .catch((e) => !cancelled && setState({ data: null, error: errMsg(e), loading: false }));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
