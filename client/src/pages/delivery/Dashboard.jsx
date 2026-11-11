import { Link } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, PageHeader, Spinner, Stat, StatusBadge, money, useAction } from '../../components/ui.jsx';

export default function DeliveryDashboard() {
  const { data, error, loading, reload } = useFetch('/delivery/dashboard');
  const a = useAction();
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const { counts: c, earnings: e, performance: p } = data;
  const setAvail = (s) => a.run(async () => { await api.put('/delivery/availability', { availability_status: s }); reload(); });
  return (
    <>
      <PageHeader title="Delivery dashboard" subtitle="Your assignments and earnings" actions={<Link to="/delivery/assignments"><Btn>View assignments</Btn></Link>} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm"><span className="font-medium">Your status:</span><StatusBadge status={data.availability_status} />
          {['available', 'busy', 'offline'].filter((s) => s !== data.availability_status).map((s) => <Btn key={s} size="sm" variant="secondary" onClick={() => setAvail(s)} disabled={a.busy}>Go {s}</Btn>)}
          <span className="text-xs text-slate-500">New assignments are offered only while you are available.</span></div>
        <ErrorBox>{a.error}</ErrorBox>
      </Card>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total assigned" value={c.total_assigned} /><Stat label="Pending requests" value={c.pending} /><Stat label="Active" value={c.active} />
        <Stat label="Completed" value={c.completed} /><Stat label="Rejected" value={c.cancelled} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Earned today" value={money(e.today)} /><Stat label="Total earned" value={money(e.total)} /><Stat label="Awaiting payout" value={money(e.pending_payout)} />
      </div>
      <Card title="Performance" className="mt-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs uppercase text-slate-500">Completion rate</dt><dd className="text-lg font-semibold">{p.completion_rate != null ? `${p.completion_rate}%` : '-'}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">On-time rate</dt><dd className="text-lg font-semibold">{p.on_time_rate != null ? `${p.on_time_rate}%` : '-'}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Avg pickup to delivery</dt><dd className="text-lg font-semibold">{p.avg_minutes_pickup_to_delivery != null ? `${p.avg_minutes_pickup_to_delivery} min` : '-'}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Buyer rating</dt><dd className="text-lg font-semibold">{p.avg_rating != null ? `${p.avg_rating} / 5` : '-'}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">Shown as “-” until there is enough completed work to calculate it.</p>
      </Card>
    </>
  );
}
