-- Core course table
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,              -- "CS-225-2025-fall"
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    credit_hours INTEGER,
    gened TEXT,                       -- "QR", "HUM", etc.
    year INTEGER NOT NULL,
    term TEXT NOT NULL,

    -- Enrichment (populated later)
    avg_gpa REAL,
    gpa_sample_size INTEGER,
    primary_instructor TEXT,
    primary_instructor_rmp REAL,

    -- Computed scores
    difficulty_score REAL,
    quality_score REAL,

    -- Sync metadata
    last_synced INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),

    UNIQUE(subject, number, year, term)
);

-- Sections table
CREATE TABLE IF NOT EXISTS sections (
    crn TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    section_number TEXT,

    -- Status
    status TEXT,                      -- "Open", "Closed", "Restricted", "Unknown"

    -- Schedule
    type TEXT,                        -- "Lecture", "Discussion", "Lab"
    days TEXT,                        -- "MWF", "TR"
    start_time TEXT,                  -- "09:00"
    end_time TEXT,                    -- "09:50"
    location TEXT,

    -- Instructor
    instructor TEXT,
    instructor_rmp REAL,
    instructor_gpa REAL,

    last_synced INTEGER,

    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- GPA statistics
CREATE TABLE IF NOT EXISTS gpa_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor TEXT,                  -- NULL = course average

    avg_gpa REAL,
    median_gpa REAL,
    sample_size INTEGER,

    last_updated INTEGER,

    UNIQUE(subject, number, instructor)
);

-- RMP cache
CREATE TABLE IF NOT EXISTS rmp_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instructor_name TEXT UNIQUE NOT NULL,

    rmp_id TEXT,
    rating REAL,
    difficulty REAL,
    would_take_again_pct REAL,
    num_ratings INTEGER,
    department TEXT,
    top_tags TEXT,                    -- JSON array

    fetched_at INTEGER,
    expires_at INTEGER
);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,              -- "courses", "gpa", "rmp"
    last_sync INTEGER,
    last_status TEXT,
    items_synced INTEGER
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_courses_subject ON courses(subject);
CREATE INDEX IF NOT EXISTS idx_courses_term ON courses(year, term);
CREATE INDEX IF NOT EXISTS idx_courses_gpa ON courses(avg_gpa);
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_status ON sections(status);
CREATE INDEX IF NOT EXISTS idx_sections_instructor ON sections(instructor);
CREATE INDEX IF NOT EXISTS idx_sections_time ON sections(start_time);
CREATE INDEX IF NOT EXISTS idx_gpa_course ON gpa_stats(subject, number);
CREATE INDEX IF NOT EXISTS idx_rmp_expires ON rmp_cache(expires_at);

-- Full-text search with trigram tokenizer
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
    subject,
    number,
    title,
    description,
    primary_instructor,
    gened,
    content='courses',
    content_rowid='rowid',
    tokenize='trigram'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS courses_fts_insert AFTER INSERT ON courses BEGIN
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor, gened)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor, new.gened);
END;

CREATE TRIGGER IF NOT EXISTS courses_fts_delete AFTER DELETE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor, gened)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor, old.gened);
END;

CREATE TRIGGER IF NOT EXISTS courses_fts_update AFTER UPDATE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor, gened)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor, old.gened);
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor, gened)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor, new.gened);
END;
