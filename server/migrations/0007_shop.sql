-- Shop/warehouse: inventory cards (one row per acquired item) and the
-- repurchase history keyed by the client-computed productKey.

CREATE TABLE inventory (
    id TEXT PRIMARY KEY,
    product_key TEXT,              -- stable identity of the generated product
    name TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_inventory_acquired ON inventory(acquired_at);

CREATE TABLE shop_purchase_history (
    product_key TEXT PRIMARY KEY,
    last_purchased_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
