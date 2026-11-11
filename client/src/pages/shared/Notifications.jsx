import { Link } from 'react-router-dom';
import { api, useFetch } from '../../api.js';
import { Btn, Card, Empty, ErrorBox, PageHeader, Spinner, cx, useAction, when } from '../../components/ui.jsx';

export default function Notifications() {
  const { data, error, loading, reload } = useFetch('/notifications');
  const a = useAction();
  const read = (ids) => a.run(async () => { await api.post('/notifications/read', ids ? { ids } : {}); reload(); });
  return (
    <>
      <PageHeader title="Notifications" subtitle="Order, payment and delivery updates" actions={data?.unread > 0 && <Btn variant="secondary" onClick={() => read()} disabled={a.busy}>Mark all as read</Btn>} />
      <Card>
        {loading ? <Spinner /> : error ? <ErrorBox>{error}</ErrorBox> : !data.notifications.length ? <Empty>You have no notifications.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {data.notifications.map((n) => (
              <li key={n.id} className={cx('flex items-start justify-between gap-3 py-3 text-sm', !n.read_at && 'font-medium')}>
                <div>
                  <div className="flex items-center gap-2">{!n.read_at && <span aria-label="Unread" className="h-2 w-2 rounded-full bg-amber-500" />}{n.title}</div>
                  <div className="font-normal text-slate-600">{n.body}</div>
                  <div className="text-xs font-normal text-slate-400">{when(n.created_at)}</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {n.link && <Link to={n.link} onClick={() => !n.read_at && read([n.id])} className="text-brand-700 hover:underline">Open</Link>}
                  {!n.read_at && <button onClick={() => read([n.id])} className="text-slate-500 hover:underline">Mark read</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
