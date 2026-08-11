-- Speech cache metadata fields (audio bytes live as files under TALK_MEDIA_DIR).
ALTER TABLE speech_cache ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE speech_cache ADD COLUMN signature TEXT;
ALTER TABLE speech_cache ADD COLUMN provider TEXT;
ALTER TABLE speech_cache ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE speech_cache ADD COLUMN duration_ms INTEGER;
ALTER TABLE speech_cache ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0;
