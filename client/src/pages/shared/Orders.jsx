import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Spinner, GradeBadge, StatusBadge, Table, money, num, when } from '../../components/ui.jsx';

export default function Orders() {
  const { user } = useAuth();
  const { data, error, loading } = useFetch('/orders');
  const farmer = user.role === 'farmer';
  return (
    <>
      <PageHeader title={farmer ? 'Orders & payments' : user.role === 'admin' ? 'All orders' : 'My orders'} subtitle="Payments are held in escrow until the delivered milk passes the buyer's quality check" />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.orders} empty="No orders yet." columns={[
            { header: 'Placed', render: (o) => when(o.created_at) },
            { header: farmer ? 'Buyer' : 'Farmer', render: (o) => (farmer ? o.buyer_name : o.farmer_name) },
            ...(user.role === 'admin' ? [{ header: 'Buyer', key: 'buyer_name' }] : []),
            { header: 'Milk', render: (o) => `${num(o.volume_litres)} L`, className: 'whitespace-nowrap' },
            { header: 'Grade', render: (o) => <GradeBadge grade={o.agreed_grade} /> },
            { header: 'Total', render: (o) => money(o.total_amount) },
            { header: 'Payment', render: (o) => <StatusBadge status={o.payment_status} /> },
            { header: 'Delivery', render: (o) => <StatusBadge status={o.delivery_status} /> },
            { header: 'Order', render: (o) => <StatusBadge status={o.status} /> },
            { header: '', render: (o) => <Link className="font-medium text-brand-700 hover:underline" to={`${user?.role === 'admin' ? '/admin' : ''}/orders/${o.id}`}>Open</Link> },
          ]} />
        )}
      </Card>
    </>
  );
}
