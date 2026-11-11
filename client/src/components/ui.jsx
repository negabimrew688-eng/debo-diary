import { useState } from 'react';
import { errMsg } from '../api.js';

export const money = (n) => (n === null || n === undefined ? '-' : `ETB ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
export const num = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
export const when = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const cx = (...c) => c.filter(Boolean).join(' ');

export function Card({ title, actions, children, className }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-slate-700">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const BTN = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-200',
  ghost: 'text-brand-700 hover:bg-brand-50',
};
export function Btn({ variant = 'primary', size = 'md', className, ...p }) {
  return (
    <button
      {...p}
      className={cx('inline-flex items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm', BTN[variant], className)}
    />
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
export const Input = (p) => <input {...p} className={cx('input', p.className)} />;
export const Select = ({ children, ...p }) => <select {...p} className={cx('input', p.className)}>{children}</select>;
export const Textarea = (p) => <textarea rows={3} {...p} className={cx('input', p.className)} />;

const TONES = {
  green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800', gray: 'bg-slate-100 text-slate-700', purple: 'bg-violet-100 text-violet-800',
};
export const Badge = ({ tone = 'gray', children }) => <span className={cx('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;

export const GradeBadge = ({ grade }) => {
  if (!grade) return <Badge>Not tested</Badge>;
  return <Badge tone={grade === 'A' ? 'green' : grade === 'B' ? 'amber' : 'red'}>{grade === 'FAIL' ? 'Failed' : `Grade ${grade}`}</Badge>;
};

const STATUS_TONE = {
  pending_payment: 'amber', paid: 'blue', in_transit: 'blue', delivered: 'purple', completed: 'green', disputed: 'red', refunded: 'gray', cancelled: 'gray',
  draft: 'gray', tested: 'blue', listed: 'green', sold_out: 'gray', rejected: 'red', withdrawn: 'gray',
  requested: 'amber', accepted: 'blue', collected: 'blue', placed: 'amber', open: 'red', refund_buyer: 'gray', release_to_farmer: 'green',
  initiated: 'amber', held: 'blue', released: 'green', failed: 'red', available: 'green', sold: 'gray',
  unpaid: 'amber', confirmed: 'blue', processing: 'blue', ready_for_pickup: 'purple', assigned: 'blue', heading_to_pickup: 'blue', hidden: 'gray', busy: 'amber', offline: 'gray', verified: 'green', pending: 'amber',
};
export const StatusBadge = ({ status }) => (status ? <Badge tone={STATUS_TONE[status] || 'gray'}>{status.replaceAll('_', ' ')}</Badge> : null);

export const Stat = ({ label, value, hint, tone }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={cx('mt-1 text-2xl font-semibold', tone === 'good' ? 'text-brand-700' : tone === 'bad' ? 'text-red-600' : 'text-slate-900')}>{value}</div>
    {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
  </div>
);

export const Spinner = () => <div className="py-8 text-center text-sm text-slate-500">Loading…</div>;
export const ErrorBox = ({ children }) => (children ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div> : null);
export const Notice = ({ tone = 'green', children }) => (
  <div className={cx('rounded-lg border px-3 py-2 text-sm', tone === 'green' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900')}>{children}</div>
);
export const Empty = ({ children }) => <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">{children}</div>;

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Table({ columns, rows, empty = 'Nothing here yet', rowKey = 'id' }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => <th key={c.key || c.header} className={cx('whitespace-nowrap px-3 py-2 font-medium', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              {columns.map((c) => <td key={c.key || c.header} className={cx('px-3 py-2 align-top', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="mt-10 w-full max-w-lg rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Runs an async action with busy/error/success state for buttons and forms. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true); setError('');
    try { return await fn(); } catch (e) { setError(errMsg(e)); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

export const FLAG_LABELS = {
  screening_only_no_fat: 'No fat reading: treat as a screening estimate only',
  low_fat: 'Fat below 3%: could mean dilution or the cow breed',
  sensor_disagreement: 'Conductivity and lactometer disagree: re-measure',
  reading_above_normal_possible_skimming_or_added_solids: 'Reading is above normal: cream removal or added solids can hide water',
  temperature_out_of_reliable_range: 'Milk temperature is outside 10-35 °C: correction is less reliable',
  image_unusually_dark_or_translucent: 'Photo looks dark or translucent',
};
export const Flags = ({ flags }) => (flags?.length ? <ul className="mt-2 space-y-1 text-xs text-amber-800">{flags.map((f) => <li key={f}>⚠ {FLAG_LABELS[f] || f}</li>)}</ul> : null);

export function WaterGauge({ test }) {
  const { estimated_water_percent: w, estimate_low: lo, estimate_high: hi, confidence } = test;
  return (
    <div>
      <div className="flex items-end gap-3">
        <div className="text-4xl font-semibold text-slate-900">{num(w)}%</div>
        <div className="pb-1 text-sm text-slate-500">estimated added water<br />range {num(lo)}–{num(hi)}%, confidence {Math.round(confidence * 100)}%</div>
      </div>
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-emerald-300" style={{ width: '16.67%' }} />
        <div className="absolute inset-y-0 bg-amber-300" style={{ left: '16.67%', width: '33.33%' }} />
        <div className="absolute inset-y-0 bg-red-300" style={{ left: '50%', right: 0 }} />
        <div className="absolute inset-y-0 w-1 bg-slate-900" style={{ left: `calc(${Math.min(w, 30) / 30 * 100}% - 2px)` }} />
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-slate-400" aria-hidden="true">
        <span className="absolute left-0">0%</span>
        <span className="absolute" style={{ left: '16.67%', transform: 'translateX(-50%)' }}>A ≤ 5%</span>
        <span className="absolute" style={{ left: '50%', transform: 'translateX(-50%)' }}>B ≤ 15%</span>
        <span className="absolute right-0">30%+ fail</span>
      </div>
    </div>
  );
}

/** Round brand badge: the Debo cow, cropped to the head. */
export function CowMark({ size = 40, className }) {
  return (
    <span aria-hidden="true" className={cx('inline-block shrink-0 rounded-full bg-brand-50 ring-2 ring-white/70', className)}
      style={{ width: size, height: size, backgroundImage: 'url(/cow.png)', backgroundSize: '270%', backgroundPosition: '88% 6%', backgroundRepeat: 'no-repeat' }} />
  );
}

/** Welcome banner with the cow illustration. */
export function Hero({ title, subtitle, children }) {
  return (
    <section className="relative mb-6 overflow-hidden min-h-[168px] rounded-2xl bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 px-6 py-6 text-white shadow-sm md:px-8">
      <div className="relative z-10 max-w-xl pr-36 sm:pr-44">
        <h2 className="text-xl font-semibold md:text-2xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-brand-100">{subtitle}</p>}
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
      <img src="/cow.png" alt="" aria-hidden="true" className="pointer-events-none absolute bottom-0 right-3 h-[88%] w-auto select-none drop-shadow-xl md:right-10" />
    </section>
  );
}

export function Stars({ value, onChange, label }) {
  return (
    <span role={onChange ? 'radiogroup' : 'img'} aria-label={label || `${value} out of 5`} className="inline-flex gap-0.5 text-lg leading-none">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={cx(n <= Math.round(value || 0) ? 'text-amber-400' : 'text-slate-300', onChange && 'hover:text-amber-500')}>★</button>
      ))}
    </span>
  );
}

export function Avatar({ url, name, size = 40 }) {
  return url ? <img src={url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    : <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800" style={{ width: size, height: size }}>{(name || '?').trim().slice(0, 1).toUpperCase()}</span>;
}
