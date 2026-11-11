import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, bearer, resetDb, closeDb, makeUser, listedBatch, paidOrder, hoursAgo } from './helpers.js';
import { query } from '../src/config/db.js';

let farmer, buyer, transporter, supplier, admin;

before(async () => {
  await resetDb();
  farmer = await makeUser('farmer', { phone: '+251911555001' });
  buyer = await makeUser('buyer', { profile: { buyer_type: 'processor', org_name: 'Test Dairy' } });
  transporter = await makeUser('transporter', { profile: { company_name: 'T1', capacity_litres: 500, service_area: 'Amhara' } });
  supplier = await makeUser('feed_supplier', { profile: { business_name: 'Feed Co' } });
  admin = await makeUser('admin');
});
after(closeDb);

const deliver = async (orderId) => {
  const d = await api().post(`/api/v1/orders/${orderId}/delivery`).set(bearer(buyer)).send({});
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.delivery.transporter_id, transporter.user.id);
  const did = d.body.delivery.id;
  assert.equal((await api().post(`/api/v1/delivery/assignments/${did}/accept`).set(bearer(transporter))).status, 200);
  assert.equal((await api().post(`/api/v1/delivery/assignments/${did}/pickup`).set(bearer(transporter)).send({})).status, 200);
  assert.equal((await api().post(`/api/v1/delivery/assignments/${did}/start`).set(bearer(transporter))).status, 200);
  const code = (await api().get(`/api/v1/orders/${orderId}`).set(bearer(buyer))).body.order.delivery_code;
  assert.match(code, /^\d{6}$/);
  const done = await api().post(`/api/v1/delivery/assignments/${did}/complete`).set(bearer(transporter)).send({ code });
  assert.equal(done.status, 200, JSON.stringify(done.body));
};

test('full happy path: test, list, order, escrow, transport, quality check releases payment', async () => {
  const batch = await listedBatch(farmer, 100);
  assert.equal(batch.grade, 'A');

  const browse = await api().get('/api/v1/marketplace/batches?grade=A&min_volume=50').set(bearer(buyer));
  assert.equal(browse.status, 200);
  const found = browse.body.batches.find((b) => b.id === batch.id);
  assert.ok(found, 'batch visible to buyers');
  assert.ok(found.estimated_water_percent <= 5 && found.confidence > 0);

  const orderId = await paidOrder(buyer, batch.id, 40);
  const held = await query('SELECT status, amount FROM payments WHERE order_id=$1', [orderId]);
  assert.equal(held.rows[0].status, 'held');
  assert.equal(held.rows[0].amount, 40 * batch.asking_price);

  await deliver(orderId);

  const confirm = await api().post(`/api/v1/orders/${orderId}/confirm-receipt`).set(bearer(buyer)).send({ lactometer_reading: 29.4, temperature_c: 21, fat_percent: 3.8 });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.matches, true);
  assert.equal(confirm.body.order.status, 'completed');
  assert.equal(confirm.body.order.payment_status, 'released');

  const dash = await api().get('/api/v1/farmer/dashboard').set(bearer(farmer));
  assert.equal(dash.body.money.earned, 40 * batch.asking_price);
  assert.ok(dash.body.reputation_score > 50);
});

test('quality mismatch holds escrow, buyer disputes, admin refunds', async () => {
  const batch = await listedBatch(farmer, 80);
  const orderId = await paidOrder(buyer, batch.id, 30);
  await deliver(orderId);

  const bad = await api().post(`/api/v1/orders/${orderId}/confirm-receipt`).set(bearer(buyer)).send({ lactometer_reading: 24, temperature_c: 20 });
  assert.equal(bad.body.matches, false);
  assert.equal(bad.body.released, false);
  assert.equal(bad.body.order.status, 'delivered');

  const d = await api().post(`/api/v1/orders/${orderId}/dispute`).set(bearer(buyer)).send({ reason: 'Milk was clearly diluted on arrival' });
  assert.equal(d.status, 201);
  assert.equal((await query('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status, 'disputed');

  assert.equal((await api().post(`/api/v1/admin/disputes/${d.body.dispute.id}/resolve`).set(bearer(buyer)).send({ decision: 'refund_buyer', note: 'nope' })).status, 403);

  const list = await api().get('/api/v1/admin/disputes?status=open').set(bearer(admin));
  const row = list.body.disputes.find((x) => x.id === d.body.dispute.id);
  assert.ok(row.delivery_check && row.listing_check, 'admin sees both quality checks');

  const res = await api().post(`/api/v1/admin/disputes/${d.body.dispute.id}/resolve`).set(bearer(admin)).send({ decision: 'refund_buyer', note: 'Delivery check confirms dilution' });
  assert.equal(res.status, 200);
  const after = await query('SELECT o.status AS o, p.status AS p FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.id=$1', [orderId]);
  assert.deepEqual(after.rows[0], { o: 'refunded', p: 'refunded' });
  assert.equal((await api().post(`/api/v1/admin/disputes/${d.body.dispute.id}/resolve`).set(bearer(admin)).send({ decision: 'release_to_farmer', note: 'again' })).status, 409, 'cannot resolve twice');
});

test('overselling is blocked and cancelling an unpaid order restores volume', async () => {
  const batch = await listedBatch(farmer, 50);
  const o1 = await api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batch.id, volume_litres: 50, delivery_address: 'X' });
  assert.equal(o1.status, 201);
  const o2 = await api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batch.id, volume_litres: 1, delivery_address: 'X' });
  assert.equal(o2.status, 404, 'sold-out batch is no longer available');
  assert.equal((await api().post(`/api/v1/orders/${o1.body.order.id}/cancel`).set(bearer(buyer))).status, 200);
  const again = await api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batch.id, volume_litres: 20, delivery_address: 'X' });
  assert.equal(again.status, 201);
});

test('concurrent orders cannot oversell a batch', async () => {
  const batch = await listedBatch(farmer, 100);
  const results = await Promise.all(Array.from({ length: 5 }, () =>
    api().post('/api/v1/orders').set(bearer(buyer)).send({ batch_id: batch.id, volume_litres: 30, delivery_address: 'X' })));
  const ok = results.filter((r) => r.status === 201).length;
  assert.equal(ok, 3, `expected exactly 3 of 5 to fit in 100 L, got ${ok}`);
  const left = (await query('SELECT remaining_litres FROM milk_batches WHERE id=$1', [batch.id])).rows[0].remaining_litres;
  assert.equal(left, 10);
});

test('rejected batches and stale tests cannot be listed', async () => {
  const b = await api().post('/api/v1/farmer/batches').set(bearer(farmer)).send({ volume_litres: 30, produced_at: hoursAgo(1), collection_location: 'Gate' });
  const id = b.body.batch.id;
  const fail = await api().post(`/api/v1/farmer/batches/${id}/tests`).set(bearer(farmer)).send({ lactometer_reading: 22, temperature_c: 20 });
  assert.equal(fail.body.test.grade, 'FAIL');
  assert.equal((await api().post(`/api/v1/farmer/batches/${id}/list`).set(bearer(farmer)).send({})).status, 400);

  await api().post(`/api/v1/farmer/batches/${id}/tests`).set(bearer(farmer)).send({ lactometer_reading: 29.5, temperature_c: 20, fat_percent: 3.8 });
  await query(`UPDATE milk_tests SET created_at = now() - interval '13 hours' WHERE batch_id=$1`, [id]);
  const stale = await api().post(`/api/v1/farmer/batches/${id}/list`).set(bearer(farmer)).send({});
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /older than 12 hours/);
});

test('asking price above 115% of recommended is refused', async () => {
  const b = await api().post('/api/v1/farmer/batches').set(bearer(farmer)).send({ volume_litres: 30, produced_at: hoursAgo(1), collection_location: 'Gate' });
  const id = b.body.batch.id;
  await api().post(`/api/v1/farmer/batches/${id}/tests`).set(bearer(farmer)).send({ lactometer_reading: 29.5, temperature_c: 20, fat_percent: 3.8 });
  assert.equal((await api().post(`/api/v1/farmer/batches/${id}/list`).set(bearer(farmer)).send({ asking_price: 500 })).status, 400);
});

test('transporter rejection reassigns to another available transporter', async () => {
  const second = await makeUser('transporter', { profile: { company_name: 'T2', capacity_litres: 800, service_area: 'Amhara' } });
  const batch = await listedBatch(farmer, 100);
  const orderId = await paidOrder(buyer, batch.id, 20);
  const d = await api().post(`/api/v1/orders/${orderId}/delivery`).set(bearer(buyer)).send({});
  const first = [transporter, second].find((t) => t.user.id === d.body.delivery.transporter_id);
  const other = first === transporter ? second : transporter;
  const rej = await api().post(`/api/v1/delivery/assignments/${d.body.delivery.id}/reject`).set(bearer(first));
  assert.equal(rej.status, 200);
  assert.equal(rej.body.reassigned_to, other.user.id);
  const mine = await api().get('/api/v1/delivery/assignments').set(bearer(other));
  assert.ok(mine.body.assignments.some((x) => x.id === rej.body.assignment.id + '' || x.status === 'requested'));
});

test('a transporter cannot move a delivery out of order or touch others', async () => {
  const batch = await listedBatch(farmer, 60);
  const orderId = await paidOrder(buyer, batch.id, 10);
  const d = await api().post(`/api/v1/orders/${orderId}/delivery`).set(bearer(buyer)).send({ transporter_id: transporter.user.id });
  const did = d.body.delivery.id;
  const skip = await api().post(`/api/v1/delivery/assignments/${did}/complete`).set(bearer(transporter)).send({ code: '000000' });
  assert.equal(skip.status, 409);
  assert.equal((await api().post(`/api/v1/delivery/assignments/${did}/start`).set(bearer(transporter))).status, 409);
  const stranger = await makeUser('transporter');
  assert.equal((await api().post(`/api/v1/delivery/assignments/${did}/accept`).set(bearer(stranger))).status, 404);
});

test('feed: recommendation uses supplier stock, ordering decrements stock, cancel restores it', async () => {
  await api().post('/api/v1/farmer/cows').set(bearer(farmer)).send({ tag: 'F-1', breed: 'Holstein cross', daily_yield_litres: 12, lactating: true });
  const p = await api().post('/api/v1/feed/my-products').set(bearer(supplier)).send({ name: 'Dairy 18', category: 'concentrate', price_per_kg: 38, stock_kg: 500, protein_percent: 18 });
  assert.equal(p.status, 201);
  await api().post('/api/v1/feed/my-products').set(bearer(supplier)).send({ name: 'Cheap 12', category: 'concentrate', price_per_kg: 10, stock_kg: 500, protein_percent: 12 });

  const rec = await api().get('/api/v1/farmer/feed-recommendations').set(bearer(farmer));
  const plan = rec.body.plans.find((x) => x.tag === 'F-1');
  assert.equal(plan.protein_target_percent, 18);
  assert.equal(plan.product.name, 'Dairy 18', 'cheap product below the protein target must not be chosen');
  assert.equal(plan.concentrate_kg_per_day, 3.2);
  assert.equal(plan.daily_cost, 121.6);

  const o = await api().post('/api/v1/feed/orders').set(bearer(farmer)).send({ product_id: p.body.product.id, quantity_kg: 100 });
  assert.equal(o.status, 201);
  assert.equal(o.body.order.total_amount, 3800);
  assert.equal((await query('SELECT stock_kg FROM feed_products WHERE id=$1', [p.body.product.id])).rows[0].stock_kg, 400);
  assert.equal((await api().post('/api/v1/feed/orders').set(bearer(farmer)).send({ product_id: p.body.product.id, quantity_kg: 401 })).status, 409);
  assert.equal((await api().post(`/api/v1/feed/orders/${o.body.order.id}/status`).set(bearer(farmer)).send({ status: 'cancelled' })).status, 200);
  assert.equal((await query('SELECT stock_kg FROM feed_products WHERE id=$1', [p.body.product.id])).rows[0].stock_kg, 500);

  const dem = await api().get('/api/v1/feed/demand').set(bearer(supplier));
  assert.equal(dem.status, 200);
  assert.ok(dem.body.estimated_demand_by_region.length > 0);
});

test('USSD returns the farmer latest batch result, and rejects unknown numbers', async () => {
  const ok = await api().post('/api/v1/ussd').type('form').send({ sessionId: 's1', phoneNumber: '+251911555001', text: '1' });
  assert.match(ok.text, /^END Your milk: Grade/);
  const menu = await api().post('/api/v1/ussd').type('form').send({ sessionId: 's2', phoneNumber: '0911555001', text: '' });
  assert.match(menu.text, /^CON Debo Dairy/);
  const unknown = await api().post('/api/v1/ussd').type('form').send({ sessionId: 's3', phoneNumber: '+251900000000', text: '' });
  assert.match(unknown.text, /^END This number is not registered/);
});

test('admin calibration: fit needs 8 samples, then Milk Check switches to the calibrated model', async () => {
  const add = (L, W) => api().post('/api/v1/admin/calibration').set(bearer(admin)).send({ lactometer_reading: L, temperature_c: 20, known_water_percent: W });
  for (let i = 0; i < 7; i++) await add(29 - i * 1.2, i * 4);
  assert.equal((await api().post('/api/v1/admin/calibration/apply').set(bearer(admin))).status, 409);
  await add(29 - 7 * 1.2, 28);
  const applied = await api().post('/api/v1/admin/calibration/apply').set(bearer(admin));
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.ok(applied.body.applied.r2 > 0.99);

  const b = await api().post('/api/v1/farmer/batches').set(bearer(farmer)).send({ volume_litres: 20, produced_at: hoursAgo(1), collection_location: 'Gate' });
  const t = await api().post(`/api/v1/farmer/batches/${b.body.batch.id}/tests`).set(bearer(farmer)).send({ lactometer_reading: 29 - 3 * 1.2, temperature_c: 20 });
  assert.ok(t.body.test.method.startsWith('lactometer_calibrated'));
  assert.ok(Math.abs(t.body.test.estimated_water_percent - 12) < 1.5, `got ${t.body.test.estimated_water_percent}`);
  await api().delete('/api/v1/admin/calibration/active').set(bearer(admin));
});

test('admin stats and settings validation', async () => {
  const s = await api().get('/api/v1/admin/stats').set(bearer(admin));
  assert.equal(s.status, 200);
  assert.ok(s.body.money.gmv_completed > 0);
  const bad = await api().put('/api/v1/admin/settings').set(bearer(admin)).send({ grade_a_max_water: 20, grade_b_max_water: 10 });
  assert.equal(bad.status, 400);
  const ok = await api().put('/api/v1/admin/settings').set(bearer(admin)).send({ base_price_per_litre: 55 });
  assert.equal(ok.body.settings.base_price_per_litre, 55);
  await api().put('/api/v1/admin/settings').set(bearer(admin)).send({ base_price_per_litre: 50 });
});
