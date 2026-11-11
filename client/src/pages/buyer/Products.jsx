import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Notice, Select, Spinner, Stars, money, num, useAction } from '../../components/ui.jsx';

export default function Products() {
  const cats = useFetch('/products/categories');
  const [f, setF] = useState({ search: '', category_id: '', region: '', min_price: '', max_price: '', sort: 'newest', in_stock: 'true' });
  const params = useMemo(() => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), [f]);
  const list = useFetch('/products', params);
  const [cmp, setCmp] = useState(null);
  const [qty, setQty] = useState({});
  const [added, setAdded] = useState('');
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const add = (p) => run(async () => { await api.post('/buyer/cart', { product_id: p.id, quantity: Number(qty[p.id] || 1) }); setAdded(`${p.name} added to your cart.`); });
  const compare = () => run(async () => { const r = await api.get('/products/compare', { params: { search: f.search || undefined, category_id: f.category_id || undefined } }); setCmp(r.data); });

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Search"><Input value={f.search} onChange={set('search')} placeholder="Butter, cheese, yoghurt…" /></Field>
          <Field label="Category"><Select value={f.category_id} onChange={set('category_id')}><option value="">All categories</option>{cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Region / location"><Input value={f.region} onChange={set('region')} /></Field>
          <Field label="Sort by"><Select value={f.sort} onChange={set('sort')}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></Select></Field>
          <Field label="Min price (ETB)"><Input type="number" min="0" value={f.min_price} onChange={set('min_price')} /></Field>
          <Field label="Max price (ETB)"><Input type="number" min="0" value={f.max_price} onChange={set('max_price')} /></Field>
          <Field label="Availability"><Select value={f.in_stock} onChange={set('in_stock')}><option value="true">In stock only</option><option value="">Include sold out</option></Select></Field>
          <div className="flex items-end"><Btn variant="secondary" className="w-full" onClick={compare} disabled={busy}>Compare prices</Btn></div>
        </div>
      </Card>
      <ErrorBox>{error}</ErrorBox>
      {added && <div className="mb-3"><Notice>{added} <Link to="/buyer/cart" className="font-medium underline">Go to cart</Link></Notice></div>}
      {cmp && (
        <Card title="Price comparison" className="mb-4" actions={<Btn size="sm" variant="ghost" onClick={() => setCmp(null)}>Close</Btn>}>
          {cmp.summary ? (
            <>
              <p className="mb-2 text-sm text-slate-600">{cmp.summary.count} offers · lowest <b>{money(cmp.summary.min)}</b> · average {money(cmp.summary.average)} · highest {money(cmp.summary.max)}</p>
              <ul className="divide-y divide-slate-100 text-sm">{cmp.offers.map((o, i) => <li key={o.id} className="flex justify-between py-1.5"><span>{i === 0 && <Badge tone="green">Best price</Badge>} {o.name} · {o.seller_name}</span><span className="font-medium">{money(o.price)} / {o.unit}</span></li>)}</ul>
            </>
          ) : <Empty>No offers match your search.</Empty>}
        </Card>
      )}
      {list.loading ? <Spinner /> : list.error ? <ErrorBox>{list.error}</ErrorBox> : !list.data.products.length ? <Empty>No products match your filters.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.products.map((p) => (
            <div key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex h-32 items-center justify-center bg-brand-50">{p.image_url ? <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" /> : <span aria-hidden="true" className="text-4xl">🥛</span>}</div>
              <div className="flex flex-1 flex-col gap-1 p-4 text-sm">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-slate-900">{p.name}</h3>{p.category_name && <Badge>{p.category_name}</Badge>}</div>
                <div className="text-lg font-semibold text-brand-800">{money(p.price)} <span className="text-xs font-normal text-slate-500">/ {p.unit}</span></div>
                <div className="text-slate-600">{p.seller_name}{p.seller_region ? `, ${p.seller_region}` : ''}{p.seller_verified && <span className="ml-1 text-xs text-brand-700">✓ verified</span>}</div>
                {p.seller_reviews > 0 && <div className="flex items-center gap-1 text-xs text-slate-500"><Stars value={p.seller_rating} /> {p.seller_rating} ({p.seller_reviews})</div>}
                {p.description && <p className="line-clamp-2 text-slate-500">{p.description}</p>}
                <div className="text-xs text-slate-500">{Number(p.stock) > 0 ? `${num(p.stock)} ${p.unit} in stock` : <span className="text-red-600">Sold out</span>}</div>
                <div className="mt-auto flex items-center gap-2 pt-3">
                  <Input type="number" min="0.1" step="0.1" aria-label={`Quantity of ${p.name}`} className="w-20" value={qty[p.id] ?? 1} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} />
                  <Btn size="sm" onClick={() => add(p)} disabled={busy || Number(p.stock) <= 0}>Add to cart</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
