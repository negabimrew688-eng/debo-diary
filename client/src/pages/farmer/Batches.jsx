import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Field, GradeBadge, Input, PageHeader, Spinner, StatusBadge, Table, money, num, useAction, when } from '../../components/ui.jsx';

const nowLocal = () => { const d = new Date(Date.now() - 30 * 60e3); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export default function Batches() {
  const { data, error, loading, reload } = useFetch('/farmer/batches');
  const nav = useNavigate();
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ volume_litres: '', produced_at: nowLocal(), collection_location: '' });
  const { busy, error: formError, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/farmer/batches', { volume_litres: Number(f.volume_litres), produced_at: new Date(f.produced_at).toISOString(), collection_location: f.collection_location });
      nav(`/farmer/batches/${r.data.batch.id}`);
    });
  };
  return (
    <>
      <PageHeader title="Milk batches" subtitle="Record milk, run Milk Check, then list it for buyers"
        actions={<Btn onClick={() => setShow((s) => !s)}>{show ? 'Close' : '+ New batch'}</Btn>} />
      {show && (
        <Card title="New milk batch" className="mb-4">
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
            <Field label="Volume (litres)"><Input type="number" min="1" step="0.5" required value={f.volume_litres} onChange={(e) => setF({ ...f, volume_litres: e.target.value })} /></Field>
            <Field label="Milked / collected at" hint="Within the last 48 hours"><Input type="datetime-local" required value={f.produced_at} onChange={(e) => setF({ ...f, produced_at: e.target.value })} /></Field>
            <Field label="Collection location" className="md:col-span-2"><Input required placeholder="Village, landmark or collection point" value={f.collection_location} onChange={(e) => setF({ ...f, collection_location: e.target.value })} /></Field>
            <div className="md:col-span-4"><ErrorBox>{formError}</ErrorBox></div>
            <div><Btn type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and run Milk Check'}</Btn></div>
          </form>
        </Card>
      )}
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.batches} empty="No batches yet. Create one to get started." columns={[
            { header: 'Collected', render: (b) => when(b.produced_at) },
            { header: 'Litres', render: (b) => `${num(b.remaining_litres)} / ${num(b.volume_litres)}` },
            { header: 'Water est.', render: (b) => (b.estimated_water_percent === null || b.estimated_water_percent === undefined ? '-' : `${num(b.estimated_water_percent)}%`) },
            { header: 'Grade', render: (b) => <GradeBadge grade={b.grade} /> },
            { header: 'Price / L', render: (b) => money(b.asking_price ?? b.recommended_price) },
            { header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
            { header: '', render: (b) => <Link className="font-medium text-brand-700 hover:underline" to={`/farmer/batches/${b.id}`}>Open</Link> },
          ]} />
        )}
      </Card>
      <button className="hidden" onClick={reload} aria-hidden="true" tabIndex={-1} />
    </>
  );
}
