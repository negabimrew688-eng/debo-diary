import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../../api.js';
import { Btn, Card, ErrorBox, PageHeader, Spinner, Stat, money, num } from '../../components/ui.jsx';

const GRADE_COLOR = { A: '#10b981', B: '#f59e0b', FAIL: '#ef4444' };

export default function FarmerDashboard() {
  const { data, error, loading } = useFetch('/farmer/dashboard');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  const gradeData = data.grades.map((g) => ({ name: g.grade === 'FAIL' ? 'Failed' : `Grade ${g.grade}`, value: g.count, grade: g.grade }));
  return (
    <>
      <PageHeader title="Farmer dashboard" subtitle="Your milk, quality and earnings at a glance"
        actions={<Link to="/farmer/batches"><Btn>+ New milk batch</Btn></Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Reputation" value={`${data.reputation_score}/100`} hint="Grows with clean, verified batches" tone="good" />
        <Stat label="Paid out" value={money(data.money.earned)} hint="Escrow released to you" />
        <Stat label="In escrow" value={money(data.money.in_escrow)} hint="Paid by buyers, awaiting delivery check" />
        <Stat label="Open orders" value={data.open_orders} hint={`${data.totals.listed} batch(es) listed`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Litres ordered, last 14 days" className="lg:col-span-2">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.sales_last_14_days.map((d) => ({ ...d, litres: Number(d.litres) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={36} />
                <Tooltip formatter={(v) => [`${num(v)} L`, 'Ordered']} />
                <Bar dataKey="litres" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Your quality mix">
          {gradeData.length ? (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={gradeData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label>
                    {gradeData.map((g) => <Cell key={g.grade} fill={GRADE_COLOR[g.grade]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-10 text-center text-sm text-slate-500">Test your first batch to see your quality mix.</p>}
        </Card>
      </div>
      <Card className="mt-4" title="Total production recorded">
        <p className="text-sm text-slate-600">{num(data.totals.litres)} litres across {data.totals.batches} batch(es).</p>
      </Card>
    </>
  );
}
