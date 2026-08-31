-- Core course table
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,              -- "CS-225-2025-fall"
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    credit_hours INTEGER,

    -- New fields from CISAPI
    subject_id TEXT,                  -- FK to subjects
    course_info TEXT,                 -- courseSectionInformation (prereqs, cross-listings)
    degree_attributes TEXT,           -- sectionDegreeAttributes
    class_schedule_info TEXT,         -- classScheduleInformation
    date_range_text TEXT,             -- course-level sectionDateRange
    registration_notes TEXT,          -- sectionRegistrationNotes
    approval_code TEXT,               -- sectionApprovalCode

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

    credit_hours_text TEXT,

    UNIQUE(subject, number, year, term)
);

-- Subject/department metadata
CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- Normalized instructors
CREATE TABLE IF NOT EXISTS instructors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    UNIQUE(last_name, first_name)
);

-- Multiple GenEd categories per course
CREATE TABLE IF NOT EXISTS course_gened (
    course_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    category_name TEXT,
    attribute_code TEXT NOT NULL DEFAULT '',
    attribute_name TEXT,
    PRIMARY KEY(course_id, category_id, attribute_code),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

-- Sections table
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,                 -- "2026-spring-12345"
    crn TEXT NOT NULL,
    course_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    section_number TEXT,

    -- Status
    status TEXT,                      -- "Open", "Closed", "Restricted", "Unknown"

    -- Schedule
    type TEXT,                        -- "Lecture", "Discussion", "Lab"
    days TEXT,                        -- "MWF", "TR"
    start_time TEXT,                  -- "09:00"
    end_time TEXT,                    -- "09:50"
    location TEXT,

    -- New fields from CISAPI
    section_title TEXT,               -- for topics courses
    status_code TEXT,
    section_status_code TEXT,
    section_text TEXT,                -- detailed info
    section_notes TEXT,               -- major restrictions
    capp_area TEXT,                   -- James Scholars, etc.
    date_range_text TEXT,
    part_of_term TEXT,                -- "1", "A", "B"
    start_date TEXT,
    end_date TEXT,
    credit_hours TEXT,                -- section-level override

    -- Instructor
    instructor TEXT,
    last_synced INTEGER,

    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(term_id, crn)
);

-- Multiple meetings per section
CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id TEXT NOT NULL,
    meeting_index INTEGER NOT NULL,
    type_code TEXT,
    type_name TEXT,
    days TEXT,
    start_time TEXT,
    end_time TEXT,
    building_name TEXT,
    room_number TEXT,
    date_range_text TEXT,
    UNIQUE(section_id, meeting_index),
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meetings_section ON meetings(section_id);

-- Many-to-many: meetings <-> instructors
CREATE TABLE IF NOT EXISTS meeting_instructors (
    meeting_id INTEGER NOT NULL,
    instructor_id INTEGER NOT NULL,
    PRIMARY KEY (meeting_id, instructor_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES instructors(id)
);

-- GPA statistics
CREATE TABLE IF NOT EXISTS gpa_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor TEXT,                  -- NULL = course average

    avg_gpa REAL,
    sample_size INTEGER,

    UNIQUE(subject, number, instructor)
);

CREATE TABLE IF NOT EXISTS gpa_source_rows (
    row_key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor TEXT,
    avg_gpa REAL NOT NULL,
    sample_size INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gpa_source_rows_course_instructor
ON gpa_source_rows(subject, number, instructor);

-- RMP cache
CREATE TABLE IF NOT EXISTS rmp_cache (
    instructor_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    rmp_id TEXT PRIMARY KEY,
    rating REAL,
    difficulty REAL,
    would_take_again_pct REAL,
    num_ratings INTEGER,

    expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rmp_cache_instructor_name
ON rmp_cache(instructor_name);

CREATE TABLE IF NOT EXISTS instructor_course_links (
    term_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor_name TEXT NOT NULL,
    gpa_id INTEGER,
    rmp_id TEXT,

    PRIMARY KEY (term_id, subject, number, instructor_name),
    FOREIGN KEY (gpa_id) REFERENCES gpa_stats(id),
    FOREIGN KEY (rmp_id) REFERENCES rmp_cache(rmp_id)
);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,              -- Global workflow identifier, such as "gpa" or "rmp"
    last_sync INTEGER,
    last_status TEXT CHECK (last_status IN ('pending', 'running', 'complete', 'failed')),
    items_synced INTEGER,
    cursor INTEGER DEFAULT 0,
    owner_token TEXT
);

CREATE TABLE IF NOT EXISTS subject_sync_state (
    term_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    last_sync INTEGER,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    courses_synced INTEGER NOT NULL DEFAULT 0,
    sections_synced INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    owner_token TEXT,
    PRIMARY KEY (term_id, subject)
);
CREATE UNIQUE INDEX idx_subject_sync_state_owner
ON subject_sync_state(term_id, subject, owner_token);

-- A publication batch inserts and removes one of these rows in the same D1
-- transaction. The foreign key makes a stale owner's batch fail before any
-- snapshot rows can be changed.
CREATE TABLE IF NOT EXISTS subject_sync_publication_fences (
    term_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    owner_token TEXT NOT NULL,
    PRIMARY KEY (term_id, subject, owner_token),
    FOREIGN KEY (term_id, subject, owner_token)
      REFERENCES subject_sync_state(term_id, subject, owner_token)
      ON UPDATE CASCADE
      ON DELETE CASCADE
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
    sync_errors TEXT              -- JSON array of recent errors
);

CREATE TABLE IF NOT EXISTS feedback_events (
    id TEXT PRIMARY KEY,
    page TEXT NOT NULL,
    query TEXT,
    course_id TEXT,
    subject TEXT,
    number TEXT,
    term TEXT,
    year INTEGER,
    expected TEXT,
    message TEXT,
    metadata TEXT,
    user_agent TEXT,
    created_at INTEGER DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_courses_term ON courses(year, term);
CREATE INDEX IF NOT EXISTS idx_courses_gpa ON courses(avg_gpa);
CREATE INDEX IF NOT EXISTS idx_sections_course ON sections(course_id);
CREATE INDEX IF NOT EXISTS idx_sections_status ON sections(status);
CREATE INDEX IF NOT EXISTS idx_rmp_expires ON rmp_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_links_context ON instructor_course_links(subject, number);
CREATE INDEX IF NOT EXISTS idx_links_rmp ON instructor_course_links(rmp_id);
CREATE INDEX IF NOT EXISTS idx_term_state_status ON term_state(status);
CREATE INDEX IF NOT EXISTS idx_term_state_year ON term_state(year);
CREATE INDEX IF NOT EXISTS idx_feedback_events_page ON feedback_events(page);
CREATE INDEX IF NOT EXISTS idx_feedback_events_course ON feedback_events(subject, number, year, term);
CREATE INDEX IF NOT EXISTS idx_feedback_events_created ON feedback_events(created_at);

-- Full-text search with trigram tokenizer
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
    subject,
    number,
    title,
    description,
    primary_instructor,
    content='courses',
    content_rowid='rowid',
    tokenize='trigram'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS courses_fts_insert AFTER INSERT ON courses BEGIN
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor);
END;

CREATE TRIGGER IF NOT EXISTS courses_fts_delete AFTER DELETE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor);
END;

CREATE TRIGGER IF NOT EXISTS courses_fts_update AFTER UPDATE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor);
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor);
END;

-- Full-text search for sections (topics courses, section-level instructors)
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
    section_title,
    instructor,
    section_text,
    section_notes,
    content='sections',
    content_rowid='rowid',
    tokenize='trigram'
);

-- Triggers to keep sections_fts in sync
CREATE TRIGGER IF NOT EXISTS sections_fts_insert AFTER INSERT ON sections BEGIN
    INSERT INTO sections_fts(rowid, section_title, instructor, section_text, section_notes)
    VALUES (new.rowid, new.section_title, new.instructor, new.section_text, new.section_notes);
END;

CREATE TRIGGER IF NOT EXISTS sections_fts_delete AFTER DELETE ON sections BEGIN
    INSERT INTO sections_fts(sections_fts, rowid, section_title, instructor, section_text, section_notes)
    VALUES('delete', old.rowid, old.section_title, old.instructor, old.section_text, old.section_notes);
END;

CREATE TRIGGER IF NOT EXISTS sections_fts_update AFTER UPDATE ON sections BEGIN
    INSERT INTO sections_fts(sections_fts, rowid, section_title, instructor, section_text, section_notes)
    VALUES('delete', old.rowid, old.section_title, old.instructor, old.section_text, old.section_notes);
    INSERT INTO sections_fts(rowid, section_title, instructor, section_text, section_notes)
    VALUES (new.rowid, new.section_title, new.instructor, new.section_text, new.section_notes);
END;
