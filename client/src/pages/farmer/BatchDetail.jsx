import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Field, Flags, GradeBadge, Input, Notice, PageHeader, Spinner, StatusBadge, Table, Textarea, WaterGauge, money, num, useAction, when } from '../../components/ui.jsx';

/** Average luminance (0-255) of a photo, computed in the browser. Stored as supporting evidence only. */
function brightnessOf(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 48; c.height = 48;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48);
        const px = g.getImageData(0, 0, 48, 48).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        resolve(Math.round((sum / (px.length / 4)) * 100) / 100);
      } catch { resolve(null); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export default function BatchDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch(`/farmer/batches/${id}`);
  const [f, setF] = useState({ lactometer_reading: '', temperature_c: '20', fat_percent: '', conductivity_ms: '', notes: '' });
  const [photo, setPhoto] = useState(null);
  const [result, setResult] = useState(null);
  const [ask, setAsk] = useState('');
  const test = useAction();
  const sell = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const { batch, tests } = data;
  const editable = ['draft', 'tested', 'rejected'].includes(batch.status);

  const runTest = (e) => {
    e.preventDefault();
    test.run(async () => {
      const body = { lactometer_reading: Number(f.lactometer_reading), temperature_c: Number(f.temperature_c) };
      if (f.fat_percent) body.fat_percent = Number(f.fat_percent);
      if (f.conductivity_ms) body.conductivity_ms = Number(f.conductivity_ms);
      if (f.notes) body.notes = f.notes;
      if (photo) {
        const b = await brightnessOf(photo);
        if (b !== null) body.image_brightness = b;
        const fd = new FormData(); fd.append('image', photo);
        const up = await api.post('/uploads', fd);
        body.image_url = up.data.url;
      }
      const r = await api.post(`/farmer/batches/${id}/tests`, body);
      setResult(r.data);
      reload();
    });
  };
  const list = () => sell.run(async () => { await api.post(`/farmer/batches/${id}/list`, ask ? { asking_price: Number(ask) } : {}); setResult(null); reload(); });
  const withdraw = () => sell.run(async () => { await api.post(`/farmer/batches/${id}/withdraw`); reload(); });

  const latest = result?.test || tests.find((t) => t.test_type === 'producer');

  return (
    <>
      <PageHeader title={`Batch of ${num(batch.volume_litres)} L`} subtitle={`${batch.collection_location} · collected ${when(batch.produced_at)}`}
        actions={<Link to="/farmer/batches" className="text-sm text-brand-700 hover:underline">← All batches</Link>} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={batch.status} /><GradeBadge grade={batch.grade} />
        {batch.asking_price && <span className="text-sm text-slate-600">Asking {money(batch.asking_price)} / L · {num(batch.remaining_litres)} L left</span>}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Milk Check">
          {editable ? (
            <form onSubmit={runTest} className="space-y-3">
              <p className="text-xs text-slate-500">Float a lactometer in a sample, read the scale, and note the milk temperature. Add fat % and conductivity if you have a tester: they make the estimate more reliable.</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Lactometer reading" hint="Typically 26–32"><Input type="number" step="0.1" min="10" max="45" required value={f.lactometer_reading} onChange={set('lactometer_reading')} /></Field>
                <Field label="Milk temperature (°C)"><Input type="number" step="0.1" min="0" max="45" required value={f.temperature_c} onChange={set('temperature_c')} /></Field>
                <Field label="Fat % (optional)"><Input type="number" step="0.1" min="0" max="12" value={f.fat_percent} onChange={set('fat_percent')} /></Field>
                <Field label="Conductivity mS/cm (optional)"><Input type="number" step="0.1" min="0" max="12" value={f.conductivity_ms} onChange={set('conductivity_ms')} /></Field>
              </div>
              <Field label="Photo of the sample (optional)" hint="A clear glass of milk on a white background, good light. Stored as evidence; it does not change the percentage."><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} className="block w-full text-sm" /></Field>
              <Field label="Notes (optional)"><Textarea value={f.notes} onChange={set('notes')} maxLength={500} /></Field>
              <ErrorBox>{test.error}</ErrorBox>
              <Btn type="submit" disabled={test.busy}>{test.busy ? 'Analysing…' : 'Run Milk Check'}</Btn>
            </form>
          ) : <Notice tone="blue">This batch is {batch.status.replace('_', ' ')}. Withdraw it to run a new test.</Notice>}
        </Card>

        <Card title="Result">
          {latest ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><GradeBadge grade={latest.grade} />{latest.recommended_price && <span className="text-sm text-slate-600">Recommended {money(latest.recommended_price)} / L</span>}</div>
              <WaterGauge test={latest} />
              <dl className="grid grid-cols-3 gap-2 text-center text-xs text-slate-600">
                <div className="rounded-lg bg-slate-50 p-2"><dt>Corrected reading</dt><dd className="text-sm font-semibold">{num(latest.corrected_reading, 2)}</dd></div>
                <div className="rounded-lg bg-slate-50 p-2"><dt>SNF (est.)</dt><dd className="text-sm font-semibold">{latest.snf_estimated ? `${num(latest.snf_estimated, 2)}%` : '-'}</dd></div>
                <div className="rounded-lg bg-slate-50 p-2"><dt>Fat</dt><dd className="text-sm font-semibold">{latest.fat_percent ? `${num(latest.fat_percent)}%` : '-'}</dd></div>
              </dl>
              <Flags flags={latest.flags} />
              {result?.message && <Notice tone={latest.grade === 'FAIL' ? 'amber' : 'green'}>{result.message}</Notice>}
              <p className="text-xs text-slate-500">Screening estimate from field readings, not a laboratory result.</p>
            </div>
          ) : <p className="py-10 text-center text-sm text-slate-500">Run Milk Check to see the water estimate, grade and price.</p>}
        </Card>
      </div>

      {(batch.status === 'tested') && (
        <Card title="List for sale" className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={`Asking price per litre (recommended ${money(batch.recommended_price)})`}><Input type="number" step="0.5" min="0.5" value={ask} placeholder={String(batch.recommended_price)} onChange={(e) => setAsk(e.target.value)} /></Field>
            <Btn onClick={list} disabled={sell.busy}>List for buyers</Btn>
          </div>
          <p className="mt-2 text-xs text-slate-500">Tests must be under 12 hours old when you list. You can ask up to 115% of the recommended price.</p>
          <div className="mt-2"><ErrorBox>{sell.error}</ErrorBox></div>
        </Card>
      )}
      {batch.status === 'listed' && <div className="mt-4"><Btn variant="secondary" onClick={withdraw} disabled={sell.busy}>Withdraw from marketplace</Btn><div className="mt-2"><ErrorBox>{sell.error}</ErrorBox></div></div>}
      {batch.status === 'rejected' && <div className="mt-4"><Notice tone="amber">This milk failed the water check and cannot be sold. Check containers, then re-test a fresh sample.</Notice></div>}

      <Card title="Test history" className="mt-4">
        <Table rows={tests} columns={[
          { header: 'When', render: (t) => when(t.created_at) },
          { header: 'Type', render: (t) => (t.test_type === 'delivery' ? 'Buyer delivery check' : 'Producer') },
          { header: 'Reading', render: (t) => `${num(t.lactometer_reading)} @ ${num(t.temperature_c)}°C` },
          { header: 'Water', render: (t) => `${num(t.estimated_water_percent)}% (${num(t.estimate_low)}–${num(t.estimate_high)})` },
          { header: 'Grade', render: (t) => <GradeBadge grade={t.grade} /> },
          { header: 'Photo', render: (t) => (t.image_url ? <a href={t.image_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">View</a> : '-') },
        ]} />
      </Card>
    </>
  );
}
