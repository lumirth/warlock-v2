-- Migration for Schema Expansion Task 21
-- New tables
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

CREATE TABLE IF NOT EXISTS meeting_instructors (
    meeting_id INTEGER NOT NULL,
    instructor_id INTEGER NOT NULL,
    PRIMARY KEY (meeting_id, instructor_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES instructors(id)
);

CREATE TABLE IF NOT EXISTS course_gened (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    category_name TEXT,
    attribute_code TEXT,
    attribute_name TEXT,
    UNIQUE(course_id, category_id, attribute_code),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_course_gened_course ON course_gened(course_id);

-- Altering existing tables
ALTER TABLE courses ADD COLUMN subject_id TEXT;
ALTER TABLE courses ADD COLUMN course_info TEXT;
ALTER TABLE courses ADD COLUMN degree_attributes TEXT;
ALTER TABLE courses ADD COLUMN class_schedule_info TEXT;
ALTER TABLE courses ADD COLUMN date_range_text TEXT;
ALTER TABLE courses ADD COLUMN registration_notes TEXT;
ALTER TABLE courses ADD COLUMN approval_code TEXT;

ALTER TABLE sections ADD COLUMN section_title TEXT;
ALTER TABLE sections ADD COLUMN status_code TEXT;
ALTER TABLE sections ADD COLUMN section_status_code TEXT;
ALTER TABLE sections ADD COLUMN section_text TEXT;
ALTER TABLE sections ADD COLUMN section_notes TEXT;
ALTER TABLE sections ADD COLUMN capp_area TEXT;
ALTER TABLE sections ADD COLUMN date_range_text TEXT;
ALTER TABLE sections ADD COLUMN part_of_term TEXT;
ALTER TABLE sections ADD COLUMN start_date TEXT;
ALTER TABLE sections ADD COLUMN end_date TEXT;
ALTER TABLE sections ADD COLUMN credit_hours TEXT;
