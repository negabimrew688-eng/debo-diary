import { query } from '../config/db.js';

/** In-app notification. Respects the user's notification preference; pass the transaction client when inside one. */
export async function notify(client, userId, type, title, body = null, link = null) {
  if (!userId) return;
  await (client || { query }).query(
    `INSERT INTO notifications(user_id, type, title, body, link)
     SELECT id, $2, $3, $4, $5 FROM users WHERE id=$1 AND COALESCE((notification_prefs->>'in_app')::boolean, TRUE)`,
    [userId, type, title, body, link]);
}
