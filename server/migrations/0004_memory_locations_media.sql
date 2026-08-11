-- Memory/life-simulation, schedule tasks, map/locations, media, AI turn logs.

CREATE TABLE simulation_state (
    id TEXT PRIMARY KEY,           -- singleton 'global'
    data TEXT NOT NULL
);

CREATE TABLE contact_life_states (
    contact_id TEXT PRIMARY KEY,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE life_events (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_life_events_contact ON life_events(contact_id, occurred_at);

CREATE TABLE life_event_participants (
    event_id TEXT NOT NULL REFERENCES life_events(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (event_id, contact_id)
);

CREATE TABLE contact_experiences (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,            -- past | offline
    memory_tier TEXT NOT NULL,     -- short | long
    start_at INTEGER,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_contact_experiences_created ON contact_experiences(created_at);

CREATE TABLE contact_experience_contacts (
    experience_id TEXT NOT NULL REFERENCES contact_experiences(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (experience_id, contact_id)
);
CREATE INDEX idx_experience_contacts_contact ON contact_experience_contacts(contact_id);

CREATE TABLE social_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,        -- contactId or literal 'user'
    target_id TEXT,                -- contactId or literal 'user'
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_social_events_created ON social_events(created_at);

CREATE TABLE social_event_contacts (
    event_id TEXT NOT NULL REFERENCES social_events(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (event_id, contact_id)
);

CREATE TABLE contact_memories (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    scope TEXT,                    -- private | group | interpersonal
    category TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_contact_memories_contact ON contact_memories(contact_id, created_at);

CREATE TABLE contact_memory_contacts (
    memory_id TEXT NOT NULL REFERENCES contact_memories(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (memory_id, contact_id)
);

CREATE TABLE group_plans (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_group_plans_group ON group_plans(group_id);

CREATE TABLE internal_tasks (
    id TEXT PRIMARY KEY,
    contact_id TEXT,
    conversation_id TEXT,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- incl. effects/presentation unions
);
CREATE INDEX idx_internal_tasks_contact ON internal_tasks(contact_id);
CREATE INDEX idx_internal_tasks_conversation ON internal_tasks(conversation_id);

CREATE TABLE saved_personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE persona_creation_records (
    id TEXT PRIMARY KEY,
    source_contact_id TEXT,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE contact_generation_tasks (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- resumable state machine payload
);
CREATE INDEX idx_generation_tasks_created ON contact_generation_tasks(created_at);

-- Map / locations.
CREATE TABLE locations (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE world_maps (
    id TEXT PRIMARY KEY,           -- singleton 'active'
    data TEXT NOT NULL             -- incl. tiles (width*height array) and roads
);

CREATE TABLE location_module_state (
    id TEXT PRIMARY KEY,           -- singleton 'active'
    data TEXT NOT NULL
);

CREATE TABLE acoustic_edges (
    id TEXT PRIMARY KEY,
    from_location_id TEXT NOT NULL,
    to_location_id TEXT NOT NULL,
    data TEXT NOT NULL
);

-- Durable image-generation jobs. Credentials are never stored.
CREATE TABLE media_assets (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL,          -- chat | moment
    origin_id TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- incl. dataUrl until media files land
);
CREATE INDEX idx_media_assets_conversation ON media_assets(conversation_id);
CREATE INDEX idx_media_assets_origin ON media_assets(origin, origin_id);

CREATE TABLE media_asset_owners (
    asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (asset_id, contact_id)
);

-- Per-turn debug records (天眼) and automatic-call budget records.
CREATE TABLE ai_turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    contact_id TEXT,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_ai_turns_conversation ON ai_turns(conversation_id, created_at);

CREATE TABLE ai_usage_records (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_ai_usage_created ON ai_usage_records(created_at);

-- TTS cache: audio lives as a file under TALK_MEDIA_DIR, path recorded here.
CREATE TABLE speech_cache (
    message_id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,       -- relative to TALK_MEDIA_DIR
    created_at INTEGER NOT NULL
);
