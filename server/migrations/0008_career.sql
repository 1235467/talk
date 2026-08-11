-- Career: AI-generated job listings and interview sessions.

CREATE TABLE job_listings (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,          -- open | interviewing | hired | rejected
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_job_listings_created ON job_listings(created_at);

CREATE TABLE interviews (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL,          -- active | passed | failed
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_interviews_job ON interviews(job_id);
