import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Select, Spinner, StatusBadge, Table, money, when } from '../../components/ui.jsx';

const ST = ['requested', 'accepted', 'heading_to_pickup', 'collected', 'in_transit', 'delivered', 'rejected'];

export default function Assignments() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useFetch('/delivery/assignments', status ? { status } : {});
  return (
    <>
      <PageHeader title="Assignments" subtitle="Active deliveries are shown first"
        actions={<Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{ST.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</Select>} />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.assignments} empty="No assignments yet." columns={[
            { header: 'Order', render: (d) => <span className="font-mono text-xs">{d.order_ref}</span> },
            { header: 'Pickup', render: (d) => d.pickup_location || '-' },
            { header: 'Destination', render: (d) => d.destination_address || '-' },
            { header: 'Fee', render: (d) => (d.delivery_fee != null ? money(d.delivery_fee) : '-') },
            { header: 'Deadline', render: (d) => (d.deadline ? when(d.deadline) : '-') },
            { header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
            { header: '', render: (d) => <Link className="font-medium text-brand-700 hover:underline" to={`/delivery/assignments/${d.id}`}>Open</Link> },
          ]} />
        )}
      </Card>
    </>
  );
}
