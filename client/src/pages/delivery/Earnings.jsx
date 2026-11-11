import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../../api.js';
import { Card, ErrorBox, Notice, PageHeader, Spinner, Stat, StatusBadge, Table, money, when } from '../../components/ui.jsx';

export default function Earnings() {
  const { data, error, loading } = useFetch('/delivery/earnings');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const s = data.summary;
  return (
    <>
      <PageHeader title="Earnings" subtitle="Based on the delivery fee set by the platform" />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Today" value={money(s.day)} /><Stat label="This week" value={money(s.week)} /><Stat label="This month" value={money(s.month)} />
        <Stat label="Paid out" value={money(s.paid)} /><Stat label="Awaiting payout" value={money(s.pending)} />
      </div>
      <Card title="Last 14 days" className="mb-4">
        <div className="h-52" role="img" aria-label="Daily earnings bar chart"><ResponsiveContainer><BarChart data={data.last_14_days.map((d) => ({ ...d, amount: Number(d.amount) }))}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" /><YAxis width={45} /><Tooltip formatter={(v) => money(v)} /><Bar dataKey="amount" name="Earned" fill="#0f4c3a" radius={[4, 4, 0, 0]} />
        </BarChart></ResponsiveContainer></div>
      </Card>
      <Card title="Transactions">
        <Table rows={data.transactions} empty="Completed deliveries will appear here." columns={[
          { header: 'Date', render: (t) => when(t.created_at) }, { header: 'Order', render: (t) => <span className="font-mono text-xs">{t.order_ref}</span> },
          { header: 'Amount', render: (t) => money(t.amount) }, { header: 'Payout', render: (t) => <StatusBadge status={t.payment_status} /> }, { header: 'Paid on', render: (t) => (t.paid_at ? when(t.paid_at) : '-') },
        ]} />
        <div className="mt-3"><Notice tone="blue">{data.note}</Notice></div>
      </Card>
    </>
  );
}
