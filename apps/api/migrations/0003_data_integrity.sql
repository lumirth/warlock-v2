-- Preserve source provenance for GPA rows. Rebuild the table so the migration
-- chain and fresh bootstrap have the same canonical schema. Existing rows keep
-- nullable provenance because the legacy importer discarded those values.
DROP INDEX idx_gpa_source_rows_course_instructor;
ALTER TABLE gpa_source_rows RENAME TO gpa_source_rows_legacy;

CREATE TABLE gpa_source_rows (
    row_key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor TEXT,
    avg_gpa REAL NOT NULL,
    sample_size INTEGER NOT NULL,
    last_updated INTEGER,
    source_year INTEGER,
    source_term TEXT
);

INSERT INTO gpa_source_rows (
    row_key, subject, number, instructor, avg_gpa, sample_size, last_updated
)
SELECT row_key, subject, number, instructor, avg_gpa, sample_size, last_updated
FROM gpa_source_rows_legacy;

DROP TABLE gpa_source_rows_legacy;

CREATE INDEX idx_gpa_source_rows_course_instructor
ON gpa_source_rows(subject, number, instructor);

-- Keep the official catalog wording so variable-credit courses are never
-- collapsed to the first integer and presented as an exact value.
ALTER TABLE courses ADD COLUMN credit_hours_text TEXT;
-- Legacy rows lost their original wording through parseInt, so even a stored
-- integer may have come from a range. Unknown is safer than false precision;
-- the next authoritative course sync repopulates both fields.
UPDATE courses
SET credit_hours = NULL,
    credit_hours_text = NULL;

-- The legacy RMP cache made "surname + first initial" unique. That can silently
-- replace one professor with another. Cached third-party data and its derived
-- links are regenerable, so rebuild these tables around the stable RMP id rather
-- than attempting to preserve ambiguous identities.
DROP TABLE instructor_course_links;
DROP TABLE rmp_cache;

CREATE TABLE rmp_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    rmp_id TEXT UNIQUE NOT NULL,
    rating REAL,
    difficulty REAL,
    would_take_again_pct REAL,
    num_ratings INTEGER,
    department TEXT,
    top_tags TEXT,
    fetched_at INTEGER,
    expires_at INTEGER
);

CREATE INDEX idx_rmp_cache_instructor_name
ON rmp_cache(instructor_name);
CREATE INDEX idx_rmp_expires
ON rmp_cache(expires_at);

CREATE TABLE instructor_course_links (
    term_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor_name TEXT NOT NULL,
    gpa_id INTEGER,
    rmp_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (term_id, subject, number, instructor_name),
    FOREIGN KEY (gpa_id) REFERENCES gpa_stats(id),
    FOREIGN KEY (rmp_id) REFERENCES rmp_cache(rmp_id)
);
CREATE INDEX idx_links_context
ON instructor_course_links(subject, number);
CREATE INDEX idx_links_rmp
ON instructor_course_links(rmp_id);

-- Ambiguous legacy matches must not survive the migration.
UPDATE instructors
SET rmp_rating = NULL,
    rmp_difficulty = NULL,
    rmp_num_ratings = 0;

UPDATE courses
SET primary_instructor_rmp = NULL,
    quality_score = NULL,
    difficulty_score = NULL;

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '0003_data_integrity', unixepoch());
