import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Notice, PageHeader, Spinner, StatusBadge, Table, money, useAction, when } from '../../components/ui.jsx';

/** Next seller action for each order status. */
function nextAction(o) {
  if (o.status === 'pending') return null;
  if (o.status === 'confirmed' || (o.status === 'pending' && o.payment_status === 'paid')) return ['processing', 'Start processing'];
  if (o.status === 'processing') return ['ready_for_pickup', 'Mark ready for pickup'];
  if (o.status === 'ready_for_pickup' && o.delivery_option === 'self_pickup') return ['delivered', 'Handed over to buyer'];
  return null;
}

export default function ProductOrders() {
  const { data, error, loading, reload } = useFetch('/farmer/product-orders');
  const a = useAction();
  const set = (id, status) => a.run(async () => { await api.post(`/farmer/product-orders/${id}/status`, { status }); reload(); });
  return (
    <>
      <PageHeader title="Product orders" subtitle="Orders for your dairy products. Confirm paid orders, prepare them and mark them ready." />
      <Notice tone="blue">Marking an order ready for pickup automatically offers it to an available delivery partner. Self-pickup orders are handed over by you.</Notice>
      <div className="mt-3"><ErrorBox>{a.error}</ErrorBox></div>
      <Card className="mt-3">
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.orders} empty="No product orders yet." columns={[
            { header: 'Order', render: (o) => <span className="font-mono text-xs">{o.tracking_number}</span> },
            { header: 'Placed', render: (o) => when(o.created_at) },
            { header: 'Buyer', key: 'buyer_name' },
            { header: 'Items', render: (o) => (o.items || []).map((i) => `${i.name} ×${Number(i.quantity)}`).join(', ') || '-' },
            { header: 'Total', render: (o) => money(o.total_amount) },
            { header: 'Payment', render: (o) => <StatusBadge status={o.payment_status} /> },
            { header: 'Delivery', render: (o) => (o.delivery_option === 'self_pickup' ? 'Self pickup' : o.delivery_status ? <StatusBadge status={o.delivery_status} /> : 'Not assigned') },
            { header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
            { header: '', render: (o) => {
              if (o.status === 'pending' && o.payment_status === 'paid') return <Btn size="sm" onClick={() => set(o.id, 'confirmed')} disabled={a.busy}>Confirm order</Btn>;
              const n = nextAction(o);
              return n ? <Btn size="sm" onClick={() => set(o.id, n[0])} disabled={a.busy}>{n[1]}</Btn> : null;
            } },
          ]} />
        )}
      </Card>
    </>
  );
}
