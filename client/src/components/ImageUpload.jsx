import { useState } from 'react';
import { api, errMsg } from '../api.js';

/** Uploads a jpg/png/webp via /uploads and reports the returned URL. */
export default function ImageUpload({ value, onChange, label = 'Photo' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('image', file);
      const r = await api.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(r.data.url);
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-3">
        {value && <img src={value} alt="" className="h-14 w-14 rounded-lg object-cover" />}
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
          {busy ? 'Uploading…' : value ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={busy} />
        </label>
        {value && <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange('')}>Remove</button>}
      </div>
      {err && <p role="alert" className="text-red-600">{err}</p>}
    </div>
  );
}
