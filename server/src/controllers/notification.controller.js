import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id=$1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) ORDER BY created_at DESC LIMIT 100`,
    [req.user.id, req.query.unread === 'true']);
  const unread = (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id])).rows[0].n;
  res.json({ notifications: rows, unread });
});
export const unreadCount = asyncHandler(async (req, res) => {
  res.json({ unread: (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id])).rows[0].n });
});
export const markRead = asyncHandler(async (req, res) => {
  const ids = req.body.ids;
  const r = await query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`, [req.user.id, ids?.length ? ids : null]);
  res.json({ updated: r.rowCount });
});
