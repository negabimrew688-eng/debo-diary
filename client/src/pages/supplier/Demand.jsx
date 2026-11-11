import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Spinner, Stat, Table, money, num } from '../../components/ui.jsx';

export default function SupplierDemand() {
  const { data, error, loading } = useFetch('/feed/demand');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const regions = data.estimated_demand_by_region;
  return (
    <>
      <PageHeader title="Farmer demand & sales" subtitle="Estimated from registered cows and their milk yield, plus what farmers actually order from you" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Delivered sales" value={money(data.sales.delivered_sales)} tone="good" />
        <Stat label="Pending orders" value={money(data.sales.pending_sales)} />
        <Stat label="Regions with demand" value={regions.length} />
        <Stat label="Weekly herd demand" value={`${num(regions.reduce((s, r) => s + r.weekly_concentrate_kg, 0), 0)} kg`} hint="concentrate, all regions" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Estimated weekly concentrate demand by region (kg)">
          {regions.length ? (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={regions} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="region" width={90} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`${num(v)} kg`, 'Weekly demand']} /><Bar dataKey="weekly_concentrate_kg" fill="#059669" radius={[0, 4, 4, 0]} />
              </BarChart></ResponsiveContainer></div>
          ) : <p className="py-10 text-center text-sm text-slate-500">No farmers have registered cows yet.</p>}
        </Card>
        <Card title="Farmers and cows by region">
          <Table rows={regions} rowKey="region" empty="No demand data yet." columns={[{ header: 'Region', key: 'region' }, { header: 'Farmers', key: 'farmers' }, { header: 'Cows', key: 'cows' }, { header: 'kg / week', render: (r) => num(r.weekly_concentrate_kg, 0) }]} />
        </Card>
      </div>
      <Card title="Your most ordered products" className="mt-4">
        <Table rows={data.your_top_products} rowKey="name" empty="No orders yet." columns={[{ header: 'Product', key: 'name' }, { header: 'Orders', key: 'orders' }, { header: 'Total kg', render: (r) => num(r.kg, 0) }]} />
      </Card>
    </>
  );
}
