import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, StatusBadge, Table, Textarea, money, num, useAction } from '../../components/ui.jsx';

const KIND = { compost: 'Compost', cow_manure: 'Cow manure', whey: 'Whey', other: 'Other' };

/** mine=true: farmer manages listings. Otherwise: everyone browses available listings. */
export default function Byproducts({ mine = false }) {
  const browse = useFetch('/byproducts');
  const own = useFetch(mine ? '/byproducts/mine' : null);
  const [f, setF] = useState({ kind: 'compost', quantity_kg: '', price_per_kg: '', description: '' });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/byproducts', { kind: f.kind, quantity_kg: Number(f.quantity_kg), price_per_kg: Number(f.price_per_kg), description: f.description || undefined });
      setF({ kind: 'compost', quantity_kg: '', price_per_kg: '', description: '' }); own.reload(); browse.reload();
    });
  };
  const setStatus = (id, status) => run(async () => { await api.post(`/byproducts/${id}/status`, { status }); own.reload(); browse.reload(); });

  return (
    <>
      <PageHeader title="Compost & dairy byproducts" subtitle="Circular loop: manure and compost from dairy farms, sold back to farms" />
      {mine && (
        <Card title="List a byproduct" className="mb-4">
          <form onSubmit={add} className="grid gap-3 md:grid-cols-4">
            <Field label="Type"><Select value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Quantity (kg)"><Input type="number" min="1" required value={f.quantity_kg} onChange={set('quantity_kg')} /></Field>
            <Field label="Price per kg (ETB)"><Input type="number" min="0" step="0.1" required value={f.price_per_kg} onChange={set('price_per_kg')} /></Field>
            <div className="flex items-end"><Btn type="submit" disabled={busy} className="w-full">List</Btn></div>
            <Field label="Description" className="md:col-span-4"><Textarea value={f.description} onChange={set('description')} maxLength={500} /></Field>
            <div className="md:col-span-4"><ErrorBox>{error}</ErrorBox></div>
          </form>
        </Card>
      )}
      {mine && (
        <Card title="My listings" className="mb-4">
          {own.loading ? <Spinner /> : own.error ? <ErrorBox>{own.error}</ErrorBox> : (
            <Table rows={own.data.listings} empty="You have not listed anything yet." columns={[
              { header: 'Type', render: (l) => KIND[l.kind] }, { header: 'Quantity', render: (l) => `${num(l.quantity_kg, 0)} kg` },
              { header: 'Price', render: (l) => `${money(l.price_per_kg)} / kg` }, { header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
              { header: '', render: (l) => (l.status === 'available' ? <span className="flex gap-1"><Btn size="sm" variant="secondary" onClick={() => setStatus(l.id, 'sold')}>Mark sold</Btn><Btn size="sm" variant="ghost" onClick={() => setStatus(l.id, 'withdrawn')}>Withdraw</Btn></span> : null) },
            ]} />
          )}
        </Card>
      )}
      <Card title="Available now">
        <Notice tone="blue">Contact the seller directly to arrange pickup and payment.</Notice>
        <div className="mt-3">
          {browse.loading ? <Spinner /> : browse.error ? <ErrorBox>{browse.error}</ErrorBox> : (
            <Table rows={browse.data.listings} empty="No byproducts listed right now." columns={[
              { header: 'Type', render: (l) => KIND[l.kind] }, { header: 'Quantity', render: (l) => `${num(l.quantity_kg, 0)} kg` },
              { header: 'Price', render: (l) => `${money(l.price_per_kg)} / kg` }, { header: 'Seller', render: (l) => `${l.farmer_name}${l.region ? `, ${l.region}` : ''}` },
              { header: 'Contact', render: (l) => (l.farmer_phone ? <a className="text-brand-700 hover:underline" href={`tel:${l.farmer_phone}`}>{l.farmer_phone}</a> : '-') },
              { header: 'Details', render: (l) => l.description || '-' },
            ]} />
          )}
        </div>
      </Card>
    </>
  );
}
