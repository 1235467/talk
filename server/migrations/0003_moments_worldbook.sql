-- Moments (朋友圈) and worldbook (世界书/资料库).

CREATE TABLE moments (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,      -- contactId or literal 'user'
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_moments_created ON moments(created_at);

CREATE TABLE moment_comments (
    id TEXT PRIMARY KEY,
    moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    author_contact_id TEXT NOT NULL, -- contactId or literal 'user'
    reply_to_comment_id TEXT,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_moment_comments_moment ON moment_comments(moment_id, created_at);

CREATE TABLE moment_likes (
    id TEXT PRIMARY KEY,
    moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    liker_id TEXT NOT NULL,        -- contactId or literal 'user'
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_moment_likes_moment ON moment_likes(moment_id);

CREATE TABLE worldbook_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE worldbook_entries (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES worldbook_collections(id) ON DELETE CASCADE,
    source_order INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL             -- incl. keywords[]; mirrored into the join table below
);
CREATE INDEX idx_worldbook_entries_collection ON worldbook_entries(collection_id, source_order);

CREATE TABLE worldbook_entry_keywords (
    entry_id TEXT NOT NULL REFERENCES worldbook_entries(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    PRIMARY KEY (entry_id, keyword)
);
CREATE INDEX idx_worldbook_keywords_keyword ON worldbook_entry_keywords(keyword);

CREATE TABLE library_items (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE library_item_keywords (
    item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    PRIMARY KEY (item_id, keyword)
);
CREATE INDEX idx_library_keywords_keyword ON library_item_keywords(keyword);

-- Legacy whole-world snapshots, retained for backup compatibility.
CREATE TABLE saved_worldviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
