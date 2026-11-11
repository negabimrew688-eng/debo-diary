import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, num, useAction } from '../../components/ui.jsx';

const EMPTY = { tag: '', breed: '', age_months: '', daily_yield_litres: '', lactating: 'true' };

export default function Cows() {
  const { data, error, loading, reload } = useFetch('/farmer/cows');
  const [f, setF] = useState(EMPTY);
  const { busy, error: formError, run } = useAction();
  const del = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/farmer/cows', { tag: f.tag, breed: f.breed || undefined, age_months: f.age_months ? Number(f.age_months) : undefined, daily_yield_litres: f.daily_yield_litres ? Number(f.daily_yield_litres) : 0, lactating: f.lactating === 'true' });
      setF(EMPTY); reload();
    });
  };
  const remove = (c) => window.confirm(`Remove cow ${c.tag}?`) && del.run(async () => { await api.delete(`/farmer/cows/${c.id}`); reload(); });
  return (
    <>
      <PageHeader title="My cows" subtitle="Registered cows drive your personal feed plan" />
      <Card title="Register a cow" className="mb-4">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-6">
          <Field label="Tag / name"><Input required value={f.tag} onChange={set('tag')} /></Field>
          <Field label="Breed"><Input value={f.breed} onChange={set('breed')} placeholder="Holstein cross" /></Field>
          <Field label="Age (months)"><Input type="number" min="0" value={f.age_months} onChange={set('age_months')} /></Field>
          <Field label="Milk / day (L)"><Input type="number" min="0" step="0.5" value={f.daily_yield_litres} onChange={set('daily_yield_litres')} /></Field>
          <Field label="Lactating"><Select value={f.lactating} onChange={set('lactating')}><option value="true">Yes</option><option value="false">Dry</option></Select></Field>
          <div className="flex items-end"><Btn type="submit" disabled={busy} className="w-full">Add cow</Btn></div>
          <div className="md:col-span-6"><ErrorBox>{formError || del.error}</ErrorBox></div>
        </form>
      </Card>
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.cows} empty="No cows registered yet." columns={[
            { header: 'Tag', key: 'tag' }, { header: 'Breed', render: (c) => c.breed || '-' },
            { header: 'Age', render: (c) => (c.age_months ? `${Math.floor(c.age_months / 12)}y ${c.age_months % 12}m` : '-') },
            { header: 'Milk / day', render: (c) => `${num(c.daily_yield_litres)} L` },
            { header: 'Status', render: (c) => <Badge tone={c.lactating ? 'green' : 'gray'}>{c.lactating ? 'Lactating' : 'Dry'}</Badge> },
            { header: '', render: (c) => <Btn size="sm" variant="ghost" onClick={() => remove(c)}>Remove</Btn> },
          ]} />
        )}
      </Card>
    </>
  );
}
