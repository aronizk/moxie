-- ticketin initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  artist           TEXT,
  status           TEXT NOT NULL DEFAULT '販売中' CHECK (status IN ('販売中','売却済','取消')),
  schedule         TEXT,
  place            TEXT,
  seat_position    TEXT,
  ticket_type      TEXT,
  price_per_sheet  NUMERIC(12,2) NOT NULL CHECK (price_per_sheet >= 0),
  quantity         INTEGER NOT NULL CHECK (quantity >= 1),
  payment_method   TEXT,
  transfer_target  TEXT,
  bank_name        TEXT,
  bank_branch      TEXT,
  bank_type        TEXT,
  bank_number      TEXT,
  bank_holder      TEXT,
  instructions     TEXT,
  notes            TEXT,
  seller_note      TEXT,
  review_count     INTEGER NOT NULL DEFAULT 0,
  name_type        TEXT,
  issue_status     TEXT,
  delivery_method  TEXT,
  delivery_period  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_seller ON tickets(seller_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  buyer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity           INTEGER NOT NULL CHECK (quantity >= 1),
  subtotal           NUMERIC(12,2) NOT NULL,
  platform_fee       NUMERIC(12,2) NOT NULL,
  total              NUMERIC(12,2) NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','awaiting_confirmation','completed','disputed')),
  payment_proof_key  TEXT,
  payment_proof_url  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_ticket ON orders(ticket_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);

CREATE TABLE IF NOT EXISTS complaints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  submitted_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaints_order ON complaints(order_id);

CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages(ticket_id);
