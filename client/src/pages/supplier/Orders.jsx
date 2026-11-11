import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, PageHeader, Spinner, StatusBadge, Table, money, num, useAction, when } from '../../components/ui.jsx';

export default function SupplierOrders() {
  const { data, error, loading, reload } = useFetch('/feed/orders');
  const a = useAction();
  const move = (id, status) => a.run(async () => { await api.post(`/feed/orders/${id}/status`, { status }); reload(); });
  return (
    <>
      <PageHeader title="Feed orders" subtitle="Accept orders from farmers, then mark them delivered" />
      <ErrorBox>{a.error}</ErrorBox>
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.orders} empty="No feed orders yet." columns={[
            { header: 'Placed', render: (o) => when(o.created_at) }, { header: 'Product', key: 'product_name' },
            { header: 'Quantity', render: (o) => `${num(o.quantity_kg, 0)} kg` }, { header: 'Total', render: (o) => money(o.total_amount) },
            { header: 'Farmer', render: (o) => <div>{o.farmer_name}<div className="text-xs text-slate-500">{o.farmer_region || ''} {o.farmer_phone ? <a href={`tel:${o.farmer_phone}`} className="text-brand-700">{o.farmer_phone}</a> : null}</div></div> },
            { header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
            { header: '', render: (o) => (
              <span className="flex gap-1">
                {o.status === 'placed' && <Btn size="sm" onClick={() => move(o.id, 'accepted')} disabled={a.busy}>Accept</Btn>}
                {o.status === 'accepted' && <Btn size="sm" onClick={() => move(o.id, 'delivered')} disabled={a.busy}>Mark delivered</Btn>}
                {['placed', 'accepted'].includes(o.status) && <Btn size="sm" variant="ghost" onClick={() => window.confirm('Cancel this order? Stock is returned.') && move(o.id, 'cancelled')} disabled={a.busy}>Cancel</Btn>}
              </span>) },
          ]} />
        )}
      </Card>
    </>
  );
}
