import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Spinner, Stars, Table, when } from '../../components/ui.jsx';

export default function AdminReviews() {
  const { data, error, loading } = useFetch('/admin/reviews');
  return (
    <>
      <PageHeader title="Reviews" subtitle="Buyer feedback on products and delivery. Open disputes are handled on the Disputes page." />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.reviews} empty="No reviews yet." columns={[
            { header: 'Date', render: (r) => when(r.created_at) }, { header: 'Buyer', key: 'buyer_name' }, { header: 'Seller', key: 'seller_name' },
            { header: 'Product', render: (r) => <Stars value={r.product_rating} /> }, { header: 'Delivery', render: (r) => (r.delivery_rating ? <Stars value={r.delivery_rating} /> : '-') },
            { header: 'Comment', render: (r) => r.review || '-' },
          ]} />
        )}
      </Card>
    </>
  );
}
