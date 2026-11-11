import { useEffect, useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, ErrorBox, Field, Input, Notice, PageHeader, Spinner, Table, num, useAction } from '../../components/ui.jsx';

const KEYS = [
  ['base_price_per_litre', 'Reference price per litre (ETB)', 'Set to the real local price; the default is only a placeholder'],
  ['grade_a_max_water', 'Grade A: max added water %'], ['grade_b_max_water', 'Grade B: max added water %'],
  ['normal_clr', 'Normal lactometer reading (undiluted milk)', 'Corrected to the standard temperature'], ['normal_snf', 'Normal SNF %'],
  ['delivery_fee_etb', 'Delivery partner fee per delivery (ETB)', 'Paid to the partner for each completed delivery'], ['platform_commission_percent', 'Platform commission % (placeholder)', 'Only used for the revenue estimate on the dashboard'],
  ['normal_conductivity_ms', 'Normal conductivity (mS/cm)'], ['delivery_tolerance_points', 'Delivery check tolerance (water % points)'],
];

export default function AdminSettings() {
  const s = useFetch('/admin/settings');
  const cal = useFetch('/admin/calibration');
  const [f, setF] = useState({});
  const [mult, setMult] = useState({ A: '', B: '' });
  const [sample, setSample] = useState({ lactometer_reading: '', temperature_c: '20', known_water_percent: '' });
  const save = useAction();
  const add = useAction();
  const fit = useAction();
  const [saved, setSaved] = useState(false);
  const [pv, setPv] = useState({ lactometer_reading: '', temperature_c: '20', fat_percent: '' });
  const [pvRes, setPvRes] = useState(null);
  const prev = useAction();

  useEffect(() => {
    if (!s.data) return;
    setF(Object.fromEntries(KEYS.map(([k]) => [k, s.data.settings[k]])));
    setMult({ A: s.data.settings.grade_multipliers.A, B: s.data.settings.grade_multipliers.B });
  }, [s.data]);

  const submit = (e) => {
    e.preventDefault(); setSaved(false);
    save.run(async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)]));
      body.grade_multipliers = { A: Number(mult.A), B: Number(mult.B) };
      await api.put('/admin/settings', body); setSaved(true); s.reload();
    });
  };
  const addSample = (e) => { e.preventDefault(); add.run(async () => { await api.post('/admin/calibration', { lactometer_reading: Number(sample.lactometer_reading), temperature_c: Number(sample.temperature_c), known_water_percent: Number(sample.known_water_percent) }); setSample({ ...sample, lactometer_reading: '', known_water_percent: '' }); cal.reload(); }); };
  const apply = () => fit.run(async () => { await api.post('/admin/calibration/apply'); cal.reload(); s.reload(); });
  const clear = () => fit.run(async () => { await api.delete('/admin/calibration/active'); cal.reload(); s.reload(); });

  const preview = (e) => { e.preventDefault(); prev.run(async () => { const r = await api.post('/admin/calibration/preview', { lactometer_reading: Number(pv.lactometer_reading), temperature_c: Number(pv.temperature_c), ...(pv.fat_percent ? { fat_percent: Number(pv.fat_percent) } : {}) }); setPvRes(r.data); }); };

  if (s.loading && !s.data) return <Spinner />;
  if (s.error) return <ErrorBox>{s.error}</ErrorBox>;
  const active = cal.data?.active;
  return (
    <>
      <PageHeader title="Pricing & Milk Check model" subtitle="Grading thresholds, price rules and calibration with real samples" />
      <Card title="Pricing and grading">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            {KEYS.map(([k, label, hint]) => <Field key={k} label={label} hint={hint}><Input type="number" step="any" required value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
            <Field label="Grade A price multiplier"><Input type="number" step="0.01" required value={mult.A} onChange={(e) => setMult({ ...mult, A: e.target.value })} /></Field>
            <Field label="Grade B price multiplier"><Input type="number" step="0.01" required value={mult.B} onChange={(e) => setMult({ ...mult, B: e.target.value })} /></Field>
          </div>
          <ErrorBox>{save.error}</ErrorBox>{saved && <Notice>Settings saved. New tests use them immediately.</Notice>}
          <Btn type="submit" disabled={save.busy}>Save settings</Btn>
        </form>
      </Card>

      <Card title="Calibrate Milk Check with known samples" className="mt-4" actions={active ? <Badge tone="green">Calibrated model active · {active.n} samples · RMSE {active.rmse}%</Badge> : <Badge>Using default baselines</Badge>}>
        <p className="mb-3 text-sm text-slate-600">Mix fresh milk with a <b>known</b> percentage of clean water (0%, 5%, 10%, 20%…), read the lactometer, and add the sample. With at least 8 samples across different dilutions, fit the model: Milk Check then uses a line fitted to your milk and your lactometers instead of the generic baseline.</p>
        <form onSubmit={addSample} className="grid gap-3 md:grid-cols-4">
          <Field label="Lactometer reading"><Input type="number" step="0.1" required value={sample.lactometer_reading} onChange={(e) => setSample({ ...sample, lactometer_reading: e.target.value })} /></Field>
          <Field label="Temperature (°C)"><Input type="number" step="0.1" required value={sample.temperature_c} onChange={(e) => setSample({ ...sample, temperature_c: e.target.value })} /></Field>
          <Field label="Known water added (%)"><Input type="number" step="0.5" min="0" max="100" required value={sample.known_water_percent} onChange={(e) => setSample({ ...sample, known_water_percent: e.target.value })} /></Field>
          <div className="flex items-end"><Btn type="submit" disabled={add.busy} className="w-full">Add sample</Btn></div>
        </form>
        <div className="mt-2"><ErrorBox>{add.error || fit.error}</ErrorBox></div>
        {cal.data && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{cal.data.samples.length} sample(s).</span>
              {cal.data.fit.ok ? <span className="text-slate-600">Fit: water% = {cal.data.fit.intercept} + ({cal.data.fit.slope}) × reading · R² {cal.data.fit.r2} · RMSE {cal.data.fit.rmse}%</span> : <span className="text-amber-700">{cal.data.fit.reason}</span>}
              <Btn size="sm" onClick={apply} disabled={fit.busy || !cal.data.fit.ok}>Apply fitted model</Btn>
              {active && <Btn size="sm" variant="secondary" onClick={clear} disabled={fit.busy}>Revert to defaults</Btn>}
            </div>
            <Table rows={cal.data.samples.slice(0, 20)} empty="No samples yet." columns={[{ header: 'Reading', render: (r) => num(r.lactometer_reading) }, { header: 'Temp', render: (r) => `${num(r.temperature_c)}°C` }, { header: 'Corrected', render: (r) => num(r.corrected_reading, 2) }, { header: 'Known water', render: (r) => `${num(r.known_water_percent)}%` }]} />
          </div>
        )}
      </Card>

      {cal.data && (
        <Card title="Error diagnostics" className="mt-4">
          {cal.data.diagnostics.warnings.length > 0 && <div className="mb-3 space-y-2">{cal.data.diagnostics.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}</div>}
          {cal.data.diagnostics.calibrated ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {[['Fitted model', cal.data.diagnostics.calibrated], ['Generic baseline (for comparison)', cal.data.diagnostics.baseline]].map(([label, m]) => (
                  <div key={label} className="rounded-lg border border-slate-200 p-3">
                    <div className="text-xs font-medium text-slate-500">{label}</div>
                    <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-xs text-slate-600">
                      <div><dt>RMSE</dt><dd className="text-base font-semibold text-slate-900">{m.rmse}%</dd></div>
                      <div><dt>Mean abs. error</dt><dd className="text-base font-semibold text-slate-900">{m.mae}%</dd></div>
                      <div><dt>Bias</dt><dd className="text-base font-semibold text-slate-900">{m.bias > 0 ? '+' : ''}{m.bias}</dd></div>
                      <div><dt>Same grade</dt><dd className="text-base font-semibold text-slate-900">{m.grade_agreement_percent}%</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">Bias above zero means the model over-estimates water; "same grade" is the share of samples whose predicted grade matches the grade of their known water content.</p>
              <div className="mt-3">
                <Table rows={cal.data.diagnostics.per_sample} empty="" columns={[
                  { header: 'Corrected reading', render: (r) => num(r.corrected_reading, 2) }, { header: 'Known water', render: (r) => `${num(r.known_water_percent)}%` },
                  { header: 'Model says', render: (r) => `${num(r.predicted_water_percent)}%` }, { header: 'Error', render: (r) => `${r.residual > 0 ? '+' : ''}${r.residual}` },
                  { header: 'Check', render: (r) => (r.outlier ? <Badge tone="red">Outlier: re-measure</Badge> : !r.grade_match ? <Badge tone="amber">Wrong grade</Badge> : <Badge tone="green">OK</Badge>) },
                ]} />
              </div>
            </>
          ) : <p className="text-sm text-slate-500">Diagnostics appear once at least 8 samples are logged.</p>}
        </Card>
      )}

      <Card title="Try the model" className="mt-4">
        <form onSubmit={preview} className="grid gap-3 md:grid-cols-4">
          <Field label="Lactometer reading"><Input type="number" step="0.1" min="10" max="45" required value={pv.lactometer_reading} onChange={(e) => setPv({ ...pv, lactometer_reading: e.target.value })} /></Field>
          <Field label="Temperature (°C)"><Input type="number" step="0.1" min="0" max="45" required value={pv.temperature_c} onChange={(e) => setPv({ ...pv, temperature_c: e.target.value })} /></Field>
          <Field label="Fat % (optional)"><Input type="number" step="0.1" min="0" max="12" value={pv.fat_percent} onChange={(e) => setPv({ ...pv, fat_percent: e.target.value })} /></Field>
          <div className="flex items-end"><Btn type="submit" disabled={prev.busy} className="w-full">Run</Btn></div>
        </form>
        <div className="mt-2"><ErrorBox>{prev.error}</ErrorBox></div>
        {pvRes && (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[['Current model', pvRes.current_model], ['Generic baseline', pvRes.generic_baseline]].map(([label, m]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="text-xs font-medium text-slate-500">{label}</div>
                <div className="text-xl font-semibold">{num(m.estimated_water_percent)}% <span className="text-sm font-normal text-slate-500">({num(m.estimate_low)}–{num(m.estimate_high)}) · grade {m.grade} · confidence {Math.round(m.confidence * 100)}%</span></div>
                <div className="text-xs text-slate-500">{m.method}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
