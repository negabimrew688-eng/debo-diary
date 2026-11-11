import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, Empty, ErrorBox, Field, Input, Notice, PageHeader, Spinner, StatusBadge, Table, money, num, useAction, when } from '../../components/ui.jsx';

export default function FeedAdvice() {
  const rec = useFetch('/farmer/feed-recommendations');
  const [q, setQ] = useState('');
  const prods = useFetch('/feed/products', { q: q || undefined });
  const orders = useFetch('/feed/orders');
  const [qty, setQty] = useState({});
  const [done, setDone] = useState('');
  const act = useAction();

  const order = (productId, kg) => act.run(async () => {
    await api.post('/feed/orders', { product_id: productId, quantity_kg: Number(kg) });
    setDone('Feed order placed. The supplier will confirm it.');
    prods.reload(); orders.reload(); rec.reload();
  });
  const cancel = (id) => act.run(async () => { await api.post(`/feed/orders/${id}/status`, { status: 'cancelled' }); orders.reload(); prods.reload(); });

  return (
    <>
      <PageHeader title="Feed & advice" subtitle="AI-assisted feed plan from your cows, with suppliers on the marketplace" />
      {rec.loading ? <Spinner /> : rec.error ? <ErrorBox>{rec.error}</ErrorBox> : (
        <Card title="Your feed plan">
          <Table rows={rec.data.plans} empty="Register your cows to get a personal feed plan." rowKey="cow_id" columns={[
            { header: 'Cow', render: (p) => `${p.tag}${p.lactating ? '' : ' (dry)'}` },
            { header: 'Milk / day', render: (p) => `${num(p.daily_yield_litres)} L` },
            { header: 'Concentrate / day', render: (p) => `${num(p.concentrate_kg_per_day)} kg` },
            { header: 'Protein target', render: (p) => `${p.protein_target_percent}%` },
            { header: 'Best match', render: (p) => (p.product ? <span>{p.product.name} <span className="text-slate-500">({money(p.product.price_per_kg)}/kg)</span>{!p.meets_target && <Badge tone="amber">below target</Badge>}</span> : <span className="text-slate-500">No feed in stock</span>) },
            { header: 'Cost / litre', render: (p) => money(p.cost_per_litre) },
          ]} />
          {rec.data.plans.length > 0 && <p className="mt-3 text-sm text-slate-600">Weekly concentrate for the herd: <b>{num(rec.data.weekly_total_kg)} kg</b></p>}
          <div className="mt-3 space-y-2">{rec.data.tips.map((t) => <Notice key={t} tone="amber">{t}</Notice>)}</div>
          <p className="mt-3 text-xs text-slate-500">{rec.data.disclaimer}</p>
        </Card>
      )}

      <Card title="Feed marketplace" className="mt-4" actions={<Input className="w-48" placeholder="Search feed…" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {done && <div className="mb-3"><Notice>{done}</Notice></div>}
        <ErrorBox>{act.error}</ErrorBox>
        {prods.loading ? <Spinner /> : prods.error ? <ErrorBox>{prods.error}</ErrorBox> : !prods.data.products.length ? <Empty>No feed products match.</Empty> : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {prods.data.products.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between"><div className="font-medium">{p.name}</div><Badge tone="blue">{p.category.replace('_', ' ')}</Badge></div>
                <p className="mt-1 text-xs text-slate-500">{p.description}</p>
                <div className="mt-2 text-sm">{money(p.price_per_kg)} / kg · {p.protein_percent ? `${p.protein_percent}% protein` : 'n/a protein'}</div>
                <div className="text-xs text-slate-500">{p.business_name || 'Supplier'} · {num(p.stock_kg, 0)} kg in stock</div>
                <div className="mt-3 flex gap-2">
                  <Input type="number" min="1" max={p.stock_kg} placeholder="kg" value={qty[p.id] || ''} onChange={(e) => setQty({ ...qty, [p.id]: e.target.value })} />
                  <Btn disabled={act.busy || !qty[p.id]} onClick={() => order(p.id, qty[p.id])}>Order</Btn>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="My feed orders" className="mt-4">
        {orders.loading ? <Spinner /> : orders.error ? <ErrorBox>{orders.error}</ErrorBox> : (
          <Table rows={orders.data.orders} empty="No feed orders yet." columns={[
            { header: 'Placed', render: (o) => when(o.created_at) }, { header: 'Product', key: 'product_name' },
            { header: 'Quantity', render: (o) => `${num(o.quantity_kg, 0)} kg` }, { header: 'Total', render: (o) => money(o.total_amount) },
            { header: 'Supplier', key: 'supplier_name' }, { header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
            { header: '', render: (o) => (o.status === 'placed' ? <Btn size="sm" variant="ghost" onClick={() => cancel(o.id)}>Cancel</Btn> : null) },
          ]} />
        )}
      </Card>
    </>
  );
}
