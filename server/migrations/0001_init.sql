-- Key-value store for singleton user data that used to live in
-- localStorage-backed AppSettings (profile, worldview, prompt caps logs...).
-- Secrets and per-device preferences stay client-side and never land here.
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Named prompt presets. Factory presets are seeded read-only (is_factory = 1);
-- user presets are created via "save as new" with a unique name. Contacts
-- reference a preset by name (contacts.preset_name) and always resolve the
-- current content at prompt-build time.
CREATE TABLE IF NOT EXISTS prompt_presets (
    name TEXT PRIMARY KEY,
    is_factory INTEGER NOT NULL DEFAULT 0,
    modules TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
