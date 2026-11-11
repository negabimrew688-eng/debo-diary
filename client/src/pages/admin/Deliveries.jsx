import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Btn, Card, Empty, ErrorBox, Notice, PageHeader, Select, Spinner, StatusBadge, Table, money, useAction, when } from '../../components/ui.jsx';

export default function AdminDeliveries() {
  const del = useFetch('/admin/deliveries');
  const partners = useFetch('/transport/available');
  const earn = useFetch('/admin/earnings');
  const [pick, setPick] = useState({});
  const a = useAction();
  const reloadAll = () => { del.reload(); earn.reload(); partners.reload(); };
  const assign = (w) => a.run(async () => { await api.post('/admin/deliveries/assign', { order_kind: w.kind, order_id: w.id, transporter_id: pick[w.id] }); reloadAll(); });
  const pay = (id) => a.run(async () => { await api.post(`/admin/earnings/${id}/pay`); earn.reload(); });
  return (
    <>
      <PageHeader title="Deliveries" subtitle="Assignments, manual dispatch and partner payouts" />
      <ErrorBox>{a.error}</ErrorBox>
      <Card title="Waiting for a delivery partner" className="mt-3">
        {del.loading ? <Spinner /> : del.error ? <ErrorBox>{del.error}</ErrorBox> : !del.data.awaiting_assignment.length ? <Empty>Nothing is waiting. Ready orders are assigned automatically to available partners.</Empty> : (
          <Table rows={del.data.awaiting_assignment} columns={[
            { header: 'Order', render: (w) => <span className="font-mono text-xs">{w.order_ref}</span> }, { header: 'Kind', key: 'kind' }, { header: 'Pickup', render: (w) => w.pickup_location || '-' }, { header: 'Destination', render: (w) => w.destination || '-' },
            { header: 'Partner', render: (w) => <Select aria-label="Delivery partner" value={pick[w.id] || ''} onChange={(e) => setPick({ ...pick, [w.id]: e.target.value })}><option value="">Choose partner…</option>{partners.data?.transporters.map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.vehicle_type ? ` (${t.vehicle_type})` : ''}</option>)}</Select> },
            { header: '', render: (w) => <Btn size="sm" disabled={!pick[w.id] || a.busy} onClick={() => assign(w)}>Assign</Btn> },
          ]} />
        )}
        {partners.data && !partners.data.transporters.length && <div className="mt-3"><Notice tone="amber">No delivery partner is set to Available right now.</Notice></div>}
      </Card>
      <Card title="All deliveries" className="mt-4">
        {del.data && <Table rows={del.data.deliveries} empty="No deliveries yet." columns={[
          { header: 'Order', render: (d) => <span className="font-mono text-xs">{d.order_ref}</span> }, { header: 'Created', render: (d) => when(d.created_at) }, { header: 'Partner', key: 'partner_name' },
          { header: 'Pickup', render: (d) => d.pickup_location || '-' }, { header: 'Destination', render: (d) => d.destination_address || '-' }, { header: 'Fee', render: (d) => (d.delivery_fee != null ? money(d.delivery_fee) : '-') },
          { header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
        ]} />}
      </Card>
      <Card title="Delivery partner earnings" className="mt-4">
        {earn.data && <Table rows={earn.data.earnings} empty="No earnings yet." columns={[
          { header: 'Date', render: (e) => when(e.created_at) }, { header: 'Partner', key: 'partner_name' }, { header: 'Order', render: (e) => <span className="font-mono text-xs">{e.order_ref}</span> },
          { header: 'Amount', render: (e) => money(e.amount) }, { header: 'Payout', render: (e) => <StatusBadge status={e.payment_status} /> },
          { header: '', render: (e) => (e.payment_status === 'pending' ? <Btn size="sm" variant="secondary" disabled={a.busy} onClick={() => pay(e.id)}>Mark as paid</Btn> : null) },
        ]} />}
        <p className="mt-2 text-xs text-slate-500">“Mark as paid” only records that you paid the partner outside the platform. No money moves automatically.</p>
      </Card>
    </>
  );
}
