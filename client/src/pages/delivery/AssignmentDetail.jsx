import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Field, Input, Notice, PageHeader, Spinner, StatusBadge, Textarea, money, num, useAction, when } from '../../components/ui.jsx';
import Timeline from '../../components/Timeline.jsx';
import MapPanel from '../../components/MapPanel.jsx';
import ImageUpload from '../../components/ImageUpload.jsx';

/** Shares the device position only after the partner switches it on, and only during an active run. */
function LocationShare({ id, active }) {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef(null);
  const send = () => navigator.geolocation.getCurrentPosition(
    (p) => api.post(`/delivery/assignments/${id}/location`, { latitude: p.coords.latitude, longitude: p.coords.longitude }).then(() => setMsg(`Location shared at ${new Date().toLocaleTimeString()}`)).catch(() => setMsg('Could not share location.')),
    () => { setMsg('Location permission was denied or is unavailable.'); setOn(false); }, { enableHighAccuracy: true, timeout: 15000 });
  useEffect(() => {
    if (!on || !active) return undefined;
    send(); timer.current = setInterval(send, 30000);
    return () => clearInterval(timer.current);
  }, [on, active]); // eslint-disable-line
  if (!active || !('geolocation' in navigator)) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); if (!e.target.checked) setMsg(''); }} />Share my location with the buyer while delivering</label>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export default function AssignmentDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch(`/delivery/assignments/${id}`);
  const a = useAction();
  const [done, setDone] = useState({ code: '', notes: '', photo_url: '' });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const d = data.assignment;
  const act = (path, body) => a.run(async () => { await api.post(`/delivery/assignments/${id}/${path}`, body); reload(); });
  const complete = (e) => { e.preventDefault(); a.run(async () => { await api.post(`/delivery/assignments/${id}/complete`, { code: done.code, notes: done.notes || undefined, photo_url: done.photo_url || undefined }); setDone({ code: '', notes: '', photo_url: '' }); reload(); }); };
  const S = d.status;
  const active = ['accepted', 'heading_to_pickup', 'collected', 'in_transit'].includes(S);
  const timeline = [
    { key: 'a', label: 'Assigned to you', done: true, at: d.assigned_at }, { key: 'b', label: 'Accepted', done: Boolean(d.accepted_at), at: d.accepted_at },
    { key: 'c', label: 'Heading to pickup', done: Boolean(d.pickup_started_at), at: d.pickup_started_at }, { key: 'd', label: 'Items collected', done: Boolean(d.collected_at), at: d.collected_at },
    { key: 'e', label: 'On the way to the buyer', done: Boolean(d.in_transit_at), at: d.in_transit_at }, { key: 'f', label: 'Delivered', done: Boolean(d.delivered_at), at: d.delivered_at },
  ];
  return (
    <>
      <PageHeader title={`Delivery ${d.order_ref}`} subtitle={d.kind === 'milk' ? 'Raw milk order' : 'Dairy products order'} actions={<StatusBadge status={S} />} />
      <ErrorBox>{a.error}</ErrorBox>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="What to deliver">
            <ul className="text-sm">{d.items.map((i, k) => <li key={k}>{i.name} · {num(i.quantity)} {i.unit}</li>)}</ul>
            <p className="mt-2 text-sm text-slate-600">Delivery fee: <b>{d.delivery_fee != null ? money(d.delivery_fee) : '-'}</b>{d.deadline && <> · Deadline: {when(d.deadline)}</>}</p>
            {d.instructions && <p className="mt-1 text-sm text-slate-600">Instructions: {d.instructions}</p>}
          </Card>
          <Card title="Route">
            <MapPanel pickup={d.pickup_location} destination={d.destination_address} last={d.last_location} />
            <div className="mt-3"><LocationShare id={id} active={['heading_to_pickup', 'collected', 'in_transit'].includes(S)} /></div>
          </Card>
          <Card title="Contacts">
            {S === 'requested' ? <p className="text-sm text-slate-500">Seller and buyer contact details appear after you accept.</p> : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs uppercase text-slate-500">Seller</dt><dd>{d.seller_name}{d.seller_phone && <> · <a className="text-brand-700 hover:underline" href={`tel:${d.seller_phone}`}>{d.seller_phone}</a></>}</dd></div>
                <div><dt className="text-xs uppercase text-slate-500">Buyer</dt><dd>{d.buyer_name}{d.buyer_phone ? <> · <a className="text-brand-700 hover:underline" href={`tel:${d.buyer_phone}`}>{d.buyer_phone}</a></> : ''}</dd></div>
              </dl>
            )}
          </Card>
          {S === 'delivered' && <Card title="Proof of delivery"><p className="text-sm">Delivered {when(d.delivered_at)}. {d.delivery_notes && <>Notes: {d.delivery_notes}. </>}{d.buyer_confirmed_at && <>Buyer confirmed {when(d.buyer_confirmed_at)}.</>}</p>{d.delivery_photo && <img src={d.delivery_photo} alt="Proof of delivery" className="mt-2 max-h-48 rounded-lg" />}</Card>}
        </div>
        <div className="space-y-4">
          <Card title="Progress"><Timeline steps={timeline} /></Card>
          <Card title="Next step">
            <div className="flex flex-col gap-2 text-sm">
              {S === 'requested' && <><Btn onClick={() => act('accept')} disabled={a.busy}>Accept assignment</Btn><Btn variant="danger" onClick={() => window.confirm('Reject this assignment? It will be offered to another partner.') && act('reject')} disabled={a.busy}>Reject</Btn></>}
              {S === 'accepted' && <Btn onClick={() => act('pickup', { stage: 'start' })} disabled={a.busy}>Start pickup (heading to seller)</Btn>}
              {['accepted', 'heading_to_pickup'].includes(S) && <Btn variant={S === 'accepted' ? 'secondary' : 'primary'} onClick={() => act('pickup', { stage: 'confirm' })} disabled={a.busy}>Confirm pickup (items collected)</Btn>}
              {S === 'collected' && <Btn onClick={() => act('start')} disabled={a.busy}>Start delivery</Btn>}
              {['delivered', 'rejected'].includes(S) && <p className="text-slate-500">This assignment is {S}.</p>}
              <Link to="/delivery/assignments" className="text-center text-brand-700 hover:underline">Back to assignments</Link>
            </div>
          </Card>
          {S === 'in_transit' && (
            <Card title="Complete delivery">
              <form onSubmit={complete} className="space-y-3 text-sm">
                <Notice tone="blue">Ask the buyer for their 6-digit confirmation code. Five wrong tries lock this delivery for 15 minutes.</Notice>
                <Field label="Buyer's confirmation code"><Input required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="off" value={done.code} onChange={(e) => setDone({ ...done, code: e.target.value.replace(/\D/g, '') })} className="font-mono text-lg tracking-widest" /></Field>
                <Field label="Delivery notes (optional)"><Textarea maxLength={500} value={done.notes} onChange={(e) => setDone({ ...done, notes: e.target.value })} /></Field>
                <Field label="Photo proof (optional)"><ImageUpload label="photo" value={done.photo_url} onChange={(u) => setDone({ ...done, photo_url: u })} /></Field>
                <Btn type="submit" disabled={a.busy || done.code.length !== 6}>Complete delivery</Btn>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
