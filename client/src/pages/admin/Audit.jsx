import { useFetch } from '../../api.js';
import { Card, ErrorBox, PageHeader, Spinner, Table, when } from '../../components/ui.jsx';

export default function AdminAudit() {
  const { data, error, loading } = useFetch('/admin/audit');
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what: logins, orders, payments, delivery steps, disputes and admin changes" />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.logs} rowKey="id" empty="Nothing recorded yet." columns={[
            { header: 'When', render: (l) => when(l.created_at) }, { header: 'User', render: (l) => l.full_name || 'system' },
            { header: 'Action', key: 'action' }, { header: 'Entity', render: (l) => (l.entity ? `${l.entity} ${String(l.entity_id || '').slice(0, 8)}` : '-') },
            { header: 'Details', render: (l) => <code className="text-xs text-slate-500">{JSON.stringify(l.meta)}</code> },
          ]} />
        )}
      </Card>
    </>
  );
}
