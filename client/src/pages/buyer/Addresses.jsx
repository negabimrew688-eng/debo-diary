import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, PageHeader, Spinner, useAction } from '../../components/ui.jsx';

const BLANK = { label: '', address: '', city: '', region: '' };

export default function Addresses() {
  const { data, error, loading, reload } = useFetch('/buyer/addresses');
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(null);
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const clean = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
  const save = (e) => { e.preventDefault(); a.run(async () => { editing ? await api.put(`/buyer/addresses/${editing}`, clean()) : await api.post('/buyer/addresses', clean()); setF(BLANK); setEditing(null); reload(); }); };
  const makeDefault = (id) => a.run(async () => { await api.put(`/buyer/addresses/${id}`, { is_default: true }); reload(); });
  const del = (id) => window.confirm('Delete this address?') && a.run(async () => { await api.delete(`/buyer/addresses/${id}`); reload(); });
  return (
    <>
      <PageHeader title="Delivery addresses" subtitle="Saved places you can choose at checkout" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={editing ? 'Edit address' : 'Add an address'}>
          <form onSubmit={save} className="space-y-3">
            <Field label="Label" hint="e.g. Home, Shop, Hotel"><Input value={f.label} onChange={set('label')} maxLength={40} /></Field>
            <Field label="Street / landmark"><Input required value={f.address} onChange={set('address')} maxLength={250} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="City"><Input value={f.city} onChange={set('city')} /></Field><Field label="Region"><Input value={f.region} onChange={set('region')} /></Field></div>
            <ErrorBox>{a.error}</ErrorBox>
            <div className="flex gap-2"><Btn type="submit" disabled={a.busy}>{editing ? 'Save changes' : 'Add address'}</Btn>{editing && <Btn type="button" variant="ghost" onClick={() => { setEditing(null); setF(BLANK); }}>Cancel</Btn>}</div>
          </form>
        </Card>
        <Card title="Saved addresses">
          {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : !data.addresses.length ? <Empty>No addresses yet.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {data.addresses.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div><div className="font-medium">{x.label || 'Address'} {x.is_default && <Badge tone="green">Default</Badge>}</div><div className="text-slate-500">{[x.address, x.city, x.region].filter(Boolean).join(', ')}</div></div>
                  <div className="flex gap-1">
                    {!x.is_default && <Btn size="sm" variant="secondary" onClick={() => makeDefault(x.id)}>Make default</Btn>}
                    <Btn size="sm" variant="ghost" onClick={() => { setEditing(x.id); setF({ label: x.label || '', address: x.address, city: x.city || '', region: x.region || '' }); }}>Edit</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => del(x.id)}>Delete</Btn>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
