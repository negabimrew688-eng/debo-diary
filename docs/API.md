# Debo Dairy API

Base URL: `/api/v1` · Interactive docs (Swagger UI): `/api/docs` · Health check: `GET /health`

## Conventions

- **Auth:** `POST /auth/login` returns `{ token, user }`. Send `Authorization: Bearer <token>` on every other call. Tokens last 8 hours (`JWT_EXPIRES_IN`). A disabled account is rejected immediately.
- **Roles:** `farmer`, `buyer`, `feed_supplier`, `transporter`, `admin`. A route outside your role returns **403**. You only ever see your own records (other people's batches, orders and cows return **404**).
- **Format:** JSON in and out. Money is ETB; volumes are litres; ids are UUIDs; times are ISO 8601.
- **Errors:** `{ "error": "message" }`, plus `"details": [{ "field", "message" }]` for validation errors.

| Status | Meaning |
|---|---|
| 400 | Validation failed or invalid state input |
| 401 | Missing, invalid or expired token; wrong login |
| 403 | Role not allowed |
| 404 | Not found, or not yours |
| 409 | State conflict (already resolved, sold out, wrong order status) |
| 413 / 429 / 501 | File too large / rate limited / feature not enabled (live Telebirr) |

## Walk-through with curl

```bash
API=http://localhost:4000/api/v1

# 1. Register and log in (self-registration cannot create admins)
curl -s /auth/register -H 'content-type: application/json' -d '{
  "email":"farmer@example.com","password":"Strong1pass","full_name":"Almaz Tesfaye",
  "role":"farmer","phone":"+251911000000","region":"Amhara","profile":{"farm_name":"Almaz Farm"}}'
TOKEN=$(curl -s /auth/login -H 'content-type: application/json'   -d '{"email":"farmer@example.com","password":"Strong1pass"}' | jq -r .token)

# 2. Create a milk batch (collected within the last 48 h)
curl -s /farmer/batches -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "volume_litres":120,"produced_at":"2026-11-05T05:30:00Z","collection_location":"Gondar Zuria, Teda road"}'

# 3. Milk Check: submit readings, get the screening result
curl -s /farmer/batches/<batch_id>/tests -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "lactometer_reading":29.5,"temperature_c":20,"fat_percent":3.9}'
```

Milk Check response (abridged):

```json
{ "test": { "estimated_water_percent": 1.8, "estimate_low": 0, "estimate_high": 4.3, "confidence": 0.75,
            "corrected_reading": 29.5, "snf_estimated": 8.3, "method": "lactometer+fat_snf",
            "flags": [], "grade": "A", "recommended_price": 50.6 },
  "batch": { "status": "tested", "grade": "A" },
  "disclaimer": "Screening estimate from field readings, not a laboratory result." }
```

```bash
# 4. List for sale (test must be < 12 h old; asking price <= 115% of recommended)
curl -s -X POST /farmer/batches/<batch_id>/list -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"asking_price":50.6}'

# 5. Buyer browses with filters, then orders
curl -s "/marketplace/batches?grade=A&min_volume=50&max_price=60&location=Gondar&sort=price_asc" -H "authorization: Bearer $BUYER"
curl -s /orders -H "authorization: Bearer $BUYER" -H 'content-type: application/json'   -d '{"batch_id":"<batch_id>","volume_litres":40,"delivery_address":"Gondar city"}'

# 6. Telebirr (sandbox): start payment, then simulate Telebirr's confirmation. Funds are now held in escrow.
curl -s -X POST /orders/<order_id>/pay -H "authorization: Bearer $BUYER"
curl -s /orders/<order_id>/payment/sandbox-confirm -H "authorization: Bearer $BUYER" -H 'content-type: application/json' -d '{"outcome":"success"}'

# 7. Transport: auto-assign (or pass {"transporter_id": "..."}); the transporter then accepts and updates status
curl -s -X POST /orders/<order_id>/delivery -H "authorization: Bearer $BUYER" -H 'content-type: application/json' -d '{}'
curl -s /transport/deliveries/<delivery_id>/respond -H "authorization: Bearer $TRANSPORTER" -H 'content-type: application/json' -d '{"action":"accept"}'
curl -s /transport/deliveries/<delivery_id>/status  -H "authorization: Bearer $TRANSPORTER" -H 'content-type: application/json' -d '{"status":"collected"}'   # then in_transit, delivered

# 8. Buyer quality check on arrival: a matching grade releases the escrow
curl -s /orders/<order_id>/confirm-receipt -H "authorization: Bearer $BUYER" -H 'content-type: application/json'   -d '{"lactometer_reading":29.4,"temperature_c":21,"fat_percent":3.8}'
# mismatch -> { "matches": false, "released": false }, then:
curl -s /orders/<order_id>/dispute -H "authorization: Bearer $BUYER" -H 'content-type: application/json' -d '{"reason":"Milk was clearly diluted on arrival"}'
```

### Order status flow

`pending_payment → paid (escrow held) → in_transit → delivered → completed`, or `delivered → disputed → completed | refunded`. Unpaid orders can be `cancelled`. Payment status: `initiated → held → released | refunded` (or `failed`).

### Quality screening and calibration (admin)

```bash
# Log a sample with a known water amount, then check how well the model reproduces known samples
curl -s /admin/calibration -H "authorization: Bearer $ADMIN" -H 'content-type: application/json'   -d '{"lactometer_reading":26.1,"temperature_c":20,"known_water_percent":10}'
curl -s /admin/calibration -H "authorization: Bearer $ADMIN"          # samples, fit, diagnostics
curl -s -X POST /admin/calibration/apply -H "authorization: Bearer $ADMIN"   # needs >= 8 samples
curl -s /admin/calibration/preview -H "authorization: Bearer $ADMIN" -H 'content-type: application/json'   -d '{"lactometer_reading":26,"temperature_c":20,"fat_percent":3.5}'        # current model vs generic baseline
curl -s -X PUT /admin/settings -H "authorization: Bearer $ADMIN" -H 'content-type: application/json'   -d '{"base_price_per_litre":55,"grade_a_max_water":5,"grade_b_max_water":15}'
```

`GET /admin/calibration` returns `diagnostics`: `calibrated` and `baseline` each with `rmse`, `mae`, `bias`, `max_abs_error` and `grade_agreement_percent`; `per_sample` rows (predicted, residual, outlier, grade_match); and `warnings` such as missing undiluted samples, outliers, or error too large for the grade boundaries.

### USSD (Africa's Talking format)

`POST /ussd` with form fields `sessionId`, `phoneNumber`, `text` returns `text/plain` starting with `CON` (continue) or `END`. Menu: 1 latest milk result, 2 reference price, 3 open orders. The phone must match a registered farmer.

## All endpoints

Generated from the same OpenAPI description that powers `/api/docs`.

### Auth

| Method | Path | What it does | Who |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Register farmer, buyer, feed_supplier or transporter | public |
| POST | `/api/v1/auth/login` | Log in, returns JWT | public |
| GET | `/api/v1/auth/me` | Current user and role profile | any signed-in user |
| PATCH | `/api/v1/auth/me` | Update own profile | any signed-in user |
| POST | `/api/v1/uploads` | Upload a JPEG/PNG/WebP image (max 5 MB), returns its URL | any signed-in user |

### Farmer

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/v1/farmer/dashboard` | Stats, grade mix, escrow, reputation | farmer |
| GET | `/api/v1/farmer/cows` | List cows | farmer |
| POST | `/api/v1/farmer/cows` | Register a cow | farmer |
| PATCH | `/api/v1/farmer/cows/{id}` | Update a cow | farmer |
| DELETE | `/api/v1/farmer/cows/{id}` | Remove a cow | farmer |
| GET | `/api/v1/farmer/batches` | List own milk batches with latest test | farmer |
| POST | `/api/v1/farmer/batches` | Create a milk batch | farmer |
| GET | `/api/v1/farmer/batches/{id}` | Batch with all tests | farmer |
| POST | `/api/v1/farmer/batches/{id}/list` | List a tested A/B batch for sale (test must be < 12 h old) | farmer |
| POST | `/api/v1/farmer/batches/{id}/withdraw` | Withdraw a batch | farmer |
| GET | `/api/v1/farmer/feed-recommendations` | AI-assisted feed plan per cow with cheapest suitable product | farmer |

### Milk Check

| Method | Path | What it does | Who |
|---|---|---|---|
| POST | `/api/v1/farmer/batches/{id}/tests` | Submit readings, get water estimate, grade and recommended price | farmer |

### Marketplace

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/v1/marketplace/batches` | Browse listed milk | buyer |
| GET | `/api/v1/marketplace/batches/{id}` | Batch quality report | buyer |
| GET | `/api/v1/marketplace/compare` | Compare 2-4 batches/suppliers: ?ids=a,b,c | buyer |

### Orders

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/v1/orders` | Orders scoped to the caller role | any signed-in user |
| POST | `/api/v1/orders` | Place a milk order (reserves volume) | buyer |
| GET | `/api/v1/orders/{id}` | Order with tests, payments, deliveries and disputes | any signed-in user |
| POST | `/api/v1/orders/{id}/cancel` | Cancel an unpaid order | buyer |
| POST | `/api/v1/orders/{id}/confirm-receipt` | Record delivery quality check; matching grade releases escrow | buyer |

### Payments

| Method | Path | What it does | Who |
|---|---|---|---|
| POST | `/api/v1/orders/{id}/pay` | Start Telebirr payment (sandbox) | buyer |
| POST | `/api/v1/orders/{id}/payment/sandbox-confirm` | Simulate the Telebirr notification; funds go into escrow | buyer |

### Transport (request a milk delivery)

| Method | Path | What it does | Who |
|---|---|---|---|
| POST | `/api/v1/orders/{id}/delivery` | Request delivery: choose a partner or auto-assign | buyer, admin |
| GET | `/api/v1/transport/available` | Delivery partners currently set to Available | buyer, admin |

The old `/transport/deliveries*` routes were replaced by `/delivery/*` below.

### Dairy products

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/products/categories` · `/products` · `/products/compare` · `/products/{id}` | Categories, browse (`search, category_id, region, min_price, max_price, in_stock, sort, seller_id`), price comparison, detail | buyer, farmer, admin |
| GET/POST | `/farmer/products` | My products / add | farmer |
| PATCH/DELETE | `/farmer/products/{id}` | Update (price, stock, hide) / remove (hidden if it has orders) | farmer |
| GET | `/farmer/product-orders` | Orders for my products | farmer |
| POST | `/farmer/product-orders/{id}/status` | `confirmed` (needs payment) → `processing` → `ready_for_pickup` (auto-assigns a partner for delivery) → `delivered` (self pickup only) | farmer |

### Buyer

| Method | Path | What it does |
|---|---|---|
| GET | `/buyer/dashboard` | Stats, favourite suppliers, recent purchases, 6-month spending |
| GET/POST | `/buyer/cart` · PUT/DELETE `/buyer/cart/{id}` | Cart (dairy products; stock checked) |
| GET/POST | `/buyer/orders` | Unified order list (`?status=`) / checkout (`delivery_option`, `address_id` or `delivery_address`, `delivery_notes`): one order per seller, stock reserved under row locks |
| GET | `/buyer/orders/{id}` | Detail, timeline, delivery partner, 6-digit confirmation code while a delivery is active |
| POST | `/buyer/orders/{id}/pay` · `/payment/sandbox-confirm` | Telebirr (sandbox only) |
| POST | `/buyer/orders/{id}/cancel` | Only while `pending` or `confirmed`; a paid order is marked refunded (sandbox) and stock restored |
| POST | `/buyer/orders/{id}/confirm` | Confirm the delivery was received |
| GET | `/buyer/orders/{id}/receipt` | Receipt data |
| GET/POST/PUT/DELETE | `/buyer/addresses[/{id}]` | Saved addresses, one default |
| POST | `/buyer/reviews` | Rate a delivered order (one per order) |
| GET | `/notifications` · `/notifications/unread-count` · POST `/notifications/read` | In-app notifications (all roles) |
| PATCH/POST | `/auth/me` · `/auth/change-password` | Profile (avatar, business info, notification prefs) and password |

Product order statuses: `pending, confirmed, processing, ready_for_pickup, assigned, in_transit, delivered, cancelled`. Payment status: `unpaid, initiated, paid, failed, refunded`. Product orders are **not escrowed**: payment is recorded as paid and the seller is settled outside the platform. Milk orders keep the escrow flow above.

### Delivery partner (`transporter` role)

| Method | Path | What it does |
|---|---|---|
| GET | `/delivery/dashboard` | Counts, earnings, performance, availability |
| GET | `/delivery/assignments` (`?status=`) · `/delivery/assignments/{id}` | List / detail. Buyer and seller phone numbers appear only after accepting, and only while active |
| POST | `/delivery/assignments/{id}/accept` · `/reject` | Reject offers it to another available partner |
| POST | `/delivery/assignments/{id}/pickup` | `{stage:"start"}` → heading to pickup, `{stage:"confirm"}` → collected |
| POST | `/delivery/assignments/{id}/start` | In transit |
| POST | `/delivery/assignments/{id}/complete` | `{code, notes?, photo_url?}`; the buyer's 6-digit code is required, 5 wrong tries lock the delivery for 15 minutes (429) |
| POST | `/delivery/assignments/{id}/location` | GPS point, accepted only during an active run and only sent when the partner switches sharing on |
| GET | `/delivery/earnings` | Day/week/month totals, 14-day chart, transactions |
| PUT | `/delivery/profile` · `/delivery/availability` | Vehicle details; `available, busy, offline` |

Workflow enforced server-side: `requested → accepted → heading_to_pickup → collected → in_transit → delivered` (`rejected` from `requested`). Fee per delivery is the admin setting `delivery_fee_etb`.

### Assistant

`POST /assistant/chat {message, channel:"text"|"voice"}` returns `{reply, intent, links}`. It is rule-based (keyword intents per role) and every query is scoped to the caller's own records. Only the role, intent and channel are logged for statistics; message text is never stored, and administrators cannot read conversations. Voice is the browser's speech recognition and synthesis; the API only receives text.

### Admin: catalogue, deliveries, reviews

| Method | Path | What it does |
|---|---|---|
| GET/POST/PATCH | `/admin/categories[/{id}]` | Manage categories |
| GET/PATCH | `/admin/products[/{id}]` | All products; hide or restore |
| GET | `/admin/product-orders` | All product orders |
| GET | `/admin/deliveries` | All deliveries plus orders still waiting for a partner |
| POST | `/admin/deliveries/assign` | Manual assignment `{order_kind, order_id, transporter_id}` |
| GET | `/admin/earnings` · POST `/admin/earnings/{id}/pay` | Partner earnings; record that a payout was made |
| GET | `/admin/reviews` · `/admin/ai-usage` | Reviews; assistant usage counts |

### Disputes

| Method | Path | What it does | Who |
|---|---|---|---|
| POST | `/api/v1/orders/{id}/dispute` | Open a dispute on a delivered order | buyer |

### Feed

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/v1/feed/products` | Browse in-stock feed | farmer |
| GET | `/api/v1/feed/my-products` | My products | feed_supplier |
| POST | `/api/v1/feed/my-products` | Add product | feed_supplier |
| PATCH | `/api/v1/feed/my-products/{id}` | Update product / stock | feed_supplier |
| DELETE | `/api/v1/feed/my-products/{id}` | Delete or deactivate | feed_supplier |
| GET | `/api/v1/feed/orders` | Feed orders | farmer, feed_supplier |
| POST | `/api/v1/feed/orders` | Order feed | farmer |
| POST | `/api/v1/feed/orders/{id}/status` | accepted, delivered, cancelled | farmer, feed_supplier |
| GET | `/api/v1/feed/demand` | Estimated farmer demand by region and your top products | feed_supplier |

### Byproducts

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/v1/byproducts` | Browse compost and dairy byproduct listings | any signed-in user |
| POST | `/api/v1/byproducts` | List compost / manure / whey | farmer |
| GET | `/api/v1/byproducts/mine` | My listings | farmer |
| POST | `/api/v1/byproducts/{id}/status` | available, sold, withdrawn | farmer |

### Admin

| Method | Path | What it does | Who |
|---|---|---|---|
| GET | `/api/v1/admin/stats` | Platform KPIs | admin |
| GET | `/api/v1/admin/trends` | Weekly quality trend | admin |
| GET | `/api/v1/admin/users` | List users | admin |
| PATCH | `/api/v1/admin/users/{id}` | Enable/disable, mark Fayda verified | admin |
| GET | `/api/v1/admin/tests` | All milk tests | admin |
| GET | `/api/v1/admin/audit` | Audit log | admin |
| GET | `/api/v1/admin/disputes` | Disputes with both quality checks | admin |
| POST | `/api/v1/admin/disputes/{id}/resolve` | refund_buyer or release_to_farmer | admin |
| GET | `/api/v1/admin/settings` | Pricing, grading thresholds, model baselines | admin |
| PUT | `/api/v1/admin/settings` | Update settings | admin |
| GET | `/api/v1/admin/calibration` | Calibration samples, fitted line and error diagnostics (RMSE, MAE, bias, residuals, outliers, grade agreement, warnings) | admin |
| POST | `/api/v1/admin/calibration` | Add a known-water-percent sample | admin |
| POST | `/api/v1/admin/calibration/preview` | Run readings through the current model and the generic baseline | admin |
| POST | `/api/v1/admin/calibration/apply` | Fit and activate calibration (>= 8 samples) | admin |
| DELETE | `/api/v1/admin/calibration/active` | Revert to default baselines | admin |

### USSD

| Method | Path | What it does | Who |
|---|---|---|---|
| POST | `/api/v1/ussd` | Africa's Talking-style USSD callback | form fields phoneNumber, text |

