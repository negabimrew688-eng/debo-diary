import request from 'supertest';
import bcrypt from 'bcrypt';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool, query } from '../src/config/db.js';

export const app = createApp();
export const api = () => request(app);
export const bearer = (u) => ({ Authorization: `Bearer ${u.token}` });
export const PASSWORD = 'Testpass123';

export async function resetDb() {
  await migrate({ reset: true, quiet: true });
}
export async function closeDb() {
  await pool.end();
}

let counter = 0;
export async function makeUser(role, { profile, region = 'Amhara', phone } = {}) {
  counter += 1;
  const email = `${role}${counter}@test.example`;
  if (role === 'admin') {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await query(`INSERT INTO users(email,password_hash,full_name,role) VALUES ($1,$2,'Test Admin','admin')`, [email, hash]);
    const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    return { token: res.body.token, user: res.body.user, email };
  }
  const res = await api().post('/api/v1/auth/register').send({
    email, password: PASSWORD, full_name: `Test ${role} ${counter}`, role, region, phone: phone ?? `+2519${String(10000000 + counter).slice(0, 8)}`, profile,
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token, user: res.body.user, email };
}

export const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

/** A farmer with a listed Grade A batch of `litres`. */
export async function listedBatch(farmer, litres = 100) {
  const b = await api().post('/api/v1/farmer/batches').set(bearer(farmer))
    .send({ volume_litres: litres, produced_at: hoursAgo(1), collection_location: 'Azezo gate' });
  const id = b.body.batch.id;
  const t = await api().post(`/api/v1/farmer/batches/${id}/tests`).set(bearer(farmer))
    .send({ lactometer_reading: 29.5, temperature_c: 20, fat_percent: 3.9 });
  if (t.body.test?.grade !== 'A') throw new Error(`expected grade A: ${JSON.stringify(t.body)}`);
  const l = await api().post(`/api/v1/farmer/batches/${id}/list`).set(bearer(farmer)).send({});
  if (l.status !== 200) throw new Error(`list failed: ${JSON.stringify(l.body)}`);
  return l.body.batch;
}

/** Drive an order through payment to the paid state. */
export async function paidOrder(buyer, batchId, litres = 40) {
  const o = await api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batchId, volume_litres: litres, delivery_address: 'Gondar city' });
  if (o.status !== 201) throw new Error(`order failed: ${JSON.stringify(o.body)}`);
  const id = o.body.order.id;
  await api().post(`/api/v1/orders/${id}/pay`).set(bearer(buyer));
  const c = await api().post(`/api/v1/orders/${id}/payment/sandbox-confirm`).set(bearer(buyer)).send({});
  if (c.body.order?.status !== 'paid') throw new Error(`payment not confirmed: ${JSON.stringify(c.body)}`);
  return id;
}
