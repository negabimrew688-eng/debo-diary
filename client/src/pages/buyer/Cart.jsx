import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, Empty, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, Textarea, money, num, useAction } from '../../components/ui.jsx';

export default function Cart() {
  const nav = useNavigate();
  const cart = useFetch('/buyer/cart');
  const addrs = useFetch('/buyer/addresses');
  const [opt, setOpt] = useState('delivery');
  const [addrId, setAddrId] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => { const d = addrs.data?.addresses.find((a) => a.is_default) || addrs.data?.addresses[0]; if (d && !addrId) setAddrId(d.id); }, [addrs.data]); // eslint-disable-line

  const setQ = (id, quantity) => run(async () => { await api.put(`/buyer/cart/${id}`, { quantity }); cart.reload(); });
  const del = (id) => run(async () => { await api.delete(`/buyer/cart/${id}`); cart.reload(); });
  const checkout = () => run(async () => {
    const r = await api.post('/buyer/orders', { delivery_option: opt, ...(opt === 'delivery' ? { address_id: addrId } : {}), delivery_notes: notes || undefined });
    nav(r.data.orders.length === 1 ? `/buyer/orders/product/${r.data.orders[0].id}` : '/buyer/orders');
  });

  if (cart.loading) return <Spinner />;
  if (cart.error) return <ErrorBox>{cart.error}</ErrorBox>;
  const items = cart.data.items;
  const sellers = new Set(items.map((i) => i.seller_id)).size;
  return (
    <>
      <PageHeader title="Your cart" subtitle="Dairy products only. Raw milk batches are ordered from their own page with escrow." />
      {!items.length ? <Card><Empty>Your cart is empty. <Link className="text-brand-700 underline" to="/buyer/market">Browse products</Link>.</Empty></Card> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Items" className="lg:col-span-2">
            <ul className="divide-y divide-slate-100">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div><div className="font-medium">{i.name}</div><div className="text-xs text-slate-500">{i.seller_name} · {money(i.price)} / {i.unit} · {num(i.stock)} in stock</div></div>
                  <div className="flex items-center gap-2">
                    <Input type="number" min="0.1" step="0.1" max={i.stock} aria-label={`Quantity of ${i.name}`} className="w-24" defaultValue={i.quantity} onBlur={(e) => Number(e.target.value) !== Number(i.quantity) && setQ(i.id, Number(e.target.value))} />
                    <span className="w-24 text-right font-medium">{money(i.line_total)}</span>
                    <Btn size="sm" variant="ghost" onClick={() => del(i.id)} aria-label={`Remove ${i.name}`}>Remove</Btn>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Checkout">
            <div className="space-y-3 text-sm">
              <Field label="Delivery option"><Select value={opt} onChange={(e) => setOpt(e.target.value)}><option value="delivery">Delivery to my address</option><option value="self_pickup">Self pickup from the seller</option></Select></Field>
              {opt === 'delivery' && (addrs.data?.addresses.length ? (
                <Field label="Delivery address"><Select value={addrId} onChange={(e) => setAddrId(e.target.value)}>{addrs.data.addresses.map((a) => <option key={a.id} value={a.id}>{a.label ? `${a.label}: ` : ''}{a.address}{a.city ? `, ${a.city}` : ''}</option>)}</Select></Field>
              ) : <Notice tone="amber">Add a delivery address first. <Link className="underline" to="/buyer/addresses">Manage addresses</Link></Notice>)}
              <Field label="Notes for the seller or driver"><Textarea maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              <div className="flex justify-between border-t border-slate-100 pt-3 text-base font-semibold"><span>Total</span><span>{money(cart.data.total)}</span></div>
              {opt === 'delivery' && <p className="text-xs text-slate-500">A delivery fee may be shown on the order. Payment is made with Telebirr on the next step.</p>}
              {sellers > 1 && <Notice tone="blue">Your cart has {sellers} sellers, so it will be split into {sellers} orders.</Notice>}
              <ErrorBox>{error}</ErrorBox>
              <Btn className="w-full" onClick={checkout} disabled={busy || (opt === 'delivery' && !addrId)}>{busy ? 'Placing order…' : 'Place order'}</Btn>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
