import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Field, GradeBadge, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea, money, num, useAction, when } from '../../components/ui.jsx';

export default function AdminDisputes() {
  const [status, setStatus] = useState('open');
  const { data, error, loading, reload } = useFetch('/admin/disputes', { status: status || undefined });
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState({ decision: 'refund_buyer', note: '' });
  const a = useAction();
  const resolve = (e) => { e.preventDefault(); a.run(async () => { await api.post(`/admin/disputes/${sel.id}/resolve`, form); setSel(null); reload(); }); };
  const Check = ({ label, c }) => (c ? <div className="rounded-lg bg-slate-50 p-2 text-xs"><div className="font-medium text-slate-700">{label}</div><div>{num(c.estimated_water_percent)}% water <GradeBadge grade={c.grade} /></div></div> : <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{label}: none</div>);
  return (
    <>
      <PageHeader title="Disputes" subtitle="Compare the listing check with the buyer's delivery check, then decide where the escrow goes"
        actions={<Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="">All</option><option value="refund_buyer">Refunded</option><option value="release_to_farmer">Released</option></Select>} />
      {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : !data.disputes.length ? <Card><p className="py-8 text-center text-sm text-slate-500">No disputes here.</p></Card> : (
        <div className="space-y-3">
          {data.disputes.map((d) => (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{d.farmer_name} ↔ {d.buyer_name}</div>
                  <div className="text-xs text-slate-500">{num(d.volume_litres)} L · agreed grade {d.agreed_grade} · {money(d.total_amount)} in escrow · opened {when(d.created_at)}</div>
                  <p className="mt-2 text-sm">“{d.reason}”</p>
                  {d.evidence_url && <a href={d.evidence_url} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline">View evidence photo</a>}
                </div>
                <StatusBadge status={d.status} />
              </div>
              <div className="mt-3 grid max-w-md grid-cols-2 gap-2"><Check label="At listing (farmer)" c={d.listing_check} /><Check label="On delivery (buyer)" c={d.delivery_check} /></div>
              {d.resolution_note && <p className="mt-2 text-sm text-slate-600">Decision: {d.resolution_note}</p>}
              <div className="mt-3 flex gap-2">
                {d.status === 'open' && <Btn onClick={() => { setSel(d); setForm({ decision: 'refund_buyer', note: '' }); }}>Resolve</Btn>}
                <Link to={`/admin/orders/${d.order_id}`} className="self-center text-sm text-brand-700 hover:underline">Order details</Link>
              </div>
            </Card>
          ))}
        </div>
      )}
      {sel && (
        <Modal title="Resolve dispute" onClose={() => setSel(null)}>
          <form onSubmit={resolve} className="space-y-3">
            <Field label="Decision"><Select value={form.decision} onChange={(e) => setForm({ ...form, decision: e.target.value })}><option value="refund_buyer">Refund the buyer</option><option value="release_to_farmer">Release payment to the farmer</option></Select></Field>
            <Field label="Reason for the decision" hint="Both parties can see this note"><Textarea required minLength={3} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <ErrorBox>{a.error}</ErrorBox>
            <div className="flex justify-end gap-2"><Btn type="button" variant="secondary" onClick={() => setSel(null)}>Cancel</Btn><Btn type="submit" disabled={a.busy}>Confirm decision</Btn></div>
          </form>
        </Modal>
      )}
    </>
  );
}
