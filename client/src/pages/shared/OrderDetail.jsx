import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, ErrorBox, Field, GradeBadge, Input, Notice, PageHeader, Select, Spinner, StatusBadge, Table, Textarea, money, num, useAction, when } from '../../components/ui.jsx';

const STEPS = ['Ordered', 'Paid (escrow)', 'Transport', 'Delivered', 'Completed'];
function stepIndex(o) {
  if (o.status === 'cancelled') return -1;
  if (o.status === 'pending_payment') return 0;
  if (o.status === 'paid') return o.delivery_status && o.delivery_status !== 'rejected' ? 2 : 1;
  if (o.status === 'in_transit') return 2;
  if (o.status === 'delivered' || o.status === 'disputed') return 3;
  return 4; // completed / refunded
}

function Timeline({ order }) {
  const idx = stepIndex(order);
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Order progress">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${i <= idx ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
          <span>{i < idx || (i === idx && order.status === 'completed') ? '✓' : i + 1}</span>{s}
        </li>
      ))}
    </ol>
  );
}

function PayPanel({ order, onChange }) {
  const a = useAction();
  const start = () => a.run(async () => { await api.post(`/orders/${order.id}/pay`); onChange(); });
  const confirm = (outcome) => a.run(async () => { await api.post(`/orders/${order.id}/payment/sandbox-confirm`, { outcome }); onChange(); });
  const cancel = () => window.confirm('Cancel this order?') && a.run(async () => { await api.post(`/orders/${order.id}/cancel`); onChange(); });
  return (
    <Card title="Pay with Telebirr">
      <p className="text-sm text-slate-600">Your {money(order.total_amount)} is held in escrow and released to the farmer only after you confirm the delivered milk matches the agreed grade.</p>
      {order.payment_status === 'initiated' ? (
        <div className="mt-3 space-y-3">
          <Notice tone="blue">Sandbox mode: no real money moves. Reference <b>{order.payment_reference}</b>. Use the buttons below to simulate Telebirr's confirmation.</Notice>
          <div className="flex gap-2"><Btn onClick={() => confirm('success')} disabled={a.busy}>Approve payment</Btn><Btn variant="secondary" onClick={() => confirm('fail')} disabled={a.busy}>Decline</Btn></div>
        </div>
      ) : <div className="mt-3"><Btn onClick={start} disabled={a.busy}>{order.payment_status === 'failed' ? 'Retry payment' : 'Pay with Telebirr'}</Btn></div>}
      <div className="mt-3"><Btn variant="ghost" size="sm" onClick={cancel} disabled={a.busy}>Cancel order</Btn></div>
      <div className="mt-2"><ErrorBox>{a.error}</ErrorBox></div>
    </Card>
  );
}

function DeliveryPanel({ order, onChange }) {
  const t = useFetch('/transport/available');
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const a = useAction();
  const request = () => a.run(async () => { await api.post(`/orders/${order.id}/delivery`, { transporter_id: pick || undefined, pickup_note: note || undefined }); onChange(); });
  return (
    <Card title="Arrange transport">
      <p className="mb-3 text-sm text-slate-600">{order.delivery_status === 'rejected' ? 'The last transporter declined. Choose another or let Debo assign one.' : 'Pick a registered transporter or let Debo assign the best available vehicle.'}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Transporter"><Select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Auto-assign best available</option>
          {t.data?.transporters.map((x) => <option key={x.id} value={x.id}>{x.company_name || x.full_name} · {x.vehicle_type || 'vehicle'} · {x.capacity_litres ? `${x.capacity_litres} L` : 'any size'}{x.has_cold_storage ? ' · cold chain' : ''}</option>)}
        </Select></Field>
        <Field label="Pickup note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      </div>
      <div className="mt-3"><Btn onClick={request} disabled={a.busy}>Request delivery</Btn></div>
      <div className="mt-2"><ErrorBox>{a.error}</ErrorBox></div>
    </Card>
  );
}

function ConfirmPanel({ order, onChange }) {
  const [f, setF] = useState({ lactometer_reading: '', temperature_c: '20', fat_percent: '' });
  const [res, setRes] = useState(null);
  const [reason, setReason] = useState('');
  const a = useAction();
  const d = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const body = (extra = {}) => ({ lactometer_reading: Number(f.lactometer_reading), temperature_c: Number(f.temperature_c), ...(f.fat_percent ? { fat_percent: Number(f.fat_percent) } : {}), ...extra });
  const check = (e, extra) => { e?.preventDefault(); a.run(async () => { const r = await api.post(`/orders/${order.id}/confirm-receipt`, body(extra)); setRes(r.data); onChange(); }); };
  const dispute = (e) => { e.preventDefault(); d.run(async () => { await api.post(`/orders/${order.id}/dispute`, { reason }); onChange(); }); };

  return (
    <Card title="Check the delivered milk">
      <form onSubmit={check} className="space-y-3">
        <p className="text-sm text-slate-600">Test a sample of the milk you received (agreed grade <b>{order.agreed_grade}</b>). If it matches, payment is released to the farmer.</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Lactometer reading"><Input type="number" step="0.1" min="10" max="45" required value={f.lactometer_reading} onChange={set('lactometer_reading')} /></Field>
          <Field label="Temperature (°C)"><Input type="number" step="0.1" min="0" max="45" required value={f.temperature_c} onChange={set('temperature_c')} /></Field>
          <Field label="Fat % (optional)"><Input type="number" step="0.1" min="0" max="12" value={f.fat_percent} onChange={set('fat_percent')} /></Field>
        </div>
        <ErrorBox>{a.error}</ErrorBox>
        <Btn type="submit" disabled={a.busy}>Run check and confirm</Btn>
      </form>
      {res && !res.matches && !res.released && (
        <div className="mt-4 space-y-3">
          <Notice tone="amber">Estimated {num(res.test.estimated_water_percent)}% water (grade {res.test.grade}) against {num(res.listed_water_percent)}% when listed. Payment is still held.</Notice>
          <form onSubmit={dispute} className="space-y-2">
            <Field label="Open a dispute for an administrator to review"><Textarea required minLength={10} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe what was wrong with the delivery" /></Field>
            <ErrorBox>{d.error}</ErrorBox>
            <div className="flex flex-wrap gap-2"><Btn type="submit" variant="danger" disabled={d.busy}>Open dispute</Btn><Btn type="button" variant="secondary" disabled={a.busy} onClick={() => window.confirm('Accept the milk and release payment to the farmer?') && check(null, { accept_anyway: true })}>Accept anyway and pay</Btn></div>
          </form>
        </div>
      )}
    </Card>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, reload } = useFetch(`/orders/${id}`);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const { order: o, tests, payments, deliveries, disputes } = data;
  const buyer = user.role === 'buyer';
  const needsDelivery = o.status === 'paid' && (!o.delivery_status || o.delivery_status === 'rejected');
  const back = user.role === 'transporter' ? '/transporter' : user.role === 'admin' ? '/admin/orders' : '/orders';

  return (
    <>
      <PageHeader title={`Order · ${num(o.volume_litres)} L at ${money(o.unit_price)}`} subtitle={`${o.farmer_name} → ${o.buyer_name} · ${o.delivery_address}`}
        actions={<Link to={back} className="text-sm text-brand-700 hover:underline">← Back</Link>} />
      <div className="mb-4 flex flex-wrap items-center gap-2"><StatusBadge status={o.status} /><GradeBadge grade={o.agreed_grade} /><span className="text-sm font-medium">{money(o.total_amount)}</span></div>
      {o.status !== 'cancelled' && <Card className="mb-4"><Timeline order={o} /></Card>}

      <div className="space-y-4">
        {buyer && o.status === 'pending_payment' && <PayPanel order={o} onChange={reload} />}
        {(buyer || user.role === 'admin') && needsDelivery && <DeliveryPanel order={o} onChange={reload} />}
        {buyer && o.status === 'delivered' && <ConfirmPanel order={o} onChange={reload} />}
        {o.status === 'disputed' && <Notice tone="amber">This order is under dispute. An administrator is reviewing both quality checks, and the payment stays in escrow until they decide.</Notice>}
        {o.status === 'completed' && <Notice>Quality confirmed and payment released to the farmer.</Notice>}
        {o.status === 'refunded' && <Notice tone="blue">The dispute was resolved in the buyer's favour and the payment was refunded.</Notice>}

        <Card title="Quality checks">
          <Table rows={tests} columns={[
            { header: 'When', render: (t) => when(t.created_at) },
            { header: 'Check', render: (t) => <Badge tone={t.test_type === 'delivery' ? 'purple' : 'blue'}>{t.test_type === 'delivery' ? 'Buyer, on delivery' : 'Producer, at listing'}</Badge> },
            { header: 'Reading', render: (t) => `${num(t.lactometer_reading)} @ ${num(t.temperature_c)}°C` },
            { header: 'Water est.', render: (t) => `${num(t.estimated_water_percent)}% (${num(t.estimate_low)}–${num(t.estimate_high)})` },
            { header: 'Grade', render: (t) => <GradeBadge grade={t.grade} /> },
          ]} />
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Payments (Telebirr)">
            <Table rows={payments} empty="No payment started." columns={[{ header: 'Reference', key: 'reference' }, { header: 'Mode', key: 'mode' }, { header: 'Amount', render: (p) => money(p.amount) }, { header: 'Status', render: (p) => <StatusBadge status={p.status} /> }]} />
          </Card>
          <Card title="Transport">
            <Table rows={deliveries} empty="No transporter assigned yet." columns={[{ header: 'Transporter', key: 'transporter_name' }, { header: 'Status', render: (d) => <StatusBadge status={d.status} /> }, { header: 'Collected', render: (d) => when(d.collected_at) }, { header: 'Delivered', render: (d) => when(d.delivered_at) }]} />
          </Card>
        </div>
        {disputes.length > 0 && (
          <Card title="Disputes"><Table rows={disputes} columns={[{ header: 'Opened', render: (d) => when(d.created_at) }, { header: 'Reason', key: 'reason' }, { header: 'Status', render: (d) => <StatusBadge status={d.status} /> }, { header: 'Decision note', render: (d) => d.resolution_note || '-' }]} /></Card>
        )}
      </div>
    </>
  );
}
