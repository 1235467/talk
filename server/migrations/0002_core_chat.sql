-- Core chat schema. Conventions for every domain table:
--   * real columns only for fields the frontend actually filters/orders on
--   * `data` holds the COMPLETE object as JSON, verbatim from the web app's
--     backup export — API responses are just `data` re-serialized, so the
--     frontend TypeScript types pass through untouched.
-- Polymorphic actor ids (a contactId or the literal 'user') stay plain TEXT
-- with no foreign key.

CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    worldview_id TEXT,
    name TEXT NOT NULL,
    preset_name TEXT,              -- named prompt preset, resolved at prompt-build time
    warmth INTEGER,
    last_moment_at INTEGER,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- full Contact JSON
);

CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    contact_id TEXT,               -- 1:1 conversations
    group_id TEXT,                 -- group conversations (exactly one of the two is set)
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_group ON conversations(group_id);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,            -- user | assistant | system
    type TEXT NOT NULL,            -- text | sticker | image | gift | scheduleChange | ...
    speaker_contact_id TEXT,       -- group bubbles: which member spoke
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- full Message JSON incl. type-specific payload
);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);

CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (group_id, contact_id)
);
CREATE INDEX idx_group_members_contact ON group_members(contact_id);

CREATE TABLE stickers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- incl. dataUrl until media files land
);

CREATE TABLE contact_relations (
    id TEXT PRIMARY KEY,
    from_contact_id TEXT NOT NULL,
    to_contact_id TEXT NOT NULL,
    pair_id TEXT,                  -- both directions of one link share this
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_contact_relations_from ON contact_relations(from_contact_id);
CREATE INDEX idx_contact_relations_to ON contact_relations(to_contact_id);
