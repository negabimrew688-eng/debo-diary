import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, bearer, resetDb, closeDb, makeUser, listedBatch, paidOrder } from './helpers.js';
import { query } from '../src/config/db.js';

const V = '/api/v1';
let farmer, farmer2, buyer, buyer2, partner, admin, category;

before(async () => {
  await resetDb();
  farmer = await makeUser('farmer', { region: 'Amhara' });
  farmer2 = await makeUser('farmer', { region: 'Amhara' });
  buyer = await makeUser('buyer', { profile: { buyer_type: 'processor', org_name: 'Test Dairy' } });
  buyer2 = await makeUser('buyer');
  partner = await makeUser('transporter', { profile: { company_name: 'P1', capacity_litres: 500, service_area: 'Amhara' } });
  admin = await makeUser('admin');
  category = (await api().get(`${V}/products/categories`).set(bearer(buyer))).body.categories.find((c) => c.name === 'Butter');
});
after(closeDb);

const addProduct = async (f, over = {}) => {
  const r = await api().post(`${V}/farmer/products`).set(bearer(f)).send({ name: 'Fresh butter', category_id: category.id, unit: 'kg', price: 600, stock: 20, location_text: 'Azezo', ...over });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.product;
};
const addr = async (b = buyer) => (await api().post(`${V}/buyer/addresses`).set(bearer(b)).send({ address: 'Piazza, Gondar', city: 'Gondar', region: 'Amhara' })).body.address;
const checkout = async (b, extra = {}) => api().post(`${V}/buyer/orders`).set(bearer(b)).send({ delivery_option: 'delivery', delivery_address: 'Piazza, Gondar', ...extra });
const pay = async (b, id) => {
  assert.equal((await api().post(`${V}/buyer/orders/${id}/pay`).set(bearer(b))).status, 200);
  const c = await api().post(`${V}/buyer/orders/${id}/payment/sandbox-confirm`).set(bearer(b)).send({});
  assert.equal(c.body.order.payment_status, 'paid');
};
const seller = (f, id, status) => api().post(`${V}/farmer/product-orders/${id}/status`).set(bearer(f)).send({ status });
const dp = (id, action, body) => api().post(`${V}/delivery/assignments/${id}/${action}`).set(bearer(partner)).send(body || {});

test('catalogue: sellers manage only their products; buyers search and filter; hidden products disappear', async () => {
  const p = await addProduct(farmer);
  await addProduct(farmer2, { name: 'Cottage cheese ayib', price: 150, stock: 0, category_id: undefined });
  assert.equal((await api().post(`${V}/farmer/products`).set(bearer(buyer)).send({ name: 'x', price: 1, stock: 1 })).status, 403);
  assert.equal((await api().post(`${V}/farmer/products`).set(bearer(farmer)).send({ name: 'Bad', price: -5, stock: 1 })).status, 400);
  assert.equal((await api().patch(`${V}/farmer/products/${p.id}`).set(bearer(farmer2)).send({ price: 1 })).status, 404, 'other farmer cannot edit');
  const q = await api().get(`${V}/products?search=butter&max_price=700&in_stock=true&sort=price_asc`).set(bearer(buyer));
  assert.equal(q.status, 200);
  assert.deepEqual(q.body.products.map((x) => x.name), ['Fresh butter']);
  assert.equal(q.body.products[0].seller_phone, undefined, 'seller phone not in listings');
  const cmp = await api().get(`${V}/products/compare?search=butter`).set(bearer(buyer));
  assert.equal(cmp.body.summary.count, 1);
  await api().patch(`${V}/farmer/products/${p.id}`).set(bearer(farmer)).send({ status: 'hidden' });
  assert.equal((await api().get(`${V}/products?search=butter`).set(bearer(buyer))).body.products.length, 0);
  await api().patch(`${V}/farmer/products/${p.id}`).set(bearer(farmer)).send({ status: 'available' });
});

test('cart enforces stock; checkout reserves stock; empty cart is rejected', async () => {
  const p = await addProduct(farmer, { name: 'Yoghurt', stock: 5, price: 80, unit: 'litre' });
  assert.equal((await checkout(buyer)).status, 400, 'empty cart');
  assert.equal((await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 6 })).status, 409);
  const add = await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 2 });
  assert.equal(add.body.total, 160);
  const item = add.body.items[0];
  assert.equal((await api().put(`${V}/buyer/cart/${item.id}`).set(bearer(buyer)).send({ quantity: 3 })).body.total, 240);
  assert.equal((await api().put(`${V}/buyer/cart/${item.id}`).set(bearer(buyer2)).send({ quantity: 1 })).status, 404, 'cart items are private');
  assert.equal((await api().delete(`${V}/buyer/cart/${item.id}`).set(bearer(buyer))).body.items.length, 0);
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 3 });
  const co = await checkout(buyer);
  assert.equal(co.status, 201, JSON.stringify(co.body));
  assert.equal(co.body.orders[0].total_amount, 240);
  assert.match(co.body.orders[0].tracking_number, /^DD-/);
  const stock = (await api().get(`${V}/farmer/products`).set(bearer(farmer))).body.products.find((x) => x.id === p.id).stock;
  assert.equal(Number(stock), 2);
  assert.equal((await api().get(`${V}/buyer/cart`).set(bearer(buyer))).body.items.length, 0, 'cart emptied');
});

test('two buyers racing for the last units cannot oversell', async () => {
  const p = await addProduct(farmer, { name: 'Last cheese', stock: 3, price: 300 });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 2 });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer2)).send({ product_id: p.id, quantity: 2 });
  const [a, b] = await Promise.all([checkout(buyer), checkout(buyer2)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const left = (await query('SELECT stock FROM dairy_products WHERE id=$1', [p.id])).rows[0].stock;
  assert.equal(Number(left), 1);
});

test('product order: pay, seller steps, auto-assign, partner workflow, OTP proof, earnings, receipt, review', async () => {
  await query(`UPDATE system_settings SET value='120' WHERE key='delivery_fee_etb'`);
  await api().put(`${V}/admin/settings`).set(bearer(admin)).send({ delivery_fee_etb: 120 });
  const p = await addProduct(farmer, { name: 'Butter block', stock: 10, price: 500 });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 2 });
  const a = await addr();
  const co = await checkout(buyer, { address_id: a.id, delivery_address: undefined });
  const id = co.body.orders[0].id;
  assert.equal(co.body.orders[0].delivery_address, 'Piazza, Gondar, Gondar, Amhara');

  assert.equal((await seller(farmer, id, 'confirmed')).status, 409, 'cannot confirm before payment');
  await pay(buyer, id);
  assert.equal((await seller(farmer2, id, 'confirmed')).status, 404, 'other seller cannot touch it');
  assert.equal((await seller(farmer, id, 'ready_for_pickup')).status, 409, 'cannot skip steps');
  assert.equal((await seller(farmer, id, 'confirmed')).status, 200);
  assert.equal((await seller(farmer, id, 'processing')).status, 200);
  const ready = await seller(farmer, id, 'ready_for_pickup');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.delivery.transporter_id, partner.user.id, 'auto-assigned to the available partner');
  assert.equal(ready.body.order.status, 'assigned');
  const did = ready.body.delivery.id;
  assert.equal(Number(ready.body.delivery.delivery_fee), 120);

  // Data minimisation: no buyer phone before acceptance
  const before = await api().get(`${V}/delivery/assignments/${did}`).set(bearer(partner));
  assert.equal(before.body.assignment.buyer_phone, null);
  assert.equal((await dp(did, 'pickup')).status, 409, 'cannot pick up before accepting');
  assert.equal((await dp(did, 'accept')).status, 200);
  assert.equal((await dp(did, 'accept')).status, 409, 'cannot accept twice');
  assert.equal((await api().post(`${V}/delivery/assignments/${did}/location`).set(bearer(partner)).send({ latitude: 12.6, longitude: 37.46 })).status, 409, 'no location before the run starts');
  assert.equal((await dp(did, 'pickup', { stage: 'start' })).status, 200);
  assert.equal((await api().post(`${V}/delivery/assignments/${did}/location`).set(bearer(partner)).send({ latitude: 12.6, longitude: 37.46 })).status, 201);
  assert.equal((await api().post(`${V}/delivery/assignments/${did}/location`).set(bearer(partner)).send({ latitude: 999, longitude: 0 })).status, 400);
  assert.equal((await dp(did, 'start')).status, 409, 'must confirm pickup first');
  assert.equal((await dp(did, 'pickup')).status, 200);
  assert.equal((await api().get(`${V}/buyer/orders/${id}`).set(bearer(buyer))).body.order.status, 'in_transit');
  assert.equal((await dp(did, 'complete', { code: '123456' })).status, 409, 'must start delivery first');
  assert.equal((await dp(did, 'start')).status, 200);

  const detail = await api().get(`${V}/buyer/orders/${id}`).set(bearer(buyer));
  const code = detail.body.delivery.confirmation_code;
  assert.match(code, /^\d{6}$/);
  assert.equal(detail.body.delivery.last_location.latitude, 12.6);
  assert.equal(detail.body.delivery.partner_name, partner.user.full_name);
  const wrong = code === '000000' ? '111111' : '000000';
  const bad = await dp(did, 'complete', { code: wrong });
  assert.equal(bad.status, 400);
  assert.equal((await api().get(`${V}/buyer/orders/${id}`).set(bearer(buyer2))).status, 404, 'other buyers cannot see it');
  const ok = await dp(did, 'complete', { code, notes: 'Left with cashier' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const after = await api().get(`${V}/buyer/orders/${id}`).set(bearer(buyer));
  assert.equal(after.body.order.status, 'delivered');
  assert.equal(after.body.timeline.at(-1).done, true);
  const proof = (await query('SELECT * FROM delivery_proofs WHERE delivery_id=$1', [did])).rows[0];
  assert.equal(proof.delivery_notes, 'Left with cashier');
  assert.notEqual(proof.confirmation_code_hash, code, 'only a hash is stored');

  const earn = await api().get(`${V}/delivery/earnings`).set(bearer(partner));
  assert.equal(Number(earn.body.summary.total), 120);
  assert.equal(earn.body.summary.pending, 120);
  const dash = await api().get(`${V}/delivery/dashboard`).set(bearer(partner));
  assert.equal(dash.body.counts.completed, 1);

  assert.equal((await api().post(`${V}/buyer/orders/${id}/confirm`).set(bearer(buyer))).status, 200);
  assert.equal((await api().post(`${V}/buyer/orders/${id}/confirm`).set(bearer(buyer))).status, 409);
  const rcpt = await api().get(`${V}/buyer/orders/${id}/receipt`).set(bearer(buyer));
  assert.equal(rcpt.body.receipt.total, 1000);
  assert.equal((await api().get(`${V}/buyer/orders/${id}/receipt`).set(bearer(buyer2))).status, 404);
  const rv = { order_kind: 'product', order_id: id, product_rating: 5, delivery_rating: 4, review: 'Great' };
  assert.equal((await api().post(`${V}/buyer/reviews`).set(bearer(buyer2)).send(rv)).status, 404);
  assert.equal((await api().post(`${V}/buyer/reviews`).set(bearer(buyer)).send(rv)).status, 201);
  assert.equal((await api().post(`${V}/buyer/reviews`).set(bearer(buyer)).send(rv)).status, 409, 'one review per order');
  assert.equal((await api().post(`${V}/buyer/reviews`).set(bearer(buyer)).send({ ...rv, product_rating: 9 })).status, 400);

  // Notifications reached both sides and can be marked read
  const bn = await api().get(`${V}/buyer/notifications`).set(bearer(buyer));
  const types = bn.body.notifications.map((n) => n.type);
  for (const t of ['payment', 'delivery_assigned', 'in_transit', 'delivered']) assert.ok(types.includes(t), `buyer notified: ${t}`);
  const pn = (await api().get(`${V}/delivery/notifications`).set(bearer(partner))).body.notifications.map((n) => n.type);
  for (const t of ['delivery_assigned', 'earnings', 'buyer_confirmed']) assert.ok(pn.includes(t), `partner notified: ${t}`);
  assert.ok(bn.body.unread > 0);
  await api().post(`${V}/notifications/read`).set(bearer(buyer)).send({});
  assert.equal((await api().get(`${V}/notifications/unread-count`).set(bearer(buyer))).body.unread, 0);
  assert.equal((await api().get(`${V}/notifications`).set(bearer(buyer2))).body.notifications.length, 0, 'notifications are private');

  const ord = await api().get(`${V}/buyer/orders`).set(bearer(buyer));
  assert.ok(ord.body.orders.some((o) => o.id === id && o.display_status === 'delivered'));
  const d = await api().get(`${V}/buyer/dashboard`).set(bearer(buyer));
  assert.ok(d.body.summary.total_purchases >= 1 && Number(d.body.summary.total_spending) >= 1000);
  assert.ok(d.body.favorite_suppliers.length >= 1);
});

test('wrong delivery codes lock the assignment after five tries', async () => {
  const p = await addProduct(farmer, { name: 'Ghee', stock: 4, price: 900 });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 1 });
  const id = (await checkout(buyer)).body.orders[0].id;
  await pay(buyer, id);
  for (const s of ['confirmed', 'processing', 'ready_for_pickup']) await seller(farmer, id, s);
  const did = (await api().get(`${V}/delivery/assignments?status=requested`).set(bearer(partner))).body.assignments[0].id;
  await dp(did, 'accept'); await dp(did, 'pickup'); await dp(did, 'start');
  const real = (await api().get(`${V}/buyer/orders/${id}`).set(bearer(buyer))).body.delivery.confirmation_code;
  const wrong = real === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i += 1) assert.equal((await dp(did, 'complete', { code: wrong })).status, 400);
  assert.equal((await dp(did, 'complete', { code: wrong })).status, 400);
  assert.equal((await dp(did, 'complete', { code: real })).status, 429, 'locked even for the right code');
});

test('cancellation restores stock and refunds; processing orders cannot be cancelled', async () => {
  const p = await addProduct(farmer, { name: 'Milk jug', stock: 10, price: 70, unit: 'litre' });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 4 });
  const id = (await checkout(buyer)).body.orders[0].id;
  await pay(buyer, id);
  const c = await api().post(`${V}/buyer/orders/${id}/cancel`).set(bearer(buyer));
  assert.equal(c.body.order.status, 'cancelled');
  assert.equal(c.body.order.payment_status, 'refunded');
  assert.equal(Number((await query('SELECT stock FROM dairy_products WHERE id=$1', [p.id])).rows[0].stock), 10);
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 1 });
  const id2 = (await checkout(buyer)).body.orders[0].id;
  await pay(buyer, id2); await seller(farmer, id2, 'confirmed'); await seller(farmer, id2, 'processing');
  assert.equal((await api().post(`${V}/buyer/orders/${id2}/cancel`).set(bearer(buyer))).status, 409);
});

test('self pickup skips delivery; the seller hands over', async () => {
  const p = await addProduct(farmer, { name: 'Whey', stock: 5, price: 20, unit: 'litre' });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 1 });
  const id = (await checkout(buyer, { delivery_option: 'self_pickup', delivery_address: undefined })).body.orders[0].id;
  await pay(buyer, id);
  await seller(farmer, id, 'confirmed'); await seller(farmer, id, 'processing');
  const r = await seller(farmer, id, 'ready_for_pickup');
  assert.equal(r.body.delivery, null);
  assert.equal(r.body.awaiting_assignment, false);
  assert.equal((await seller(farmer, id, 'delivered')).status, 200);
  assert.equal((await query('SELECT count(*)::int AS n FROM deliveries WHERE product_order_id=$1', [id])).rows[0].n, 0);
});

test('rejection reassigns; no partner leaves the order awaiting admin assignment, which admin can then do', async () => {
  const p2 = await makeUser('transporter', { profile: { service_area: 'Amhara' } });
  await api().put(`${V}/delivery/availability`).set(bearer(p2)).send({ availability_status: 'offline' });
  const p = await addProduct(farmer, { name: 'Cheese wheel', stock: 5, price: 400 });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer)).send({ product_id: p.id, quantity: 1 });
  const id = (await checkout(buyer)).body.orders[0].id;
  await pay(buyer, id);
  for (const s of ['confirmed', 'processing']) await seller(farmer, id, s);
  await api().put(`${V}/delivery/availability`).set(bearer(partner)).send({ availability_status: 'busy' });
  const none = await seller(farmer, id, 'ready_for_pickup');
  assert.equal(none.body.delivery, null);
  assert.equal(none.body.awaiting_assignment, true);
  const waiting = await api().get(`${V}/admin/deliveries`).set(bearer(admin));
  assert.ok(waiting.body.awaiting_assignment.some((o) => o.id === id));
  assert.equal((await api().post(`${V}/admin/deliveries/assign`).set(bearer(admin)).send({ order_kind: 'product', order_id: id, transporter_id: partner.user.id })).status, 400, 'busy partner rejected');
  await api().put(`${V}/delivery/availability`).set(bearer(partner)).send({ availability_status: 'available' });
  const as = await api().post(`${V}/admin/deliveries/assign`).set(bearer(admin)).send({ order_kind: 'product', order_id: id, transporter_id: partner.user.id, instructions: 'Call on arrival' });
  assert.equal(as.status, 201, JSON.stringify(as.body));
  assert.equal((await api().post(`${V}/admin/deliveries/assign`).set(bearer(admin)).send({ order_kind: 'product', order_id: id, transporter_id: partner.user.id })).status, 409, 'no double assignment');
  await api().put(`${V}/delivery/availability`).set(bearer(p2)).send({ availability_status: 'available' });
  const rej = await dp(as.body.delivery.id, 'reject');
  assert.equal(rej.body.reassigned_to, p2.user.id);
  assert.equal((await api().get(`${V}/buyer/orders/${id}`).set(bearer(buyer))).body.order.status, 'assigned');
});

test('milk orders work with the new delivery workflow and appear in the buyer order list', async () => {
  const batch = await listedBatch(farmer2, 80);
  const oid = await paidOrder(buyer2, batch.id, 20);
  const d = await api().post(`${V}/orders/${oid}/delivery`).set(bearer(buyer2)).send({ transporter_id: partner.user.id });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const did = d.body.delivery.id;
  assert.equal(d.body.delivery.pickup_location, 'Azezo gate');
  await dp(did, 'accept'); await dp(did, 'pickup'); await dp(did, 'start');
  const code = (await api().get(`${V}/orders/${oid}`).set(bearer(buyer2))).body.order.delivery_code;
  assert.equal((await dp(did, 'complete', { code })).status, 200);
  const list = await api().get(`${V}/buyer/orders`).set(bearer(buyer2));
  const row = list.body.orders.find((o) => o.id === oid);
  assert.equal(row.kind, 'milk');
  assert.equal(row.display_status, 'delivered');
  const det = await api().get(`${V}/buyer/orders/${oid}`).set(bearer(buyer2));
  assert.equal(det.body.kind, 'milk');
  assert.equal((await api().get(`${V}/buyer/orders/${oid}`).set(bearer(buyer))).status, 404);
});

test('role boundaries for the new modules', async () => {
  for (const [who, url] of [[buyer, '/delivery/dashboard'], [farmer, '/delivery/assignments'], [partner, '/buyer/dashboard'], [partner, '/buyer/cart'], [farmer, '/buyer/orders'], [buyer, '/farmer/products'], [partner, '/farmer/product-orders'], [buyer, '/admin/deliveries'], [partner, '/admin/ai-usage'], [farmer, '/admin/categories']]) {
    assert.equal((await api().get(`${V}${url}`).set(bearer(who))).status, 403, url);
  }
  assert.equal((await api().get(`${V}/buyer/dashboard`)).status, 401);
  assert.equal((await api().get(`${V}/products/xyz`).set(bearer(buyer))).status, 400);
});

test('admin: categories, moderation, deliveries, payouts, reviews and marketplace stats', async () => {
  const c = await api().post(`${V}/admin/categories`).set(bearer(admin)).send({ name: 'Kefir' });
  assert.equal(c.status, 201);
  assert.equal((await api().post(`${V}/admin/categories`).set(bearer(admin)).send({ name: 'Kefir' })).status, 409);
  assert.equal((await api().patch(`${V}/admin/categories/${c.body.category.id}`).set(bearer(admin)).send({ active: false })).body.category.active, false);
  const cats = (await api().get(`${V}/products/categories`).set(bearer(buyer))).body.categories;
  assert.ok(!cats.some((x) => x.name === 'Kefir'), 'inactive categories are hidden from buyers');
  const prods = await api().get(`${V}/admin/products`).set(bearer(admin));
  assert.ok(prods.body.products.length > 3);
  const hide = await api().patch(`${V}/admin/products/${prods.body.products[0].id}`).set(bearer(admin)).send({ status: 'hidden' });
  assert.equal(hide.body.product.status, 'hidden');
  const dl = await api().get(`${V}/admin/deliveries`).set(bearer(admin));
  assert.ok(dl.body.deliveries.some((x) => x.status === 'delivered'));
  const e = await api().get(`${V}/admin/earnings`).set(bearer(admin));
  const pending = e.body.earnings.find((x) => x.payment_status === 'pending');
  assert.equal((await api().post(`${V}/admin/earnings/${pending.id}/pay`).set(bearer(admin))).status, 200);
  assert.equal((await api().post(`${V}/admin/earnings/${pending.id}/pay`).set(bearer(admin))).status, 409);
  assert.ok((await api().get(`${V}/admin/reviews`).set(bearer(admin))).body.reviews.length >= 1);
  const st = (await api().get(`${V}/admin/stats`).set(bearer(admin))).body.marketplace;
  assert.ok(st.products >= 5 && st.completed_deliveries >= 2 && st.product_orders >= 5);
  assert.ok(st.estimated_platform_revenue > 0);
  assert.equal((await api().put(`${V}/admin/settings`).set(bearer(admin)).send({ delivery_fee_etb: -1 })).status, 400);
});

test('assistant answers only from the signed-in user\'s own records and stores no message text', async () => {
  const ask = (u, message, channel) => api().post(`${V}/assistant/chat`).set(bearer(u)).send({ message, channel });
  await query('DELETE FROM cart_items WHERE buyer_id=$1', [buyer2.user.id]); // leftover from the lost race above
  const secretProduct = await addProduct(farmer2, { name: 'Secret saffron butter', stock: 3, price: 777 });
  await api().post(`${V}/buyer/cart`).set(bearer(buyer2)).send({ product_id: secretProduct.id, quantity: 1 });
  const co2 = await checkout(buyer2);
  assert.equal(co2.status, 201, JSON.stringify(co2.body));
  const b2order = co2.body.orders[0];
  const mine = await ask(buyer, 'What are my active orders?');
  assert.equal(mine.body.intent, 'active_orders');
  assert.ok(!mine.body.reply.includes(b2order.tracking_number), 'does not leak another buyer\'s order');
  const theirs = await ask(buyer2, 'what are my active orders');
  assert.ok(theirs.body.reply.includes(b2order.tracking_number));
  const find = await ask(buyer, 'Show me available butter');
  assert.equal(find.body.intent, 'find_product');
  assert.match(find.body.reply, /butter/i);
  const spend = await ask(buyer, 'How much did I spend this month?');
  assert.equal(spend.body.intent, 'spend_month');
  const eta = await ask(buyer, 'When will my order arrive?');
  assert.equal(eta.body.intent, 'eta');
  assert.ok(!/\b\d+ (minutes|hours)\b/.test(eta.body.reply), 'never invents an ETA');
  assert.equal((await ask(buyer, 'What is the market price of milk?')).body.intent, 'market_price');
  assert.equal((await ask(partner, 'How much have I earned this week?')).body.intent, 'earnings_week');
  assert.equal((await ask(partner, 'How many deliveries are assigned to me?')).body.intent, 'assigned_count');
  const buyerAsksPartner = await ask(buyer, 'How much have I earned this week?');
  assert.notEqual(buyerAsksPartner.body.intent, 'earnings_week', 'buyer cannot reach partner data');
  assert.equal((await ask(partner, 'What are my active orders?')).body.intent, 'unknown', 'partner has no buyer data');
  const unk = await ask(buyer, 'asdf qwer', 'voice');
  assert.equal(unk.body.intent, 'unknown');
  assert.match(unk.body.reply, /active orders/);
  assert.equal((await ask(admin, 'platform summary')).body.intent, 'platform_summary');
  assert.equal((await api().post(`${V}/assistant/chat`).send({ message: 'hi' })).status, 401);
  assert.equal((await api().post(`${V}/assistant/chat`).set(bearer(buyer)).send({ message: '' })).status, 400);
  const cols = (await query(`SELECT column_name FROM information_schema.columns WHERE table_name='ai_usage'`)).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /message|text|content|reply/.test(c)), 'no conversation text column');
  const usage = await api().get(`${V}/admin/ai-usage`).set(bearer(admin));
  assert.ok(usage.body.totals.total >= 10 && usage.body.totals.voice >= 1);
  assert.equal((await api().get(`${V}/admin/ai-usage`).set(bearer(buyer))).status, 403);
});

test('profile: password change, avatar and notification preference', async () => {
  const u = await makeUser('buyer');
  assert.equal((await api().post(`${V}/auth/change-password`).set(bearer(u)).send({ current_password: 'wrong', new_password: 'Newpass123' })).status, 401);
  assert.equal((await api().post(`${V}/auth/change-password`).set(bearer(u)).send({ current_password: 'Testpass123', new_password: 'short' })).status, 400);
  assert.equal((await api().post(`${V}/auth/change-password`).set(bearer(u)).send({ current_password: 'Testpass123', new_password: 'Newpass123' })).status, 200);
  assert.equal((await api().post(`${V}/auth/login`).send({ email: u.email, password: 'Newpass123' })).status, 200);
  const m = await api().patch(`${V}/auth/me`).set(bearer(u)).send({ notification_prefs: { in_app: false }, profile: { business_type: 'Cafe' } });
  assert.equal(m.body.user.notification_prefs.in_app, false);
  assert.equal(m.body.user.profile.business_type, 'Cafe');
  assert.equal((await api().patch(`${V}/auth/me`).set(bearer(u)).send({ avatar_url: 'http://evil.example/x.png' })).status, 400);
  const before = (await api().get(`${V}/notifications`).set(bearer(u))).body.notifications.length;
  await query(`SELECT 1`);
  const { notify } = await import('../src/services/notify.service.js');
  await notify(null, u.user.id, 'test', 'Hello');
  assert.equal((await api().get(`${V}/notifications`).set(bearer(u))).body.notifications.length, before, 'in-app notifications can be switched off');
});
