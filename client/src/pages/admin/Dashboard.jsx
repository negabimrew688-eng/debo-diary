import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Spinner, Stat, money, num } from '../../components/ui.jsx';

const GRADE_COLOR = { A: '#10b981', B: '#f59e0b', FAIL: '#ef4444' };

function AiUsage() {
  const { data } = useFetch('/admin/ai-usage');
  return <Stat label="Assistant questions" value={data ? data.totals.total : '-'} hint={data ? `${data.totals.voice} by voice · counts only` : ''} />;
}

export default function AdminDashboard() {
  const { data, error, loading } = useFetch('/admin/stats');
  const trends = useFetch('/admin/trends');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const count = (role) => data.users.find((u) => u.role === role)?.count || 0;
  return (
    <>
      <PageHeader title="Platform dashboard" subtitle="Market activity, quality and money in escrow" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Milk traded" value={`${num(data.money.litres_traded, 0)} L`} hint="completed orders" tone="good" />
        <Stat label="Completed sales" value={money(data.money.gmv_completed)} />
        <Stat label="Held in escrow" value={money(data.money.held_in_escrow)} />
        <Stat label="Open disputes" value={data.disputes.open} hint={`${data.disputes.total} total`} tone={data.disputes.open ? 'bad' : undefined} />
        <Stat label="Farmers" value={count('farmer')} /><Stat label="Buyers" value={count('buyer')} />
        <Stat label="Feed suppliers / transporters" value={`${count('feed_supplier')} / ${count('transporter')}`} />
        <Stat label="Order completion" value={`${data.completion_rate}%`} hint={`${data.batches.listed} batches listed now`} />
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Dairy products &amp; delivery</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Products listed" value={`${data.marketplace.products_available} / ${data.marketplace.products}`} hint="available / total" />
        <Stat label="Product sales (paid)" value={money(data.marketplace.product_sales)} hint={`${data.marketplace.product_orders} orders`} />
        <Stat label="Deliveries" value={`${data.marketplace.completed_deliveries} / ${data.marketplace.total_deliveries}`} hint={`${data.marketplace.active_deliveries} active now`} />
        <Stat label="Avg delivery time" value={data.marketplace.avg_delivery_minutes != null ? `${data.marketplace.avg_delivery_minutes} min` : '-'} hint="pickup to delivered" />
        <Stat label="Delivery fees earned" value={money(data.marketplace.delivery_fees)} hint={`${money(data.marketplace.pending_payouts)} awaiting payout`} />
        <Stat label="Est. platform revenue" value={money(data.marketplace.estimated_platform_revenue)} hint={`${data.marketplace.commission_percent}% placeholder commission`} />
        <Stat label="Unverified users" value={data.marketplace.unverified_users} hint="buyers, farmers, partners" tone={data.marketplace.unverified_users ? 'bad' : undefined} />
        <AiUsage />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Orders, last 14 days" className="lg:col-span-2">
          <div className="h-60"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.orders_last_14_days}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} /><Tooltip /><Bar dataKey="orders" fill="#059669" radius={[4, 4, 0, 0]} /></BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Batch quality mix">
          <div className="h-60"><ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={data.grades.map((g) => ({ name: g.grade === 'FAIL' ? 'Failed' : `Grade ${g.grade}`, value: g.count, grade: g.grade }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label>
              {data.grades.map((g) => <Cell key={g.grade} fill={GRADE_COLOR[g.grade]} />)}</Pie><Tooltip /></PieChart>
          </ResponsiveContainer></div>
        </Card>
      </div>
      <Card title="Quality trend (weekly)" className="mt-4">
        {trends.data?.weeks.length ? (
          <div className="h-60"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends.data.weeks.map((w) => ({ ...w, avg_water: Number(w.avg_water), pct_grade_a: Number(w.pct_grade_a) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={32} /><Tooltip /><Legend />
              <Line type="monotone" dataKey="avg_water" name="Avg water %" stroke="#ef4444" strokeWidth={2} /><Line type="monotone" dataKey="pct_grade_a" name="% graded A" stroke="#059669" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer></div>
        ) : <p className="py-8 text-center text-sm text-slate-500">Quality trends appear once batches have been tested.</p>}
      </Card>
    </>
  );
}
