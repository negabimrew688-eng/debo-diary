-- Debo Dairy initial schema (PostgreSQL 13+)

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('farmer','buyer','feed_supplier','transporter','admin')),
  region        TEXT,
  woreda        TEXT,
  fayda_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE farmer_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  farm_name        TEXT,
  location_text    TEXT,
  latitude         NUMERIC(9,6),
  longitude        NUMERIC(9,6),
  reputation_score INTEGER NOT NULL DEFAULT 50 CHECK (reputation_score BETWEEN 0 AND 100)
);

CREATE TABLE buyer_profiles (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  buyer_type TEXT NOT NULL DEFAULT 'individual' CHECK (buyer_type IN ('individual','processor','collection_centre')),
  org_name   TEXT,
  address    TEXT
);

CREATE TABLE supplier_profiles (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT,
  address       TEXT
);

CREATE TABLE transporter_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name     TEXT,
  vehicle_type     TEXT,
  plate_number     TEXT,
  capacity_litres  INTEGER CHECK (capacity_litres IS NULL OR capacity_litres > 0),
  has_cold_storage BOOLEAN NOT NULL DEFAULT FALSE,
  service_area     TEXT,
  available        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE cows (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag                 TEXT NOT NULL,
  breed               TEXT,
  age_months          INTEGER CHECK (age_months IS NULL OR age_months >= 0),
  lactating           BOOLEAN NOT NULL DEFAULT TRUE,
  daily_yield_litres  NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (daily_yield_litres >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (farmer_id, tag)
);

CREATE TABLE milk_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  volume_litres       NUMERIC(8,2) NOT NULL CHECK (volume_litres > 0),
  remaining_litres    NUMERIC(8,2) NOT NULL CHECK (remaining_litres >= 0),
  produced_at         TIMESTAMPTZ NOT NULL,
  collection_location TEXT NOT NULL,
  latitude            NUMERIC(9,6),
  longitude           NUMERIC(9,6),
  grade               TEXT CHECK (grade IN ('A','B','FAIL')),
  recommended_price   NUMERIC(10,2),
  asking_price        NUMERIC(10,2),
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','tested','listed','sold_out','rejected','withdrawn')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (remaining_litres <= volume_litres)
);
CREATE INDEX idx_batches_status ON milk_batches(status);
CREATE INDEX idx_batches_farmer ON milk_batches(farmer_id);

CREATE TABLE milk_tests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                UUID REFERENCES milk_batches(id) ON DELETE CASCADE,
  order_id                UUID,
  tested_by               UUID NOT NULL REFERENCES users(id),
  test_type               TEXT NOT NULL DEFAULT 'producer' CHECK (test_type IN ('producer','delivery')),
  lactometer_reading      NUMERIC(5,2) NOT NULL CHECK (lactometer_reading BETWEEN 10 AND 45),
  temperature_c           NUMERIC(4,1) NOT NULL CHECK (temperature_c BETWEEN 0 AND 45),
  fat_percent             NUMERIC(4,2) CHECK (fat_percent IS NULL OR fat_percent BETWEEN 0 AND 12),
  snf_measured            NUMERIC(4,2),
  conductivity_ms         NUMERIC(5,2) CHECK (conductivity_ms IS NULL OR conductivity_ms BETWEEN 0 AND 12),
  image_brightness        NUMERIC(5,2) CHECK (image_brightness IS NULL OR image_brightness BETWEEN 0 AND 255),
  image_url               TEXT,
  corrected_reading       NUMERIC(5,2) NOT NULL,
  estimated_water_percent NUMERIC(5,2) NOT NULL,
  estimate_low            NUMERIC(5,2) NOT NULL,
  estimate_high           NUMERIC(5,2) NOT NULL,
  snf_estimated           NUMERIC(4,2),
  confidence              NUMERIC(3,2) NOT NULL,
  method                  TEXT NOT NULL,
  flags                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  grade                   TEXT NOT NULL CHECK (grade IN ('A','B','FAIL')),
  recommended_price       NUMERIC(10,2),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tests_batch ON milk_tests(batch_id);

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         UUID NOT NULL REFERENCES milk_batches(id),
  buyer_id         UUID NOT NULL REFERENCES users(id),
  farmer_id        UUID NOT NULL REFERENCES users(id),
  volume_litres    NUMERIC(8,2) NOT NULL CHECK (volume_litres > 0),
  unit_price       NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total_amount     NUMERIC(12,2) NOT NULL,
  agreed_grade     TEXT NOT NULL CHECK (agreed_grade IN ('A','B')),
  delivery_address TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending_payment'
                     CHECK (status IN ('pending_payment','paid','in_transit','delivered','completed','disputed','refunded','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_buyer ON orders(buyer_id);
CREATE INDEX idx_orders_farmer ON orders(farmer_id);
ALTER TABLE milk_tests ADD CONSTRAINT fk_tests_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

CREATE TABLE payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id),
  provider    TEXT NOT NULL DEFAULT 'telebirr',
  mode        TEXT NOT NULL DEFAULT 'sandbox',
  reference   TEXT NOT NULL UNIQUE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status      TEXT NOT NULL DEFAULT 'initiated'
                CHECK (status IN ('initiated','held','released','refunded','failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE deliveries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  transporter_id UUID NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','accepted','rejected','collected','in_transit','delivered')),
  pickup_note    TEXT,
  collected_at   TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deliveries_transporter ON deliveries(transporter_id);
CREATE UNIQUE INDEX uq_delivery_active_per_order ON deliveries(order_id) WHERE status <> 'rejected';

CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id),
  raised_by       UUID NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL,
  evidence_url    TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','refund_buyer','release_to_farmer')),
  resolution_note TEXT,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_open_dispute_per_order ON disputes(order_id) WHERE status = 'open';

CREATE TABLE feed_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL DEFAULT 'concentrate' CHECK (category IN ('concentrate','forage','mineral','by_product','other')),
  price_per_kg    NUMERIC(10,2) NOT NULL CHECK (price_per_kg > 0),
  stock_kg        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (stock_kg >= 0),
  protein_percent NUMERIC(4,1) CHECK (protein_percent IS NULL OR protein_percent BETWEEN 0 AND 60),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feed_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES feed_products(id),
  supplier_id  UUID NOT NULL REFERENCES users(id),
  farmer_id    UUID NOT NULL REFERENCES users(id),
  quantity_kg  NUMERIC(10,2) NOT NULL CHECK (quantity_kg > 0),
  total_amount NUMERIC(12,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed','accepted','delivered','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feed_orders_supplier ON feed_orders(supplier_id);
CREATE INDEX idx_feed_orders_farmer ON feed_orders(farmer_id);

CREATE TABLE byproduct_listings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('compost','cow_manure','whey','other')),
  description  TEXT,
  quantity_kg  NUMERIC(10,2) NOT NULL CHECK (quantity_kg > 0),
  price_per_kg NUMERIC(10,2) NOT NULL CHECK (price_per_kg >= 0),
  status       TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','withdrawn')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE calibration_samples (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          UUID NOT NULL REFERENCES users(id),
  lactometer_reading  NUMERIC(5,2) NOT NULL,
  temperature_c       NUMERIC(4,1) NOT NULL,
  corrected_reading   NUMERIC(5,2) NOT NULL,
  known_water_percent NUMERIC(5,2) NOT NULL CHECK (known_water_percent BETWEEN 0 AND 100),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
