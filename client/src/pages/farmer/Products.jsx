import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, StatusBadge, Table, Textarea, money, num, useAction } from '../../components/ui.jsx';
import ImageUpload from '../../components/ImageUpload.jsx';

const BLANK = { name: '', category_id: '', unit: 'kg', price: '', stock: '', description: '', location_text: '', quality_note: '', image_url: '' };

export default function FarmerProducts() {
  const mine = useFetch('/farmer/products');
  const cats = useFetch('/products/categories');
  const [f, setF] = useState(BLANK);
  const [editing, setEditing] = useState(null);
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ name: f.name, unit: f.unit, price: Number(f.price), stock: Number(f.stock), ...Object.fromEntries(['category_id', 'description', 'location_text', 'quality_note', 'image_url'].filter((k) => f[k]).map((k) => [k, f[k]])) });
  const save = (e) => { e.preventDefault(); a.run(async () => { editing ? await api.patch(`/farmer/products/${editing}`, body()) : await api.post('/farmer/products', body()); setF(BLANK); setEditing(null); mine.reload(); }); };
  const edit = (p) => { setEditing(p.id); setF({ name: p.name, category_id: p.category_id || '', unit: p.unit, price: p.price, stock: p.stock, description: p.description || '', location_text: p.location_text || '', quality_note: p.quality_note || '', image_url: p.image_url || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const toggle = (p) => a.run(async () => { await api.patch(`/farmer/products/${p.id}`, { status: p.status === 'available' ? 'hidden' : 'available' }); mine.reload(); });
  const del = (p) => window.confirm(`Remove ${p.name}?`) && a.run(async () => { await api.delete(`/farmer/products/${p.id}`); mine.reload(); });
  return (
    <>
      <PageHeader title="My dairy products" subtitle="Butter, cheese, yoghurt, ayib, ghee and more, sold to buyers with delivery" />
      <Card title={editing ? 'Edit product' : 'Add a product'} className="mb-4">
        <form onSubmit={save} className="grid gap-3 md:grid-cols-4">
          <Field label="Product name" className="md:col-span-2"><Input required value={f.name} onChange={set('name')} maxLength={120} /></Field>
          <Field label="Category"><Select value={f.category_id} onChange={set('category_id')}><option value="">Choose…</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Unit"><Select value={f.unit} onChange={set('unit')}><option value="kg">kg</option><option value="litre">litre</option><option value="piece">piece</option></Select></Field>
          <Field label="Price per unit (ETB)"><Input type="number" min="0.01" step="0.01" required value={f.price} onChange={set('price')} /></Field>
          <Field label="Stock available"><Input type="number" min="0" step="0.1" required value={f.stock} onChange={set('stock')} /></Field>
          <Field label="Pickup location"><Input value={f.location_text} onChange={set('location_text')} maxLength={120} /></Field>
          <Field label="Quality note"><Input value={f.quality_note} onChange={set('quality_note')} maxLength={300} placeholder="e.g. made today" /></Field>
          <Field label="Description" className="md:col-span-3"><Textarea value={f.description} onChange={set('description')} maxLength={1000} /></Field>
          <Field label="Photo"><ImageUpload value={f.image_url} onChange={(u) => setF({ ...f, image_url: u })} /></Field>
          <div className="md:col-span-4"><ErrorBox>{a.error}</ErrorBox></div>
          <div className="flex gap-2 md:col-span-4"><Btn type="submit" disabled={a.busy}>{editing ? 'Save changes' : 'Add product'}</Btn>{editing && <Btn type="button" variant="ghost" onClick={() => { setEditing(null); setF(BLANK); }}>Cancel</Btn>}</div>
        </form>
      </Card>
      <Card title="Listed products">
        {mine.loading ? <Spinner /> : mine.error ? <ErrorBox>{mine.error}</ErrorBox> : (
          <Table rows={mine.data.products} empty="You have not added any products yet." columns={[
            { header: 'Product', key: 'name' }, { header: 'Category', render: (p) => p.category_name || '-' },
            { header: 'Price', render: (p) => `${money(p.price)} / ${p.unit}` }, { header: 'Stock', render: (p) => `${num(p.stock)} ${p.unit}` },
            { header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            { header: '', render: (p) => <span className="flex gap-1"><Btn size="sm" variant="secondary" onClick={() => edit(p)}>Edit</Btn><Btn size="sm" variant="ghost" onClick={() => toggle(p)}>{p.status === 'available' ? 'Hide' : 'Show'}</Btn><Btn size="sm" variant="ghost" onClick={() => del(p)}>Remove</Btn></span> },
          ]} />
        )}
      </Card>
    </>
  );
}
