import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Avatar, Badge, Btn, Card, ErrorBox, Field, Notice, PageHeader, Spinner, Stars, StatusBadge, Textarea, money, num, useAction, when } from '../../components/ui.jsx';
import Timeline from '../../components/Timeline.jsx';
import MapPanel from '../../components/MapPanel.jsx';
import { openReceipt } from '../../lib/receipt.js';

function ReviewForm({ order, onDone }) {
  const [f, setF] = useState({ product_rating: 5, delivery_rating: 5, review: '' });
  const a = useAction();
  const submit = (e) => { e.preventDefault(); a.run(async () => { await api.post('/buyer/reviews', { order_kind: 'product', order_id: order.id, product_rating: f.product_rating, ...(order.delivery_option === 'delivery' ? { delivery_rating: f.delivery_rating } : {}), review: f.review || undefined }); onDone(); }); };
  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <Field label="Product quality"><Stars value={f.product_rating} onChange={(n) => setF({ ...f, product_rating: n })} /></Field>
      {order.delivery_option === 'delivery' && <Field label="Delivery service"><Stars value={f.delivery_rating} onChange={(n) => setF({ ...f, delivery_rating: n })} /></Field>}
      <Field label="Comment (optional)"><Textarea maxLength={1000} value={f.review} onChange={(e) => setF({ ...f, review: e.target.value })} /></Field>
      <ErrorBox>{a.error}</ErrorBox>
      <Btn type="submit" disabled={a.busy}>Submit review</Btn>
    </form>
  );
}

export default function BuyerOrderDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch(`/buyer/orders/${id}`);
  const a = useAction();
  const [pay, setPay] = useState(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (data.kind === 'milk') return <Notice>This is a raw milk order. <Link className="underline" to={`/orders/${id}`}>Open the milk order page</Link>.</Notice>;
  const { order: o, items, delivery: d, review, timeline } = data;
  const post = (path, body) => a.run(async () => { const r = await api.post(`/buyer/orders/${id}/${path}`, body); reload(); return r; });
  const startPay = () => a.run(async () => { const r = await api.post(`/buyer/orders/${id}/pay`); setPay(r.data); reload(); });
  const confirmPay = (outcome) => a.run(async () => { await api.post(`/buyer/orders/${id}/payment/sandbox-confirm`, { outcome }); setPay(null); reload(); });
  const receipt = async (print) => a.run(async () => { const r = await api.get(`/buyer/orders/${id}/receipt`); openReceipt(r.data.receipt, { print }); });
  const canCancel = ['pending', 'confirmed'].includes(o.status);
  const canPay = o.status === 'pending' && ['unpaid', 'failed', 'initiated'].includes(o.payment_status);
  const canConfirm = o.delivery_option === 'delivery' && o.status === 'in_transit' && !d?.buyer_confirmed_at;
  const delivered = o.status === 'delivered';

  return (
    <>
      <PageHeader title={`Order ${o.tracking_number}`} subtitle={`Placed ${when(o.created_at)} · ${o.delivery_option === 'delivery' ? 'Delivery' : 'Self pickup'}`}
        actions={<><StatusBadge status={o.status} /><StatusBadge status={o.payment_status} /></>} />
      <ErrorBox>{a.error}</ErrorBox>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Items">
            <ul className="divide-y divide-slate-100 text-sm">{items.map((i) => <li key={i.id} className="flex justify-between py-2"><span>{i.name} · {num(i.quantity)} {i.unit} × {money(i.unit_price)}</span><span className="font-medium">{money(i.quantity * i.unit_price)}</span></li>)}</ul>
            <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><span>Total</span><span>{money(o.total_amount)}</span></div>
            <p className="mt-2 text-xs text-slate-500">Seller: {o.seller_name}{o.seller_region ? `, ${o.seller_region}` : ''}</p>
          </Card>

          {canPay && (
            <Card title="Pay with Telebirr">
              {o.payment_status === 'initiated' ? (
                <div className="space-y-3">
                  <Notice tone="blue">Sandbox mode: no real money moves. Reference <b>{o.payment_reference}</b>. Use these buttons to simulate Telebirr's answer.</Notice>
                  <div className="flex gap-2"><Btn onClick={() => confirmPay('success')} disabled={a.busy}>Approve payment</Btn><Btn variant="secondary" onClick={() => confirmPay('fail')} disabled={a.busy}>Decline</Btn></div>
                </div>
              ) : <Btn onClick={startPay} disabled={a.busy}>{o.payment_status === 'failed' ? 'Retry payment' : `Pay ${money(o.total_amount)} with Telebirr`}</Btn>}
              {pay && <p className="mt-2 text-xs text-slate-500">{pay.message}</p>}
            </Card>
          )}

          {o.delivery_option === 'delivery' && (
            <Card title="Delivery tracking">
              {d ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm">
                    <Avatar url={d.partner_avatar} name={d.partner_name} size={44} />
                    <div><div className="font-medium">{d.partner_name} {d.partner_verified && <Badge tone="green">Verified</Badge>}</div>
                      <div className="text-slate-500">{[d.vehicle_type, d.plate_number].filter(Boolean).join(' · ') || 'Delivery partner'}</div>
                      {d.partner_phone && ['accepted', 'heading_to_pickup', 'collected', 'in_transit'].includes(d.status) && <a className="text-brand-700 hover:underline" href={`tel:${d.partner_phone}`}>{d.partner_phone}</a>}</div>
                    <div className="ml-auto text-right text-xs text-slate-500">Tracking no.<div className="font-mono text-sm text-slate-800">{o.tracking_number}</div></div>
                  </div>
                  {d.confirmation_code && (
                    <Notice tone="amber">Give this code to the delivery partner <b>only when you receive your order</b>: <span className="ml-1 font-mono text-xl font-bold tracking-widest">{d.confirmation_code}</span></Notice>
                  )}
                  <MapPanel pickup={d.pickup_location} destination={d.destination_address} last={d.last_location} />
                </div>
              ) : <p className="text-sm text-slate-500">{data.order.status === 'pending' || data.order.status === 'confirmed' || data.order.status === 'processing' ? 'A delivery partner is assigned once the seller marks the order ready.' : 'No delivery partner has been assigned yet.'}</p>}
            </Card>
          )}
          {o.delivery_option === 'self_pickup' && o.pickup_location && <Card title="Pickup location"><p className="text-sm">{o.pickup_location}</p></Card>}

          {delivered && (
            <Card title="Your review">
              {review ? <div className="text-sm"><Stars value={review.product_rating} /> {review.review && <p className="mt-1 text-slate-600">{review.review}</p>}<p className="mt-1 text-xs text-slate-400">Thank you for your feedback.</p></div> : <ReviewForm order={o} onDone={reload} />}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Status"><Timeline steps={timeline} /></Card>
          <Card title="Actions">
            <div className="flex flex-col gap-2">
              {canConfirm && <Btn onClick={() => window.confirm('Confirm you have received this order?') && post('confirm')} disabled={a.busy}>Confirm I received it</Btn>}
              {canCancel && <Btn variant="danger" onClick={() => window.confirm('Cancel this order?') && post('cancel')} disabled={a.busy}>Cancel order</Btn>}
              <Btn variant="secondary" onClick={() => receipt(false)} disabled={a.busy}>Download receipt</Btn>
              <Btn variant="secondary" onClick={() => receipt(true)} disabled={a.busy}>Print receipt</Btn>
              {o.seller_phone && <a href={`tel:${o.seller_phone}`}><Btn variant="ghost" className="w-full">Call supplier</Btn></a>}
              <Link to="/buyer/orders" className="text-center text-sm text-brand-700 hover:underline">Back to my orders</Link>
            </div>
            {!canCancel && !delivered && o.status !== 'cancelled' && <p className="mt-2 text-xs text-slate-500">Orders can be cancelled only before the seller starts processing.</p>}
          </Card>
          {o.delivery_address && <Card title="Delivery address"><p className="text-sm">{o.delivery_address}</p>{o.delivery_notes && <p className="mt-1 text-xs text-slate-500">Note: {o.delivery_notes}</p>}</Card>}
        </div>
      </div>
    </>
  );
}
