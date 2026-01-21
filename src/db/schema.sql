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

-- Subject/department metadata
CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,              -- "CS", "AAS"
    name TEXT NOT NULL,               -- "Computer Science"
    college_code TEXT,
    department_code TEXT,
    unit_name TEXT,
    contact_name TEXT,
    contact_title TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    phone_number TEXT,
    website_url TEXT,
    description TEXT,
    last_synced INTEGER
);

-- Normalized instructors
CREATE TABLE IF NOT EXISTS instructors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT,
    last_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    rmp_rating REAL,
    rmp_difficulty REAL,
    avg_gpa REAL,
    gpa_sample_size INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instructors_name ON instructors(last_name, first_name);

-- Multiple meetings per section
CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_crn TEXT NOT NULL,
    meeting_index INTEGER NOT NULL,
    type_code TEXT,
    type_name TEXT,
    days TEXT,
    start_time TEXT,
    end_time TEXT,
    building_name TEXT,
    room_number TEXT,
    date_range_text TEXT,
    UNIQUE(section_crn, meeting_index),
    FOREIGN KEY (section_crn) REFERENCES sections(crn) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meetings_section ON meetings(section_crn);

-- Many-to-many: meetings <-> instructors
CREATE TABLE IF NOT EXISTS meeting_instructors (
    meeting_id INTEGER NOT NULL,
    instructor_id INTEGER NOT NULL,
    PRIMARY KEY (meeting_id, instructor_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES instructors(id)
);

-- Multiple GenEd categories per course
CREATE TABLE IF NOT EXISTS course_gened (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    category_name TEXT,
    attribute_code TEXT,
    attribute_name TEXT,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_course_gened_course ON course_gened(course_id);

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

-- Term state tracking
CREATE TABLE IF NOT EXISTS term_state (
    term_id TEXT PRIMARY KEY,     -- "2025-fall"
    year INTEGER NOT NULL,
    term TEXT NOT NULL,           -- "winter", "spring", "summer", "fall"
    status TEXT NOT NULL,         -- "active" | "historical"
    last_checked INTEGER,         -- Unix timestamp when status was verified
    last_synced INTEGER,          -- Unix timestamp when courses were synced
    subjects_count INTEGER,
    courses_count INTEGER,
    sections_count INTEGER,
    sync_errors TEXT,             -- JSON array of recent errors
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
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
CREATE INDEX IF NOT EXISTS idx_term_state_status ON term_state(status);
CREATE INDEX IF NOT EXISTS idx_term_state_year ON term_state(year);

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
