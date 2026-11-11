import { query } from '../config/db.js';

/** Record an audit entry. Never throws: auditing must not break a business action. */
export async function audit(userId, action, entity, entityId, meta = {}, client = null) {
  try {
    await (client || { query }).query(
      'INSERT INTO audit_logs(user_id, action, entity, entity_id, meta) VALUES ($1,$2,$3,$4,$5)',
      [userId, action, entity, entityId ? String(entityId) : null, JSON.stringify(meta)]
    );
  } catch (err) {
    console.error('audit failed:', err.message);
  }
}
