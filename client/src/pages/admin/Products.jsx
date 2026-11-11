import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, ErrorBox, Field, Input, PageHeader, Spinner, StatusBadge, Table, money, num, useAction, when } from '../../components/ui.jsx';

export default function AdminProducts() {
  const prods = useFetch('/admin/products');
  const cats = useFetch('/admin/categories');
  const orders = useFetch('/admin/product-orders');
  const [name, setName] = useState('');
  const a = useAction();
  const addCat = (e) => { e.preventDefault(); a.run(async () => { await api.post('/admin/categories', { name }); setName(''); cats.reload(); }); };
  const toggleCat = (c) => a.run(async () => { await api.patch(`/admin/categories/${c.id}`, { active: !c.active }); cats.reload(); });
  const toggleProd = (p) => a.run(async () => { await api.patch(`/admin/products/${p.id}`, { status: p.status === 'available' ? 'hidden' : 'available' }); prods.reload(); });
  return (
    <>
      <PageHeader title="Products & categories" subtitle="Moderate the dairy catalogue and see product orders" />
      <ErrorBox>{a.error}</ErrorBox>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <Card title="Categories">
          <form onSubmit={addCat} className="mb-3 flex gap-2"><Input required maxLength={60} placeholder="New category" aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} /><Btn type="submit" disabled={a.busy}>Add</Btn></form>
          {cats.loading ? <Spinner /> : (
            <ul className="divide-y divide-slate-100 text-sm">{cats.data?.categories.map((c) => <li key={c.id} className="flex items-center justify-between py-2"><span>{c.name} <span className="text-xs text-slate-400">({c.products})</span></span><Btn size="sm" variant="ghost" onClick={() => toggleCat(c)}>{c.active ? 'Disable' : 'Enable'}</Btn></li>)}</ul>
          )}
        </Card>
        <Card title="All products" className="lg:col-span-2">
          {prods.loading ? <Spinner /> : prods.error ? <ErrorBox>{prods.error}</ErrorBox> : (
            <Table rows={prods.data.products} empty="No products yet." columns={[
              { header: 'Product', key: 'name' }, { header: 'Category', render: (p) => p.category_name || '-' }, { header: 'Seller', key: 'seller_name' },
              { header: 'Price', render: (p) => `${money(p.price)} / ${p.unit}` }, { header: 'Stock', render: (p) => num(p.stock) },
              { header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
              { header: '', render: (p) => <Btn size="sm" variant="secondary" onClick={() => toggleProd(p)}>{p.status === 'available' ? 'Hide' : 'Restore'}</Btn> },
            ]} />
          )}
        </Card>
      </div>
      <Card title="Product orders" className="mt-4">
        {orders.loading ? <Spinner /> : orders.error ? <ErrorBox>{orders.error}</ErrorBox> : (
          <Table rows={orders.data.orders} empty="No product orders yet." columns={[
            { header: 'Order', render: (o) => <span className="font-mono text-xs">{o.tracking_number}</span> }, { header: 'Placed', render: (o) => when(o.created_at) },
            { header: 'Buyer', key: 'buyer_name' }, { header: 'Seller', key: 'seller_name' }, { header: 'Total', render: (o) => money(o.total_amount) },
            { header: 'Type', render: (o) => (o.delivery_option === 'self_pickup' ? <Badge>Self pickup</Badge> : <Badge tone="blue">Delivery</Badge>) },
            { header: 'Payment', render: (o) => <StatusBadge status={o.payment_status} /> }, { header: 'Delivery', render: (o) => <StatusBadge status={o.delivery_status} /> }, { header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
          ]} />
        )}
      </Card>
    </>
  );
}
