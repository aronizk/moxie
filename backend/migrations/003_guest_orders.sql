-- Allows orders to be placed without an account. A guest order has buyer_id = NULL and a
-- private guest_token instead, which the browser holds onto to prove ownership of that
-- specific order (sent as the X-Guest-Token header). The guest can later "claim" the order
-- by logging in, which permanently attaches it to their account.
ALTER TABLE orders ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_token UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_contact TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_guest_token ON orders(guest_token) WHERE guest_token IS NOT NULL;
