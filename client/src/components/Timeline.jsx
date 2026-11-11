import { cx, when } from './ui.jsx';

/** Vertical status timeline. steps: [{ key, label, done, at }]. The first not-done step is marked as "next". */
export default function Timeline({ steps }) {
  const nextIdx = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-0" aria-label="Order status timeline">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && <span aria-hidden="true" className={cx('absolute left-[9px] top-5 h-full w-0.5', s.done ? 'bg-brand-500' : 'bg-slate-200')} />}
          <span aria-hidden="true" className={cx('z-10 mt-0.5 h-5 w-5 shrink-0 rounded-full border-2', s.done ? 'border-brand-600 bg-brand-600' : i === nextIdx ? 'border-brand-500 bg-white' : 'border-slate-300 bg-white')}>
            {s.done && <svg viewBox="0 0 20 20" className="h-full w-full text-white"><path d="M5 10.5l3.2 3L15 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </span>
          <div>
            <div className={cx('text-sm', s.done ? 'font-medium text-slate-900' : i === nextIdx ? 'text-slate-700' : 'text-slate-400')}>{s.label}{i === nextIdx && <span className="ml-2 text-xs text-brand-700">next</span>}</div>
            {s.at && <div className="text-xs text-slate-500">{when(s.at)}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
