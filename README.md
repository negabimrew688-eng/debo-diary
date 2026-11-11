# Debo Dairy

**Every batch checked, fairly priced.** An AI-assisted dairy marketplace for Ethiopia connecting milk producers, milk buyers, cow-feed suppliers and milk transporters, with quality-based pricing and Telebirr escrow.

Stack: **React (Vite, Tailwind, Router, Axios, Recharts)** · **Node.js + Express** (JWT, bcrypt, Zod validation) · **PostgreSQL** (`pg`, plain SQL migrations).

## Quick start

Prerequisites: Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Database (psql as a superuser)
CREATE USER debo WITH PASSWORD 'debo_dev_pw' CREATEDB;
CREATE DATABASE debo_dairy OWNER debo;
CREATE DATABASE debo_dairy_test OWNER debo;   # only needed for tests

# 2. Install and configure
npm run install:all
cp server/.env.example server/.env            # then set JWT_SECRET (32+ random characters)

# 3. Create tables and demo data
npm run migrate
npm run seed                                   # demo accounts below (development only)

# 4. Run (two terminals)
npm run dev:server                             # API on http://localhost:4000, docs at /api/docs
npm run dev:client                             # app on http://localhost:5173
```

Single-server mode: `npm run build` then `npm start` serves the React app and the API together on port 4000.

On Windows PowerShell use `Copy-Item server/.env.example server/.env`. Docker is optional (see Deployment).

### Upgrading an existing local copy

```bash
cd server && npm install && npm run migrate     # applies 002_buyer_delivery.sql
npm run seed                                    # optional: adds demo products and orders (development only)
cd ../client && npm install && npm run build    # or `npm run dev`
```

### Demo accounts (password `Debo2026pass`)

| Role | Login |
|---|---|
| Administrator | admin@debodairy.test |
| Farmers | almaz@ · bekele@ · tigist@ debodairy.test |
| Buyers | processor@ · cafe@ debodairy.test |
| Feed supplier | feed@debodairy.test |
| Delivery partners (role `transporter`) | transport1@ · transport2@ debodairy.test |

## The investor demo in 6 minutes

1. **Farmer (almaz):** Milk batches → New batch → run **Milk Check** (try lactometer 29.5, temp 20, fat 3.9 for Grade A; then 24 for a failed batch) → list for buyers.
2. **Buyer (processor):** Find milk → compare suppliers → order → **Pay with Telebirr** (sandbox) → money is held in **escrow** → request transport.
3. **Delivery partner:** accept → collected → delivered.
4. **Buyer:** run the delivery quality check. A matching grade releases payment. A diluted reading holds the money and lets the buyer open a **dispute**.
5. **Admin:** resolve the dispute (refund or release), review KPIs, quality trend, pricing, and **calibrate Milk Check** with known-water samples, read the error diagnostics and try the model on a test reading before applying it.
6. **Feed supplier / Farmer:** AI feed plan per cow, feed orders, supplier demand by region. Compost and byproducts loop.
7. **Dairy products (cafe buyer):** Marketplace → *Dairy products* → search "butter", compare prices, add to cart → checkout with an address → pay with Telebirr (sandbox).
8. **Farmer (almaz):** *Product orders* → Confirm → Start processing → Mark ready. A delivery partner is assigned automatically.
9. **Delivery partner:** Assignments → accept → start pickup → confirm pickup → start delivery. The buyer's order page shows a 6-digit code; the partner enters it to complete. Earnings appear on the partner's *Earnings* page and on the admin *Deliveries* page.
10. **Debo assistant:** the "Ask Debo" button (text, or the microphone in browsers that support speech recognition).

## What each role can do

| Role | Features |
|---|---|
| Farmer | My dairy products and product orders (confirm, process, mark ready), profile, cows, milk batches (litres, time, location), Milk Check with photo, grade and recommended price, list/withdraw, AI feed plan, buy feed, compost and byproduct listings, orders and payments, reputation score, dashboard |
| Buyer (individual, processor, collection centre, cafe) | Dashboard (stats, favourite suppliers, spending chart), dairy product marketplace with search, filters and price comparison, cart, checkout with saved addresses and delivery or self pickup, Telebirr sandbox payment, unified order list, tracking timeline, 6-digit delivery code, cancel, receipt, reviews, notifications, profile and password. Also: browse and filter milk (location, volume, grade, price), quality reports (water %, range, confidence, fat, SNF), compare suppliers, order, Telebirr escrow, choose or auto-assign transporter, delivery quality check, dispute |
| Feed supplier | Product and stock management, feed orders (accept, deliver, cancel), farmer demand by region, sales |
| Delivery partner | Dashboard, assignments with a validated workflow (accept, start pickup, confirm pickup, start delivery, complete with the buyer's code, notes and photo), optional GPS sharing, route links, earnings (day/week/month), availability, profile, notifications |
| Administrator | Independent admin console with its own top navigation bar (separate from the farmer, buyer, supplier and transporter app). KPIs and charts, users (enable/disable, Fayda flag), dairy products and categories, product orders, deliveries with manual assignment and partner payouts, reviews, assistant usage counts (no conversation content), dispute resolution, pricing and grading rules, Milk Check calibration, audit log |
| Basic phone | USSD menu (`POST /api/v1/ussd`, Africa's Talking format): latest milk result, reference price, open orders |

## How Milk Check works

Milk Check estimates **added-water %** from readings a farmer can take in the field. It is a transparent model, not a black box:

1. **Temperature-correct** the lactometer reading: `corrected = reading + 0.2 × (temp − 20)`.
2. **Lactometer method:** `water% = (normal_clr − corrected) / normal_clr × 100` (normal ≈ 29 for cow milk).
3. If **fat %** is entered, use the Richmond formula `SNF = CLR/4 + 0.2·fat + 0.14` and compare to normal SNF (8.5%). This removes the fat confounder and is weighted 75% when available.
4. **Conductivity** (optional) corroborates; disagreement lowers confidence and raises a flag.
5. A **photo** is stored as evidence and its brightness can raise a flag, but it never changes the percentage.

Every result carries an **error range and confidence** (0.2–0.95) and flags such as "no fat reading", "reading above normal (possible skimming or added solids)". Grades: **A ≤ 5%**, **B ≤ 15%**, otherwise **FAIL** (cannot be sold). Thresholds, price multipliers and baselines are admin settings.

**Calibration:** an administrator adds samples of local milk mixed with *known* water percentages. With 8+ samples the system fits a regression line, shows R² and RMSE, and Milk Check switches to the calibrated model. Do this before any pilot claims.

**Diagnostics (Admin → Settings):** for the labelled samples the page shows RMSE, MAE, bias, worst error and grade agreement for the calibrated model next to the generic textbook baseline, a per-sample residual table with outliers, and warnings (no undiluted samples, narrow water range, error too large for the grade boundaries). "Try the model" previews a reading under the current model, the baseline and the calibrated fit before you apply it.

**Important limits:** this is a screening estimate, not a laboratory result. Adding skim milk or powder with the water can mask dilution in density-based tests. The default baselines are textbook values for cow milk and must be calibrated on real local samples. The default reference price (ETB 50/L) is a placeholder: set the real local price in Admin → Pricing.

## Order, escrow and dispute flow

`pending_payment → paid (funds held) → in_transit → delivered → completed (funds released)`

- Delivered milk is tested by the buyer. Same or better grade, or within the tolerance (default 3 water points), releases the escrow.
- Otherwise the order stays `delivered` with the money held; the buyer can **dispute** → `disputed` → admin chooses `refund_buyer` (→ `refunded`) or `release_to_farmer` (→ `completed`). Resolutions are final and audited.
- Stock is reserved under row locks when ordering, so concurrent buyers cannot oversell a batch (covered by a test).
- Farmer reputation (0–100) is computed from share of Grade A batches, dispute-free completed orders, and volume of completed orders.

## Interface

The cow illustration (`client/public/cow.png`) is the brand mark: login page, round logo badge, and welcome banners on each home page. Administrators get a separate console (`AdminLayout`, top navbar, `/admin/*` routes); other roles use the sidebar layout. Everything is in this one folder: `client/` (React), `server/` (API, SQL migrations, Milk Check AI model), `docs/`, plus Docker files.

## Project layout

```
server/src
  config/        env + PostgreSQL pool
  db/            migrations (SQL), migrate.js, seed.js
  middleware/    auth (JWT), roles, validation (Zod), uploads, error handler
  services/      milkQuality, pricing/settings, feedAdvisor, reputation, order (escrow), telebirr
  controllers/   auth, farmer, marketplace, order, transport, feed, byproduct, admin, ussd
  routes/        all REST routes under /api/v1
  docs/          OpenAPI spec served at /api/docs
server/tests     55 automated tests (unit, end-to-end flow, security)
client/src       React app: pages per role, shared UI kit, API layer
```

## Security measures

bcrypt password hashing · JWT with server-side user lookup (disabled accounts lose access immediately) · role-based authorization on every route · object-level checks (users only see their own batches, orders, cows) · Zod validation on all input with unknown fields rejected · parameterised SQL only · Helmet headers, CORS allow-list, rate limiting on auth and API · upload limited to 5 MB JPEG/PNG/WebP with server-generated filenames · self-registration cannot create admins · audit log of sensitive actions · login timing does not reveal whether an email exists.

## Tests

```bash
npm test      # needs the debo_dairy_test database; 55 tests, ~20 s
```

Covers the buyer and delivery modules (stock races, status rules, OTP lockout, data minimisation, assistant data isolation), Milk Check maths and calibration, the full order/escrow/transport/dispute lifecycle, concurrent over-ordering, feed ordering and stock, USSD, role boundaries, ownership isolation, validation, SQL-injection attempts, uploads and disabled accounts. The UI was also exercised end-to-end in a real browser across the buyer, farmer, delivery partner and admin flows (cart to delivered, review, receipt, assistant).

## What is simulated or not built (be upfront with reviewers)

| Item | Status |
|---|---|
| **Telebirr** | **Sandbox adapter only.** Full escrow lifecycle works, but no real money moves. Live mode needs Ethio telecom merchant credentials and the signed payment and callback API; it is deliberately not faked (`TELEBIRR_MODE=live` returns 501). |
| **Fayda ID** | Manual "verified" flag set by an admin. No Fayda eKYC integration. |
| **Debo assistant** | **Rule-based, not a language model.** Keyword intents answer from the signed-in user's own records (orders, delivery status, spending, earnings, prices). Anything else gets a polite "I can help with…" reply. Voice uses the browser's Web Speech API (Chrome/Edge); there is no server-side speech. It never invents ETAs. |
| **Maps / GPS** | Route links (Google Maps) and an OpenStreetMap view of the last location the partner chose to share. No live tracking, no ETAs and no routing engine. |
| **Product order payments** | Telebirr sandbox only, and **no escrow** for dairy products: the seller is settled outside the platform. Cancelling a paid order marks it refunded in the database; no real refund is made. |
| **Delivery partner payouts** | Earnings are computed from the admin delivery fee (default ETB 80, a placeholder). The admin marks payouts as paid manually. |
| **Platform revenue** | Estimated from a placeholder commission (default 3%). No billing. |
| **Audio / voice (other)** | USSD is built (read-only). No SMS sending. |
| Quality "verification" | Fat and SNF are producer-reported field readings or estimates, not lab-verified. The UI says so. |
| Push, SMS and email notifications, Amharic UI | Not built. Notifications are in-app only. |
| Feed purchase payment | Feed orders have status tracking only; payment is settled outside the platform. |
| Auto-release timer, refresh tokens, email verification, password reset | Not built. |
| Photo-based water percentage | Deliberately not offered: a phone photo cannot measure dilution reliably. |

## Assumptions

The brief you pasted was cut off (after the admin role and again after "Foreign keys"). I built to the roles, features and stack you gave and assumed: admin = users, tests, disputes, pricing, calibration, audit; API docs via OpenAPI/Swagger; PostgreSQL migrations as plain SQL files; English UI; ETB currency.

## Deployment

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_SECRET` | yes | 32+ random characters (`openssl rand -base64 48`). Example values are rejected in production |
| `NODE_ENV` | | `production` enables the strict checks |
| `PORT` | | default 4000 |
| `CORS_ORIGIN` | | comma-separated allowed origins (your public site URL) |
| `JWT_EXPIRES_IN` | | default `8h` |
| `DATABASE_SSL` / `DATABASE_SSL_CA` | | `true` for managed Postgres that needs TLS; optional CA certificate text |
| `DATABASE_POOL_MAX` | | default 10 |
| `FORCE_HTTPS` | | `true` only when served over HTTPS (adds HSTS and upgrade-insecure-requests) |
| `UPLOAD_DIR` | | milk photo folder; mount a persistent disk (`/data/uploads` in Docker) |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` / `_NAME` | | creates the first admin on start-up only if no admin exists (password 10+ chars, letter and digit) |
| `TELEBIRR_MODE` | | `sandbox` (default). `live` is not implemented and returns 501 |
| `TELEBIRR_APP_ID` / `TELEBIRR_APP_KEY` | | future live credentials |

Templates: `server/.env.example` (local) and `.env.docker.example` (compose). Never commit real `.env` files. Migrations run automatically on start-up.

### Docker (local or any VM)

```bash
cp .env.docker.example .env      # set POSTGRES_PASSWORD, JWT_SECRET, BOOTSTRAP_ADMIN_*
docker compose up --build        # app + PostgreSQL 16 on http://localhost:4000
```

One image serves the API and the built React app. Data lives in the `dbdata` and `uploads` volumes. Sign in with the bootstrap admin; demo seeding is for development only and refuses to run in production.

### Render (blueprint)

Push the repo, then in Render choose New, Blueprint, and select `render.yaml`. It creates a Docker web service, a PostgreSQL database and a 1 GB disk for uploads. Fill in `CORS_ORIGIN` (your onrender.com URL) and `BOOTSTRAP_ADMIN_*` when prompted; `JWT_SECRET` is generated for you. Plan sizes in the file are starting points.

### AWS, GCP and others

The same Docker image runs on AWS (App Runner, ECS Fargate, Lightsail) and GCP (Cloud Run) with a managed PostgreSQL (RDS, Cloud SQL): set the variables above, `DATABASE_SSL=true`, and `FORCE_HTTPS=true`. Cloud Run and Fargate have no persistent local disk, so milk photos need object storage (not built yet) or a mounted volume.

**Vercel** suits only the static React build; the Express API and uploads need a container or server host, so host the API elsewhere and set `VITE_API_URL` (see `client/.env.example`) at build time.

### Production checklist

Strong `JWT_SECRET`, HTTPS, backups for PostgreSQL, persistent uploads, change the bootstrap password after first login, set a real local reference price in Admin, and calibrate Milk Check before making quality claims.

**Not verified here:** the Docker image build was not run in the environment where this was written (no Docker daemon). `docker compose config` validates, and the production start-up path was exercised outside Docker. Run `docker compose up --build` once and report any error.

## API documentation

`/api/docs` (Swagger UI) when the server runs, and `docs/API.md` for the walk-through with curl examples and the full endpoint table.
