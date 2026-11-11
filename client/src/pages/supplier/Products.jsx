import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Table, Textarea, money, num, useAction } from '../../components/ui.jsx';

const EMPTY = { name: '', category: 'concentrate', price_per_kg: '', stock_kg: '', protein_percent: '', description: '' };

export default function SupplierProducts() {
  const { data, error, loading, reload } = useFetch('/feed/my-products');
  const [f, setF] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    const body = { name: f.name, category: f.category, price_per_kg: Number(f.price_per_kg), stock_kg: Number(f.stock_kg), description: f.description || undefined, ...(f.protein_percent !== '' ? { protein_percent: Number(f.protein_percent) } : {}) };
    a.run(async () => {
      if (editing) await api.patch(`/feed/my-products/${editing}`, body); else await api.post('/feed/my-products', body);
      setF(EMPTY); setEditing(null); reload();
    });
  };
  const edit = (p) => { setEditing(p.id); setF({ name: p.name, category: p.category, price_per_kg: p.price_per_kg, stock_kg: p.stock_kg, protein_percent: p.protein_percent ?? '', description: p.description || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggle = (p) => a.run(async () => { await api.patch(`/feed/my-products/${p.id}`, { active: !p.active }); reload(); });
  const remove = (p) => window.confirm(`Delete ${p.name}? Products with order history are hidden instead.`) && a.run(async () => { await api.delete(`/feed/my-products/${p.id}`); reload(); });

  return (
    <>
      <PageHeader title="My feed products" subtitle="Prices, stock and descriptions farmers see in the feed marketplace" />
      <Card title={editing ? 'Edit product' : 'Add a product'} className="mb-4">
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-5">
          <Field label="Name" className="md:col-span-2"><Input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Category"><Select value={f.category} onChange={set('category')}><option value="concentrate">Concentrate</option><option value="forage">Forage</option><option value="mineral">Mineral</option><option value="by_product">Agro-byproduct</option><option value="other">Other</option></Select></Field>
          <Field label="Price / kg (ETB)"><Input type="number" step="0.5" min="0.5" required value={f.price_per_kg} onChange={set('price_per_kg')} /></Field>
          <Field label="Stock (kg)"><Input type="number" min="0" required value={f.stock_kg} onChange={set('stock_kg')} /></Field>
          <Field label="Protein %"><Input type="number" step="0.5" min="0" max="60" value={f.protein_percent} onChange={set('protein_percent')} /></Field>
          <Field label="Description" className="md:col-span-4"><Textarea rows={2} maxLength={500} value={f.description} onChange={set('description')} /></Field>
          <div className="flex items-end gap-2"><Btn type="submit" disabled={a.busy}>{editing ? 'Save' : 'Add product'}</Btn>{editing && <Btn type="button" variant="secondary" onClick={() => { setEditing(null); setF(EMPTY); }}>Cancel</Btn>}</div>
          <div className="md:col-span-5"><ErrorBox>{a.error}</ErrorBox></div>
        </form>
      </Card>
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.products} empty="No products yet." columns={[
            { header: 'Product', render: (p) => <div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.category.replace('_', ' ')}</div></div> },
            { header: 'Price', render: (p) => `${money(p.price_per_kg)} / kg` }, { header: 'Protein', render: (p) => (p.protein_percent ? `${p.protein_percent}%` : '-') },
            { header: 'Stock', render: (p) => <span className={p.stock_kg < 100 ? 'font-medium text-red-600' : ''}>{num(p.stock_kg, 0)} kg</span> },
            { header: 'Visible', render: (p) => <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'Active' : 'Hidden'}</Badge> },
            { header: '', render: (p) => <span className="flex gap-1"><Btn size="sm" variant="secondary" onClick={() => edit(p)}>Edit</Btn><Btn size="sm" variant="ghost" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Show'}</Btn><Btn size="sm" variant="ghost" onClick={() => remove(p)}>Delete</Btn></span> },
          ]} />
        )}
      </Card>
    </>
  );
}
