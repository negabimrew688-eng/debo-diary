import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Select, Spinner, StatusBadge, Table, money, when } from '../../components/ui.jsx';

const STATUSES = ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'assigned', 'in_transit', 'delivered', 'cancelled'];
const label = (s) => s.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

export default function BuyerOrders() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useFetch('/buyer/orders', status ? { status } : {});
  return (
    <>
      <PageHeader title="My orders" subtitle="Dairy products and raw milk orders in one place"
        actions={<Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>} />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.orders} empty="No orders yet." columns={[
            { header: 'Order', render: (o) => <span className="font-mono text-xs">{o.ref}</span> },
            { header: 'Type', render: (o) => (o.kind === 'milk' ? 'Raw milk' : 'Dairy products') },
            { header: 'Items', render: (o) => o.summary },
            { header: 'Seller', key: 'seller_name' },
            { header: 'Placed', render: (o) => when(o.created_at) },
            { header: 'Total', render: (o) => money(o.total_amount) },
            { header: 'Payment', render: (o) => (o.payment_status ? <StatusBadge status={o.payment_status} /> : '-') },
            { header: 'Status', render: (o) => <StatusBadge status={o.display_status} /> },
            { header: '', render: (o) => <Link className="font-medium text-brand-700 hover:underline" to={o.kind === 'milk' ? `/orders/${o.id}` : `/buyer/orders/product/${o.id}`}>Open</Link> },
          ]} />
        )}
      </Card>
    </>
  );
}
