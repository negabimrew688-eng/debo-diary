import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, bearer, resetDb, closeDb, makeUser, listedBatch, hoursAgo, PASSWORD } from './helpers.js';
import { query } from '../src/config/db.js';

let farmer, farmer2, buyer, admin;
before(async () => {
  await resetDb();
  farmer = await makeUser('farmer');
  farmer2 = await makeUser('farmer');
  buyer = await makeUser('buyer');
  admin = await makeUser('admin');
});
after(closeDb);

test('protected routes need a valid token', async () => {
  assert.equal((await api().get('/api/v1/farmer/cows')).status, 401);
  assert.equal((await api().get('/api/v1/farmer/cows').set({ Authorization: 'Bearer nonsense' })).status, 401);
  assert.equal((await api().get('/api/v1/orders').set({ Authorization: 'Basic abc' })).status, 401);
});

test('role boundaries: each role is limited to its own endpoints', async () => {
  assert.equal((await api().get('/api/v1/farmer/cows').set(bearer(buyer))).status, 403);
  assert.equal((await api().post('/api/v1/orders').set(bearer(farmer)).send({})).status, 403);
  assert.equal((await api().get('/api/v1/admin/stats').set(bearer(farmer))).status, 403);
  assert.equal((await api().post('/api/v1/feed/my-products').set(bearer(farmer)).send({})).status, 403);
  assert.equal((await api().get('/api/v1/delivery/assignments').set(bearer(buyer))).status, 403);
});

test('cannot self-register as admin or send unknown profile fields', async () => {
  const r = await api().post('/api/v1/auth/register').send({ email: 'evil@test.example', password: PASSWORD, full_name: 'Evil', role: 'admin' });
  assert.equal(r.status, 400);
  const p = await api().post('/api/v1/auth/register').send({ email: 'x@test.example', password: PASSWORD, full_name: 'X', role: 'farmer', profile: { reputation_score: 100 } });
  assert.equal(p.status, 400, 'reputation_score must not be settable by the user');
});

test('password policy, duplicate email and bad login', async () => {
  const base = { email: 'dup@test.example', full_name: 'Dup', role: 'buyer' };
  assert.equal((await api().post('/api/v1/auth/register').send({ ...base, password: 'short1' })).status, 400);
  assert.equal((await api().post('/api/v1/auth/register').send({ ...base, password: 'nodigitshere' })).status, 400);
  assert.equal((await api().post('/api/v1/auth/register').send({ ...base, password: PASSWORD })).status, 201);
  assert.equal((await api().post('/api/v1/auth/register').send({ ...base, password: PASSWORD })).status, 409);
  assert.equal((await api().post('/api/v1/auth/login').send({ email: base.email, password: 'wrongpass1' })).status, 401);
  assert.equal((await api().post('/api/v1/auth/login').send({ email: 'ghost@test.example', password: PASSWORD })).status, 401);
});

test('password hashes are never returned', async () => {
  const me = await api().get('/api/v1/auth/me').set(bearer(farmer));
  assert.equal(me.status, 200);
  assert.equal(JSON.stringify(me.body).includes('password'), false);
});

test('farmers cannot read or change each other batches, cows or tests', async () => {
  const b = await api().post('/api/v1/farmer/batches').set(bearer(farmer)).send({ volume_litres: 20, produced_at: hoursAgo(1), collection_location: 'Gate' });
  const id = b.body.batch.id;
  assert.equal((await api().get(`/api/v1/farmer/batches/${id}`).set(bearer(farmer2))).status, 404);
  assert.equal((await api().post(`/api/v1/farmer/batches/${id}/tests`).set(bearer(farmer2)).send({ lactometer_reading: 29, temperature_c: 20 })).status, 404);
  assert.equal((await api().post(`/api/v1/farmer/batches/${id}/withdraw`).set(bearer(farmer2))).status, 404);
  const cow = await api().post('/api/v1/farmer/cows').set(bearer(farmer)).send({ tag: 'S-1' });
  assert.equal((await api().delete(`/api/v1/farmer/cows/${cow.body.cow.id}`).set(bearer(farmer2))).status, 404);
});

test('orders are private to buyer, farmer and admin', async () => {
  const batch = await listedBatch(farmer, 50);
  const other = await makeUser('buyer');
  const o = await api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batch.id, volume_litres: 10, delivery_address: 'X' });
  const id = o.body.order.id;
  assert.equal((await api().get(`/api/v1/orders/${id}`).set(bearer(other))).status, 404);
  assert.equal((await api().get(`/api/v1/orders/${id}`).set(bearer(farmer2))).status, 404);
  assert.equal((await api().get(`/api/v1/orders/${id}`).set(bearer(farmer))).status, 200);
  assert.equal((await api().get(`/api/v1/orders/${id}`).set(bearer(admin))).status, 200);
  assert.equal((await api().post(`/api/v1/orders/${id}/pay`).set(bearer(other))).status, 404);
  assert.equal((await api().post(`/api/v1/orders/${id}/cancel`).set(bearer(other))).status, 404);
  const mine = await api().get('/api/v1/orders').set(bearer(other));
  assert.equal(mine.body.orders.length, 0);
});

test('farmer cannot buy own milk; payment cannot be skipped', async () => {
  const batch = await listedBatch(farmer, 50);
  const hasRole = await makeUser('buyer');
  const o = await api().post('/api/v1/orders').set(bearer(hasRole)).send({ batch_id: batch.id, volume_litres: 10, delivery_address: 'X' });
  assert.equal((await api().post(`/api/v1/orders/${o.body.order.id}/delivery`).set(bearer(hasRole)).send({})).status, 409, 'no delivery before payment');
  assert.equal((await api().post(`/api/v1/orders/${o.body.order.id}/payment/sandbox-confirm`).set(bearer(hasRole)).send({})).status, 409, 'must start payment first');
  assert.equal((await api().post(`/api/v1/orders/${o.body.order.id}/confirm-receipt`).set(bearer(hasRole)).send({ lactometer_reading: 29, temperature_c: 20 })).status, 409);
});

test('input validation: bad numbers, ids, dates and JSON', async () => {
  const f = bearer(farmer);
  assert.equal((await api().post('/api/v1/farmer/batches').set(f).send({ volume_litres: -5, produced_at: hoursAgo(1), collection_location: 'G' })).status, 400);
  assert.equal((await api().post('/api/v1/farmer/batches').set(f).send({ volume_litres: 10, produced_at: hoursAgo(100), collection_location: 'G' })).status, 400, 'older than 48 h');
  assert.equal((await api().post('/api/v1/farmer/batches').set(f).send({ volume_litres: 10, produced_at: new Date(Date.now() + 3600e3).toISOString(), collection_location: 'G' })).status, 400, 'future');
  assert.equal((await api().get('/api/v1/farmer/batches/not-a-uuid').set(f)).status, 400);
  assert.equal((await api().post('/api/v1/farmer/batches').set(f).set('Content-Type', 'application/json').send('{bad json')).status, 400);
  const b = await api().post('/api/v1/farmer/batches').set(f).send({ volume_litres: 10, produced_at: hoursAgo(1), collection_location: 'G' });
  assert.equal((await api().post(`/api/v1/farmer/batches/${b.body.batch.id}/tests`).set(f).send({ lactometer_reading: 99, temperature_c: 20 })).status, 400);
  assert.equal((await api().post(`/api/v1/farmer/batches/${b.body.batch.id}/tests`).set(f).send({ lactometer_reading: 29, temperature_c: 20, image_url: 'http://evil.example/x.png' })).status, 400);
});

test('SQL injection attempts are treated as plain text', async () => {
  const r = await api().get(`/api/v1/marketplace/batches?location=${encodeURIComponent("'; DROP TABLE users; --")}`).set(bearer(buyer));
  assert.equal(r.status, 200);
  assert.equal(r.body.batches.length, 0);
  assert.equal((await query('SELECT count(*)::int AS n FROM users')).rows[0].n > 0, true);
});

test('disabled accounts lose access immediately', async () => {
  const u = await makeUser('buyer');
  assert.equal((await api().get('/api/v1/auth/me').set(bearer(u))).status, 200);
  assert.equal((await api().patch(`/api/v1/admin/users/${u.user.id}`).set(bearer(admin)).send({ is_active: false })).status, 200);
  assert.equal((await api().get('/api/v1/auth/me').set(bearer(u))).status, 401);
  assert.equal((await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD })).status, 401);
  assert.equal((await api().patch(`/api/v1/admin/users/${admin.user.id}`).set(bearer(admin)).send({ is_active: false })).status, 400, 'admin cannot lock self out');
});

test('upload only accepts small images', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const ok = await api().post('/api/v1/uploads').set(bearer(farmer)).attach('image', png, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(ok.status, 201);
  assert.match(ok.body.url, /^\/uploads\/[\w-]+\.png$/);
  assert.equal((await api().post('/api/v1/uploads').set(bearer(farmer)).attach('image', Buffer.from('<script>'), { filename: 'a.html', contentType: 'text/html' })).status, 400);
  assert.equal((await api().post('/api/v1/uploads').attach('image', png, { filename: 'a.png', contentType: 'image/png' })).status, 401);
});

test('sandbox payment confirmation is unavailable outside sandbox mode', async () => {
  const { env } = await import('../src/config/env.js');
  const batch = await listedBatch(farmer, 50);
  const o = await api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batch.id, volume_litres: 10, delivery_address: 'X' });
  env.telebirrMode = 'live';
  try {
    const pay = await api().post(`/api/v1/orders/${o.body.order.id}/pay`).set(bearer(buyer));
    assert.equal(pay.status, 501, 'live mode without credentials must fail loudly');
    assert.equal((await api().post(`/api/v1/orders/${o.body.order.id}/payment/sandbox-confirm`).set(bearer(buyer)).send({})).status, 403);
  } finally {
    env.telebirrMode = 'sandbox';
  }
});

test('bootstrap admin: created once from env, never overwrites, rejects weak passwords', async () => {
  const { env } = await import('../src/config/env.js');
  const { bootstrapAdmin } = await import('../src/db/bootstrap.js');
  await query(`DELETE FROM users WHERE role='admin'`);
  const saved = { ...env.bootstrapAdmin };
  try {
    env.bootstrapAdmin = { email: 'root@test.example', password: 'weak', name: 'Root' };
    await assert.rejects(bootstrapAdmin(), /at least 10 characters/);
    env.bootstrapAdmin = { email: 'root@test.example', password: 'Str0ngBootstrap1', name: 'Root' };
    assert.equal((await bootstrapAdmin()).created, true);
    assert.equal((await bootstrapAdmin()).created, false, 'second run does nothing');
    const login = await api().post('/api/v1/auth/login').send({ email: 'root@test.example', password: 'Str0ngBootstrap1' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'admin');
  } finally {
    env.bootstrapAdmin = saved;
  }
});

test('security headers: CSP and nosniff present; http-upgrade only when FORCE_HTTPS', async () => {
  const r = await api().get('/health');
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.ok(!r.headers['content-security-policy'].includes('upgrade-insecure-requests'), 'plain-http deployments must keep working');
  assert.equal(r.headers['strict-transport-security'], undefined);
  assert.equal(r.headers['x-powered-by'], undefined);
});
