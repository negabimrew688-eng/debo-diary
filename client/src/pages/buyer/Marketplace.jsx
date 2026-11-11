import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, Empty, ErrorBox, Field, GradeBadge, Input, Modal, Notice, PageHeader, Select, Spinner, Table, money, num, useAction, when } from '../../components/ui.jsx';

function ListingCard({ b, picked, onPick, onOrder }) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{b.farmer_name}{b.fayda_verified && <span title="Fayda ID verified" className="ml-1 text-brand-600">✔</span>}</div>
          <div className="text-xs text-slate-500">{b.collection_location}</div>
        </div>
        <GradeBadge grade={b.grade} />
      </div>
      <div className="mt-3 text-2xl font-semibold text-brand-800">{money(b.asking_price)}<span className="text-sm font-normal text-slate-500"> / L</span></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
        <dt>Available</dt><dd className="text-right font-medium text-slate-800">{num(b.remaining_litres)} L</dd>
        <dt>Added water (est.)</dt><dd className="text-right font-medium text-slate-800">{num(b.estimated_water_percent)}% <span className="text-slate-400">({num(b.estimate_low)}–{num(b.estimate_high)})</span></dd>
        <dt>Confidence</dt><dd className="text-right font-medium text-slate-800">{Math.round(b.confidence * 100)}%</dd>
        <dt>Fat (reported)</dt><dd className="text-right font-medium text-slate-800">{b.fat_percent ? `${num(b.fat_percent)}%` : '-'}</dd>
        <dt>SNF (est.)</dt><dd className="text-right font-medium text-slate-800">{b.snf_estimated ? `${num(b.snf_estimated, 2)}%` : '-'}</dd>
        <dt>Farmer reputation</dt><dd className="text-right font-medium text-slate-800">{b.reputation_score}/100 · {b.completed_sales} sales</dd>
        <dt>Tested</dt><dd className="text-right text-slate-800">{when(b.tested_at)}</dd>
      </dl>
      {b.flags?.includes('screening_only_no_fat') && <div className="mt-2"><Badge tone="amber">No fat reading: screening only</Badge></div>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={picked} onChange={onPick} /> Compare</label>
        <Btn onClick={onOrder}>Order</Btn>
      </div>
    </div>
  );
}

export default function Marketplace() {
  const [flt, setFlt] = useState({ location: '', min_volume: '', max_price: '', grade: '', sort: 'newest' });
  const params = Object.fromEntries(Object.entries(flt).filter(([, v]) => v !== ''));
  const { data, error, loading } = useFetch('/marketplace/batches', params);
  const [picked, setPicked] = useState([]);
  const [compare, setCompare] = useState(null);
  const [order, setOrder] = useState(null);
  const [form, setForm] = useState({ volume_litres: '', delivery_address: '' });
  const nav = useNavigate();
  const place = useAction();
  const cmp = useAction();
  const set = (k) => (e) => setFlt({ ...flt, [k]: e.target.value });
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 4 ? [...p, id] : p));

  const doCompare = () => cmp.run(async () => { const r = await api.get('/marketplace/compare', { params: { ids: picked.join(',') } }); setCompare(r.data.batches); });
  const submit = (e) => {
    e.preventDefault();
    place.run(async () => {
      const r = await api.post('/orders', { batch_id: order.id, volume_litres: Number(form.volume_litres), delivery_address: form.delivery_address });
      nav(`/orders/${r.data.order.id}`);
    });
  };

  return (
    <>
      <PageHeader title="Find milk" subtitle="Every batch is Milk Checked. Compare quality reports, then order with Telebirr escrow."
        actions={picked.length >= 2 && <Btn variant="secondary" onClick={doCompare} disabled={cmp.busy}>Compare {picked.length} suppliers</Btn>} />
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Location"><Input placeholder="Town, woreda or region" value={flt.location} onChange={set('location')} /></Field>
          <Field label="Min litres"><Input type="number" min="0" value={flt.min_volume} onChange={set('min_volume')} /></Field>
          <Field label="Max price / L"><Input type="number" min="0" value={flt.max_price} onChange={set('max_price')} /></Field>
          <Field label="Grade"><Select value={flt.grade} onChange={set('grade')}><option value="">Any</option><option value="A">Grade A</option><option value="B">Grade B</option></Select></Field>
          <Field label="Sort by"><Select value={flt.sort} onChange={set('sort')}><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="quality">Best quality</option><option value="reputation">Farmer reputation</option></Select></Field>
        </div>
      </Card>
      <ErrorBox>{cmp.error}</ErrorBox>
      {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : !data.batches.length ? <Empty>No milk matches these filters right now.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.batches.map((b) => <ListingCard key={b.id} b={b} picked={picked.includes(b.id)} onPick={() => toggle(b.id)} onOrder={() => { setOrder(b); setForm({ volume_litres: '', delivery_address: '' }); }} />)}
        </div>
      )}
      {data && <p className="mt-4 text-xs text-slate-500">{data.note}</p>}

      {order && (
        <Modal title={`Order from ${order.farmer_name}`} onClose={() => setOrder(null)}>
          <form onSubmit={submit} className="space-y-3">
            <Notice tone="blue">{num(order.remaining_litres)} L available at {money(order.asking_price)} / L, agreed grade {order.grade}.</Notice>
            <Field label="Litres"><Input type="number" min="1" max={order.remaining_litres} step="0.5" required value={form.volume_litres} onChange={(e) => setForm({ ...form, volume_litres: e.target.value })} /></Field>
            <Field label="Delivery address"><Input required value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} /></Field>
            {form.volume_litres > 0 && <div className="text-sm font-medium">Total: {money(form.volume_litres * order.asking_price)}</div>}
            <ErrorBox>{place.error}</ErrorBox>
            <div className="flex justify-end gap-2"><Btn type="button" variant="secondary" onClick={() => setOrder(null)}>Cancel</Btn><Btn type="submit" disabled={place.busy}>Place order</Btn></div>
          </form>
        </Modal>
      )}

      {compare && (
        <Modal title="Compare suppliers" onClose={() => setCompare(null)}>
          <div className="overflow-x-auto">
            <Table rows={compare} columns={[
              { header: 'Farmer', render: (b) => b.farmer_name }, { header: 'Grade', render: (b) => <GradeBadge grade={b.grade} /> },
              { header: 'Price / L', render: (b) => <span className={b.cheapest ? 'font-semibold text-brand-700' : ''}>{money(b.asking_price)}{b.cheapest ? ' ★' : ''}</span> },
              { header: 'Water', render: (b) => `${num(b.estimated_water_percent)}%` }, { header: 'Fat', render: (b) => (b.fat_percent ? `${num(b.fat_percent)}%` : '-') },
              { header: 'Litres', render: (b) => num(b.remaining_litres) }, { header: 'Reputation', render: (b) => b.reputation_score },
            ]} />
          </div>
        </Modal>
      )}
    </>
  );
}
