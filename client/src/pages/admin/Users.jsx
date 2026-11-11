import { useState } from 'react';
import { api, useFetch } from '../../api.js';
import { Badge, Btn, Card, ErrorBox, Input, PageHeader, Select, Spinner, Table, useAction, when } from '../../components/ui.jsx';

export default function AdminUsers() {
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useFetch('/admin/users', { role: role || undefined, q: q || undefined });
  const a = useAction();
  const patch = (id, body) => a.run(async () => { await api.patch(`/admin/users/${id}`, body); reload(); });
  return (
    <>
      <PageHeader title="Users" subtitle="Enable or disable accounts and record Fayda ID verification" />
      <Card className="mb-4"><div className="grid gap-3 md:grid-cols-3"><Input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option><option value="farmer">Farmers</option><option value="buyer">Buyers</option><option value="feed_supplier">Feed suppliers</option><option value="transporter">Transporters</option><option value="admin">Admins</option></Select></div></Card>
      <ErrorBox>{a.error}</ErrorBox>
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : (
          <Table rows={data.users} empty="No users match." columns={[
            { header: 'Name', render: (u) => <div><div className="font-medium">{u.full_name}</div><div className="text-xs text-slate-500">{u.email}</div></div> },
            { header: 'Role', render: (u) => u.role.replace('_', ' ') }, { header: 'Region', render: (u) => u.region || '-' }, { header: 'Phone', render: (u) => u.phone || '-' },
            { header: 'Joined', render: (u) => when(u.created_at) },
            { header: 'Fayda ID', render: (u) => (u.role === 'admin' ? '-' : <Badge tone={u.fayda_verified ? 'green' : 'gray'}>{u.fayda_verified ? 'Verified' : 'Not verified'}</Badge>) },
            { header: 'Status', render: (u) => <Badge tone={u.is_active ? 'green' : 'red'}>{u.is_active ? 'Active' : 'Disabled'}</Badge> },
            { header: '', render: (u) => u.role === 'admin' ? null : <span className="flex gap-1"><Btn size="sm" variant="secondary" onClick={() => patch(u.id, { fayda_verified: !u.fayda_verified })}>{u.fayda_verified ? 'Unverify' : 'Mark verified'}</Btn><Btn size="sm" variant={u.is_active ? 'ghost' : 'primary'} onClick={() => patch(u.id, { is_active: !u.is_active })}>{u.is_active ? 'Disable' : 'Enable'}</Btn></span> },
          ]} />
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">Fayda verification here is a manual flag set by an administrator after checking the ID. Automated Fayda eKYC is not connected in this build.</p>
    </>
  );
}
