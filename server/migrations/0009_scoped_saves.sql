-- Scoped saves: per-contact storyline branches and snapshot rows
-- (saveSlots has no consumer anywhere and stays skipped).

CREATE TABLE contact_storylines (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_contact_storylines_contact ON contact_storylines(contact_id, active);

CREATE TABLE contact_save_snapshots (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    storyline_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_contact_save_snapshots_contact ON contact_save_snapshots(contact_id, created_at);

CREATE TABLE global_save_snapshots (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,   -- worldbook | map
    resource_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_global_save_snapshots_resource ON global_save_snapshots(resource_type, resource_id, created_at);
