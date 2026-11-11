import { Link } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, Empty, ErrorBox, GradeBadge, Notice, PageHeader, Spinner, StatusBadge, num, useAction, when } from '../../components/ui.jsx';

const NEXT = { accepted: [['collected', 'Confirm milk collected']], collected: [['in_transit', 'Start delivery'], ['delivered', 'Confirm delivered']], in_transit: [['delivered', 'Confirm delivered']] };

export default function Deliveries() {
  const { data, error, loading, reload } = useFetch('/transport/deliveries');
  const a = useAction();
  const respond = (id, action) => a.run(async () => { await api.post(`/transport/deliveries/${id}/respond`, { action }); reload(); });
  const status = (id, s) => a.run(async () => { await api.post(`/transport/deliveries/${id}/status`, { status: s }); reload(); });
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const active = data.deliveries.filter((d) => ['requested', 'accepted', 'collected', 'in_transit'].includes(d.status));
  const past = data.deliveries.filter((d) => !active.includes(d));
  const Card1 = (d) => (
    <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{num(d.volume_litres)} L of milk <GradeBadge grade={d.agreed_grade} /></div><StatusBadge status={d.status} /></div>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div><dt className="text-xs text-slate-500">Pick up from</dt><dd>{d.collection_location}<br /><span className="text-slate-600">{d.farmer_name} {d.farmer_phone && <a className="text-brand-700" href={`tel:${d.farmer_phone}`}>{d.farmer_phone}</a>}</span></dd></div>
        <div><dt className="text-xs text-slate-500">Deliver to</dt><dd>{d.delivery_address}<br /><span className="text-slate-600">{d.buyer_name} {d.buyer_phone && <a className="text-brand-700" href={`tel:${d.buyer_phone}`}>{d.buyer_phone}</a>}</span></dd></div>
        {d.pickup_note && <div className="md:col-span-2"><dt className="text-xs text-slate-500">Note</dt><dd>{d.pickup_note}</dd></div>}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {d.status === 'requested' && (<><Btn onClick={() => respond(d.id, 'accept')} disabled={a.busy}>Accept</Btn><Btn variant="secondary" onClick={() => respond(d.id, 'reject')} disabled={a.busy}>Decline</Btn></>)}
        {(NEXT[d.status] || []).map(([s, label]) => <Btn key={s} onClick={() => status(d.id, s)} disabled={a.busy}>{label}</Btn>)}
        <Link to={`/orders/${d.order_id}`} className="self-center text-sm text-brand-700 hover:underline">Order details</Link>
      </div>
    </div>
  );
  return (
    <>
      <PageHeader title="Deliveries" subtitle="Accept requests, confirm collection and delivery" />
      <Notice tone="blue">Keep milk cool and deliver quickly: the buyer tests it on arrival, and payment is only released if it matches the agreed grade.</Notice>
      <div className="mt-3"><ErrorBox>{a.error}</ErrorBox></div>
      <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-700">Active ({active.length})</h2>
      {active.length ? <div className="space-y-3">{active.map(Card1)}</div> : <Empty>No active deliveries. New requests appear here.</Empty>}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">History</h2>
      <Card>{past.length ? <ul className="divide-y text-sm">{past.map((d) => <li key={d.id} className="flex items-center justify-between py-2"><span>{num(d.volume_litres)} L · {d.collection_location} → {d.delivery_address}</span><span className="flex items-center gap-2 text-xs text-slate-500">{when(d.updated_at)} <StatusBadge status={d.status} /></span></li>)}</ul> : <p className="text-sm text-slate-500">Nothing yet.</p>}</Card>
    </>
  );
}
