import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api.js';
import { cx, CowMark } from './ui.jsx';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const SUGGEST = {
  buyer: ['What are my active orders?', 'Where is my milk delivery?', 'How much did I spend this month?', 'Show me available butter'],
  transporter: ['How many deliveries are assigned to me?', 'Where is my next pickup location?', 'How much have I earned this week?', 'Which deliveries are pending?'],
  farmer: ['Which of my batches are listed?', 'How much have I sold?', 'What orders are waiting for me?'],
  admin: ['Platform summary'],
};

/** Debo Assistant: rule-based, answers from the signed-in user's own data. Voice input/output uses the browser's speech features when available. */
export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([{ from: 'bot', text: 'Hello! I am the Debo assistant. Ask me about your orders, deliveries or prices. I am a simple rule-based helper, not a full AI.' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [role, setRole] = useState(null);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, open]);
  useEffect(() => { api.get('/auth/me').then((r) => setRole(r.data.user.role)).catch(() => {}); }, []);

  const send = async (message, channel = 'text') => {
    const m = message.trim();
    if (!m || busy) return;
    setMsgs((x) => [...x, { from: 'me', text: m }]); setText(''); setBusy(true);
    try {
      const r = await api.post('/assistant/chat', { message: m, channel });
      setMsgs((x) => [...x, { from: 'bot', text: r.data.reply, links: r.data.links }]);
      if (speak && 'speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(r.data.reply));
    } catch (e) { setMsgs((x) => [...x, { from: 'bot', text: errMsg(e) }]); } finally { setBusy(false); }
  };
  const listen = () => {
    if (!SR) return;
    const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
    rec.onresult = (e) => send(e.results[0][0].transcript, 'voice');
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false);
    setListening(true); rec.start();
  };

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Debo assistant"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-brand-800 py-2 pl-2 pr-4 text-sm font-medium text-white shadow-lg hover:bg-brand-700">
        <CowMark size={30} />Ask Debo
      </button>
      {open && (
        <section aria-label="Debo assistant" className="fixed bottom-20 right-4 z-40 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-sm flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between rounded-t-2xl bg-brand-800 px-4 py-2 text-white">
            <span className="text-sm font-semibold">Debo assistant</span>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} />Read aloud</label>
          </header>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
            {msgs.map((m, i) => (
              <div key={i} className={cx('max-w-[90%] rounded-2xl px-3 py-2', m.from === 'me' ? 'ml-auto bg-brand-600 text-white' : 'bg-slate-100 text-slate-800')}>
                {m.text}
                {m.links?.map((l) => <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="mt-1 block text-xs font-medium text-brand-700 underline">{l.label}</Link>)}
              </div>
            ))}
            {busy && <div className="text-xs text-slate-400">Thinking…</div>}
            <div ref={end} />
          </div>
          <div className="flex flex-wrap gap-1 border-t border-slate-100 px-3 pt-2">
            {(SUGGEST[role] || []).map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">{s}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 p-3">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Type your question" aria-label="Message" className="input flex-1" />
            {SR && <button type="button" onClick={listen} aria-label="Speak" className={cx('rounded-lg border px-2', listening ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-300')}>🎤</button>}
            <button disabled={busy || !text.trim()} className="rounded-lg bg-brand-600 px-3 text-sm font-medium text-white disabled:bg-brand-200">Send</button>
          </form>
        </section>
      )}
    </>
  );
}
