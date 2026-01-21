# Comprehensive Schema Expansion Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture every field available from CISAPI to build the most complete course database possible.

**Architecture:** Normalize the schema with separate tables for subjects, meetings, instructors, and GenEd categories. This supports multiple instructors per section, multiple meetings per section, and multiple GenEd categories per course.

**Tech Stack:** D1 SQLite, Cloudflare Workers, existing htmlparser2-based XML parser.

---

## Current State

- 4,481 courses synced, 0 sections (parser was broken during historical sync)
- Current schema only captures: basic course info, single instructor, single GenEd, single meeting per section
- Missing: subject metadata, multiple instructors, multiple meetings, section restrictions, part of term, section dates, topics course titles

## Complete Field Inventory

### Subject Level (NEW TABLE)

| XML Element | DB Column | Example |
|-------------|-----------|---------|
| `@id` | `id` | "CS", "AAS" |
| `label` | `name` | "Computer Science" |
| `collegeCode` | `college_code` | "KV" |
| `departmentCode` | `department_code` | "1404" |
| `unitName` | `unit_name` | "Asian American Studies" |
| `contactName` | `contact_name` | "Junaid Rana" |
| `contactTitle` | `contact_title` | "Head of Department" |
| `addressLine1` | `address_line1` | "Department Office" |
| `addressLine2` | `address_line2` | "1208 West Nevada, Urbana" |
| `phoneNumber` | `phone_number` | "217-244-9530" |
| `webSiteURL` | `website_url` | "aasp.illinois.edu" |
| `collegeDepartmentDescription` | `description` | Full text blob |

### Course Level (EXPANDED)

| XML Element | DB Column | Example | Status |
|-------------|-----------|---------|--------|
| `@id` | `id` | "CS 225" | Existing |
| `label` | `title` | "Data Structures" | Existing |
| `description` | `description` | Course description | Existing |
| `creditHours` | `credit_hours` | "4 hours." | Existing |
| `courseSectionInformation` | `course_info` | Prerequisites, cross-listings | **NEW** |
| `sectionDegreeAttributes` | `degree_attributes` | "Quantitative Reasoning II course." | **NEW** |
| `classScheduleInformation` | `class_schedule_info` | "Must register for one lab..." | **NEW** |
| `sectionDateRange` | `date_range_text` | Course-level date range | **NEW** |
| `sectionRegistrationNotes` | `registration_notes` | "Restricted to Undergrad..." | **NEW** |
| `sectionApprovalCode` | `approval_code` | "Departmental Approval Required" | **NEW** |

### GenEd Categories (NEW TABLE - multiple per course)

| XML Element | DB Column | Example |
|-------------|-----------|---------|
| `category/@id` | `category_id` | "QR", "CS", "SBS" |
| `category/description` | `category_name` | "Quantitative Reasoning" |
| `genEdAttribute/@code` | `attribute_code` | "1QR2", "1US" |
| `genEdAttribute` (text) | `attribute_name` | "Quantitative Reasoning II" |

### Section Level (EXPANDED)

| XML Element | DB Column | Example | Status |
|-------------|-----------|---------|--------|
| `@id` | `id` (CRN) | "70578" | Existing |
| `sectionNumber` | `section_number` | "AH", "AL1" | Existing |
| `enrollmentStatus` | `status` | "Open", "Closed" | Existing |
| `sectionTitle` | `section_title` | "Asian Am Crit Mental Health" | **NEW** |
| `statusCode` | `status_code` | "A" | **NEW** |
| `sectionStatusCode` | `section_status_code` | "A" | **NEW** |
| `sectionText` | `section_text` | Detailed info, honors restrictions | **NEW** |
| `sectionNotes` | `section_notes` | Major restrictions | **NEW** |
| `sectionCappArea` | `capp_area` | "Restricted to James Scholars" | **NEW** |
| `sectionDateRange` | `date_range_text` | "Meets 20-Jan-26 - 13-Mar-26." | **NEW** |
| `partOfTerm` | `part_of_term` | "1"=full, "A"=first half, "B"=second half | **NEW** |
| `startDate` | `start_date` | "2026-01-20" | **NEW** |
| `endDate` | `end_date` | "2026-05-06" | **NEW** |
| `creditHours` | `credit_hours` | Section-level override | **NEW** |

### Meeting Level (NEW TABLE - multiple per section)

| XML Element | DB Column | Example |
|-------------|-----------|---------|
| `@id` | `meeting_index` | 0, 1, 2 |
| `type/@code` | `type_code` | "LEC", "LAB", "DIS", "ONL", "LCD", "LBD", "IND" |
| `type` (text) | `type_name` | "Lecture", "Laboratory-Discussion" |
| `start` | `start_time` | "10:00 AM" or "ARRANGED" |
| `end` | `end_time` | "10:50 AM" |
| `daysOfTheWeek` | `days` | "MWF", "TR" |
| `roomNumber` | `room_number` | "1310", "ARR" |
| `buildingName` | `building_name` | "Digital Computer Laboratory" |
| `meetingDateRange` | `date_range_text` | "Meets 20-Jan-26 - 13-Mar-26." |

### Instructor Level (NEW TABLES - multiple per meeting)

| XML Element | DB Column | Example |
|-------------|-----------|---------|
| `@firstName` | `first_name` | "B" |
| `@lastName` | `last_name` | "Solomon" |
| (text) | `display_name` | "Solomon, B" |

---

## Database Schema

### New Tables

```sql
-- Subject/department metadata
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,              -- "CS", "AAS"
  name TEXT NOT NULL,               -- "Computer Science"
  college_code TEXT,                -- "KV"
  department_code TEXT,             -- "1404"
  unit_name TEXT,                   -- "Asian American Studies"
  contact_name TEXT,                -- "Junaid Rana"
  contact_title TEXT,               -- "Head of Department"
  address_line1 TEXT,
  address_line2 TEXT,
  phone_number TEXT,
  website_url TEXT,
  description TEXT,                 -- collegeDepartmentDescription
  last_synced INTEGER
);

-- Normalized instructors (deduplicated across all sections)
CREATE TABLE instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT NOT NULL,
  display_name TEXT NOT NULL,       -- "Solomon, B"
  rmp_rating REAL,
  rmp_difficulty REAL,
  avg_gpa REAL,
  gpa_sample_size INTEGER
);
CREATE UNIQUE INDEX idx_instructors_name ON instructors(last_name, first_name);

-- Multiple meetings per section
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL,      -- FK to sections.id (CRN)
  meeting_index INTEGER NOT NULL,   -- 0, 1, 2...
  type_code TEXT,                   -- "LEC", "LAB", "DIS", "ONL", "LCD", "LBD", "IND"
  type_name TEXT,                   -- "Lecture", "Laboratory"
  days TEXT,                        -- "MWF", "TR"
  start_time TEXT,                  -- "10:00 AM" or "ARRANGED"
  end_time TEXT,                    -- "10:50 AM"
  building_name TEXT,
  room_number TEXT,
  date_range_text TEXT,             -- "Meets 20-Jan-26 - 13-Mar-26."
  UNIQUE(section_id, meeting_index)
);

-- Many-to-many: meetings <-> instructors
CREATE TABLE meeting_instructors (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES instructors(id),
  PRIMARY KEY (meeting_id, instructor_id)
);

-- Multiple GenEd categories per course
CREATE TABLE course_gened (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,       -- FK to courses.id
  category_id TEXT NOT NULL,        -- "QR", "CS", "SBS"
  category_name TEXT,               -- "Quantitative Reasoning"
  attribute_code TEXT,              -- "1QR2"
  attribute_name TEXT               -- "Quantitative Reasoning II"
);
CREATE INDEX idx_course_gened_course ON course_gened(course_id);
```

### Courses Table Modifications

```sql
-- Add new columns
ALTER TABLE courses ADD COLUMN subject_id TEXT REFERENCES subjects(id);
ALTER TABLE courses ADD COLUMN course_info TEXT;           -- courseSectionInformation
ALTER TABLE courses ADD COLUMN degree_attributes TEXT;     -- sectionDegreeAttributes
ALTER TABLE courses ADD COLUMN class_schedule_info TEXT;   -- classScheduleInformation
ALTER TABLE courses ADD COLUMN date_range_text TEXT;       -- sectionDateRange
ALTER TABLE courses ADD COLUMN registration_notes TEXT;    -- sectionRegistrationNotes
ALTER TABLE courses ADD COLUMN approval_code TEXT;         -- sectionApprovalCode

-- Remove single gened column (moved to course_gened table)
-- Note: D1 doesn't support DROP COLUMN, so we'll need to recreate table or leave unused
```

### Sections Table Modifications

```sql
-- Add new columns
ALTER TABLE sections ADD COLUMN section_title TEXT;        -- for topics courses
ALTER TABLE sections ADD COLUMN status_code TEXT;          -- "A"
ALTER TABLE sections ADD COLUMN section_status_code TEXT;  -- "A"
ALTER TABLE sections ADD COLUMN section_text TEXT;         -- detailed info
ALTER TABLE sections ADD COLUMN section_notes TEXT;        -- major restrictions
ALTER TABLE sections ADD COLUMN capp_area TEXT;            -- James Scholars, etc.
ALTER TABLE sections ADD COLUMN date_range_text TEXT;      -- "Meets 20-Jan-26 - 13-Mar-26."
ALTER TABLE sections ADD COLUMN part_of_term TEXT;         -- "1", "A", "B"
ALTER TABLE sections ADD COLUMN start_date TEXT;           -- "2026-01-20"
ALTER TABLE sections ADD COLUMN end_date TEXT;             -- "2026-05-06"
ALTER TABLE sections ADD COLUMN credit_hours TEXT;         -- section-level override

-- Remove single-value fields moved to meetings table
-- (days, start_time, end_time, location, instructor - keep for backwards compat but mark deprecated)
```

---

## Migration Strategy

1. **Non-destructive**: Add new columns/tables without removing existing ones
2. **Backwards compatible**: Keep deprecated columns populated for now
3. **Data migration**: After new schema works, can optionally clean up old columns

---

## Parser Updates Required

1. **Subject parser**: Extract all subject-level metadata
2. **Course parser**: Extract new fields (course_info, degree_attributes, etc.)
3. **GenEd parser**: Handle multiple categories with multiple attributes each
4. **Section parser**: Extract all new section fields
5. **Meeting parser**: Handle multiple meetings per section
6. **Instructor parser**: Handle multiple instructors per meeting, deduplicate

---

## Part of Term Values

| Code | Meaning | Typical Dates |
|------|---------|---------------|
| `1` | Full term | Full semester |
| `A` | First half | Jan 20 - Mar 13 |
| `B` | Second half | Mar 16 - May 6 |

---

## Meeting Type Codes

| Code | Name | Description |
|------|------|-------------|
| `LEC` | Lecture | Standard lecture |
| `LAB` | Laboratory | Lab section |
| `DIS` | Discussion/Recitation | Discussion section |
| `ONL` | Online | Online section |
| `LCD` | Lecture-Discussion | Combined lecture-discussion |
| `LBD` | Laboratory-Discussion | Combined lab-discussion |
| `IND` | Independent Study | Arranged hours |

---

## Implementation Tasks

### Task 1: Create Database Migrations
- Create new tables: subjects, instructors, meetings, meeting_instructors, course_gened
- Add new columns to courses and sections tables
- Add indexes for foreign keys

### Task 2: Update TypeScript Types
- Add Subject, Instructor, Meeting, MeetingInstructor, CourseGened interfaces
- Update Course interface with new fields
- Update Section interface with new fields

### Task 3: Update XML Parser
- Add subject metadata extraction
- Add course new field extraction
- Add multi-GenEd extraction
- Add section new field extraction
- Add multi-meeting extraction
- Add multi-instructor extraction with deduplication

### Task 4: Update Transformer
- Transform parsed XML to new database structures
- Handle instructor deduplication (upsert by last_name, first_name)
- Generate meeting records from section meetings array
- Generate course_gened records from genEdCategories array

### Task 5: Update Database Operations
- Add CRUD operations for new tables
- Update course/section upsert to include new fields
- Add meeting and instructor batch operations

### Task 6: Update Sync Service
- Update parallel-sync to use new schema
- Update historical sync to use parallel-sync infrastructure
- Ensure subject metadata is synced

### Task 7: Re-sync All Data
- Clear existing data (or migrate)
- Run historical sync with new schema
- Verify data integrity
