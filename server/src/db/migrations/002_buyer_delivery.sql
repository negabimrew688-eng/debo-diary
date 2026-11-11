-- Debo Dairy: buyer marketplace for dairy products, delivery-partner workflow, proof of delivery,
-- earnings, notifications, reviews and assistant usage. Reuses users, buyer_profiles, transporter_profiles,
-- orders, payments and deliveries from 001; nothing is duplicated.

ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN notification_prefs JSONB NOT NULL DEFAULT '{"in_app":true}';

ALTER TABLE buyer_profiles ADD COLUMN business_type TEXT;
ALTER TABLE buyer_profiles ADD COLUMN payment_preference TEXT NOT NULL DEFAULT 'telebirr' CHECK (payment_preference IN ('telebirr'));

ALTER TABLE transporter_profiles ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN ('available','busy','offline'));
UPDATE transporter_profiles SET availability_status = CASE WHEN available THEN 'available' ELSE 'offline' END;

CREATE TABLE product_categories (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name   TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE dairy_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID NOT NULL REFERENCES users(id),
  category_id   UUID REFERENCES product_categories(id),
  name          TEXT NOT NULL,
  description   TEXT,
  unit          TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg','litre','piece')),
  price         NUMERIC(10,2) NOT NULL CHECK (price > 0),
  stock         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  location_text TEXT,
  image_url     TEXT,
  quality_note  TEXT,
  status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','hidden')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_seller ON dairy_products(seller_id);
CREATE INDEX idx_products_category ON dairy_products(category_id);

CREATE TABLE cart_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES dairy_products(id) ON DELETE CASCADE,
  quantity   NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  UNIQUE (buyer_id, product_id)
);

CREATE TABLE buyer_addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT,
  address    TEXT NOT NULL,
  city       TEXT,
  region     TEXT,
  latitude   NUMERIC(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude  NUMERIC(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_addresses_buyer ON buyer_addresses(buyer_id);
CREATE UNIQUE INDEX uq_default_address ON buyer_addresses(buyer_id) WHERE is_default;

CREATE TABLE product_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number    TEXT NOT NULL UNIQUE,
  buyer_id           UUID NOT NULL REFERENCES users(id),
  seller_id          UUID NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','processing','ready_for_pickup','assigned','in_transit','delivered','cancelled')),
  payment_status     TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','initiated','paid','failed','refunded')),
  payment_reference  TEXT,
  total_amount       NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  delivery_option    TEXT NOT NULL DEFAULT 'delivery' CHECK (delivery_option IN ('delivery','self_pickup')),
  delivery_address   TEXT,
  delivery_notes     TEXT,
  pickup_location    TEXT,
  buyer_confirmed_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (delivery_option = 'self_pickup' OR delivery_address IS NOT NULL)
);
CREATE INDEX idx_porders_buyer ON product_orders(buyer_id);
CREATE INDEX idx_porders_seller ON product_orders(seller_id);

CREATE TABLE product_order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_order_id UUID NOT NULL REFERENCES product_orders(id) ON DELETE CASCADE,
  product_id       UUID NOT NULL REFERENCES dairy_products(id),
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL,
  unit_price       NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity         NUMERIC(10,2) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX idx_poi_order ON product_order_items(product_order_id);

-- A delivery now belongs to either a milk order or a product order.
ALTER TABLE deliveries ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE deliveries ADD COLUMN product_order_id UUID REFERENCES product_orders(id) ON DELETE CASCADE;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_one_order CHECK ((order_id IS NULL) <> (product_order_id IS NULL));
ALTER TABLE deliveries ADD COLUMN pickup_location TEXT;
ALTER TABLE deliveries ADD COLUMN destination_address TEXT;
ALTER TABLE deliveries ADD COLUMN delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
ALTER TABLE deliveries ADD COLUMN instructions TEXT;
ALTER TABLE deliveries ADD COLUMN deadline TIMESTAMPTZ;
ALTER TABLE deliveries ADD COLUMN accepted_at TIMESTAMPTZ;
ALTER TABLE deliveries ADD COLUMN pickup_started_at TIMESTAMPTZ;
ALTER TABLE deliveries ADD COLUMN in_transit_at TIMESTAMPTZ;
ALTER TABLE deliveries DROP CONSTRAINT deliveries_status_check;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('requested','accepted','rejected','heading_to_pickup','collected','in_transit','delivered'));
CREATE UNIQUE INDEX uq_delivery_active_per_product_order ON deliveries(product_order_id) WHERE status <> 'rejected';

CREATE TABLE delivery_proofs (
  delivery_id            UUID PRIMARY KEY REFERENCES deliveries(id) ON DELETE CASCADE,
  confirmation_code_hash TEXT NOT NULL,
  failed_attempts        INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  delivery_photo         TEXT,
  delivery_notes         TEXT,
  delivered_at           TIMESTAMPTZ,
  buyer_confirmed_at     TIMESTAMPTZ
);

CREATE TABLE delivery_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  latitude    NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dloc_delivery ON delivery_locations(delivery_id, recorded_at DESC);

CREATE TABLE delivery_earnings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id    UUID NOT NULL UNIQUE REFERENCES deliveries(id) ON DELETE CASCADE,
  partner_id     UUID NOT NULL REFERENCES users(id),
  amount         NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  currency       TEXT NOT NULL DEFAULT 'ETB',
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ
);
CREATE INDEX idx_earnings_partner ON delivery_earnings(partner_id, created_at DESC);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE buyer_reviews (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id         UUID NOT NULL REFERENCES users(id),
  seller_id        UUID NOT NULL REFERENCES users(id),
  order_id         UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_order_id UUID REFERENCES product_orders(id) ON DELETE CASCADE,
  product_rating   INTEGER NOT NULL CHECK (product_rating BETWEEN 1 AND 5),
  delivery_rating  INTEGER CHECK (delivery_rating IS NULL OR delivery_rating BETWEEN 1 AND 5),
  review           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((order_id IS NULL) <> (product_order_id IS NULL))
);
CREATE UNIQUE INDEX uq_review_milk_order ON buyer_reviews(order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_review_product_order ON buyer_reviews(product_order_id) WHERE product_order_id IS NOT NULL;

-- Assistant usage statistics only. Message content is deliberately NOT stored server-side.
CREATE TABLE ai_usage (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  role       TEXT NOT NULL,
  intent     TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'text' CHECK (channel IN ('text','voice')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO product_categories(name) VALUES ('Milk'),('Butter'),('Cheese'),('Yoghurt'),('Ayib (cottage cheese)'),('Ghee (niter kibbeh)'),('Other dairy');

-- Status history used for the buyer's order timeline (product orders; milk orders derive theirs from existing timestamps).
CREATE TABLE order_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_kind TEXT NOT NULL CHECK (order_kind IN ('milk','product')),
  order_id   UUID NOT NULL,
  status     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_events ON order_events(order_kind, order_id, created_at);
