import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, Empty, PageHeader, Spinner, Stat, money, num, when } from '../../components/ui.jsx';

export default function BuyerDashboard() {
  const { data, error, loading } = useFetch('/buyer/dashboard');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const s = data.summary;
  return (
    <>
      <PageHeader title="Buyer dashboard" subtitle="Your purchases, deliveries and suppliers" actions={<Link to="/buyer/market"><Btn>Browse marketplace</Btn></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total purchases" value={s.total_purchases} />
        <Stat label="Active orders" value={s.active_orders} />
        <Stat label="Completed orders" value={s.completed_orders} />
        <Stat label="Pending deliveries" value={s.pending_deliveries} />
        <Stat label="Total spending" value={money(s.total_spending)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Spending, last 6 months (paid orders)">
          <div className="h-56" role="img" aria-label="Monthly spending bar chart">
            <ResponsiveContainer><BarChart data={data.monthly_spending.map((m) => ({ ...m, amount: Number(m.amount) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis width={50} /><Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="amount" name="Spent" fill="#0f4c3a" radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer>
          </div>
        </Card>
        <Card title="Favourite suppliers">
          {data.favorite_suppliers.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {data.favorite_suppliers.map((f) => (
                <li key={f.seller_id} className="flex items-center justify-between py-2"><span className="font-medium">{f.name}</span><span className="text-slate-500">{f.orders} order{f.orders > 1 ? 's' : ''} · {money(f.spent)}</span></li>
              ))}
            </ul>
          ) : <Empty>Suppliers you buy from most will appear here.</Empty>}
        </Card>
        <Card title="Recently purchased" className="lg:col-span-2">
          {data.recent_products.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {data.recent_products.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{p.name}</b> · {num(p.quantity)} {p.unit}</span><span className="text-slate-500">{p.seller_name} · {when(p.created_at)}</span></li>
              ))}
            </ul>
          ) : <Empty>No purchases yet. <Link className="text-brand-700 underline" to="/buyer/market">Browse the marketplace</Link>.</Empty>}
        </Card>
      </div>
    </>
  );
}
