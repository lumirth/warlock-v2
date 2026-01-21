# Schema Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement comprehensive schema to capture every CISAPI field.

**Architecture:** Add new normalized tables (subjects, instructors, meetings, meeting_instructors, course_gened), expand courses/sections with new columns, update parser and transformer.

**Tech Stack:** D1 SQLite, TypeScript, htmlparser2 XML parser.

---

## Task 1: Add New Tables to Schema

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/schema.sql`

**Step 1: Add subjects table**

Add after line 29 (after courses table):

```sql
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
```

**Step 2: Add instructors table**

```sql
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
```

**Step 3: Add meetings table**

```sql
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
```

**Step 4: Add meeting_instructors table**

```sql
-- Many-to-many: meetings <-> instructors
CREATE TABLE IF NOT EXISTS meeting_instructors (
    meeting_id INTEGER NOT NULL,
    instructor_id INTEGER NOT NULL,
    PRIMARY KEY (meeting_id, instructor_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (instructor_id) REFERENCES instructors(id)
);
```

**Step 5: Add course_gened table**

```sql
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
```

**Step 6: Run tests**

```bash
npm run typecheck
```

**Step 7: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(db): add new normalized tables for schema expansion

- subjects: department metadata
- instructors: normalized instructor data
- meetings: multiple meetings per section
- meeting_instructors: many-to-many relationship
- course_gened: multiple GenEd categories per course"
```

---

## Task 2: Add New Columns to Courses Table

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/schema.sql`

**Step 1: Add new columns to courses table**

Find the courses table (lines 2-29) and add these columns after `gened`:

```sql
    -- New fields from CISAPI
    subject_id TEXT,                  -- FK to subjects
    course_info TEXT,                 -- courseSectionInformation (prereqs, cross-listings)
    degree_attributes TEXT,           -- sectionDegreeAttributes
    class_schedule_info TEXT,         -- classScheduleInformation
    date_range_text TEXT,             -- course-level sectionDateRange
    registration_notes TEXT,          -- sectionRegistrationNotes
    approval_code TEXT,               -- sectionApprovalCode
```

**Step 2: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(db): add new course columns for CISAPI fields"
```

---

## Task 3: Add New Columns to Sections Table

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/schema.sql`

**Step 1: Add new columns to sections table**

Find the sections table (lines 32-55) and add these columns:

```sql
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
```

**Step 2: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(db): add new section columns for CISAPI fields"
```

---

## Task 4: Update TypeScript Types - Subjects and Instructors

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts`

**Step 1: Add Subject interface**

Add after line 2 (after the import):

```typescript
export interface Subject {
  id: string;
  name: string;
  college_code: string | null;
  department_code: string | null;
  unit_name: string | null;
  contact_name: string | null;
  contact_title: string | null;
  address_line1: string | null;
  address_line2: string | null;
  phone_number: string | null;
  website_url: string | null;
  description: string | null;
  last_synced: number | null;
}
```

**Step 2: Add Instructor interface**

```typescript
export interface Instructor {
  id: number;
  first_name: string | null;
  last_name: string;
  display_name: string;
  rmp_rating: number | null;
  rmp_difficulty: number | null;
  avg_gpa: number | null;
  gpa_sample_size: number | null;
}
```

**Step 3: Add Meeting interface**

```typescript
export interface Meeting {
  id: number;
  section_crn: string;
  meeting_index: number;
  type_code: string | null;
  type_name: string | null;
  days: string | null;
  start_time: string | null;
  end_time: string | null;
  building_name: string | null;
  room_number: string | null;
  date_range_text: string | null;
}
```

**Step 4: Add CourseGened interface**

```typescript
export interface CourseGened {
  id: number;
  course_id: string;
  category_id: string;
  category_name: string | null;
  attribute_code: string | null;
  attribute_name: string | null;
}
```

**Step 5: Run typecheck**

```bash
npm run typecheck
```

**Step 6: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add TypeScript interfaces for new tables"
```

---

## Task 5: Update Course Interface with New Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts`

**Step 1: Add new fields to Course interface**

Add these fields to the Course interface (around line 10):

```typescript
  subject_id: string | null;
  course_info: string | null;
  degree_attributes: string | null;
  class_schedule_info: string | null;
  date_range_text: string | null;
  registration_notes: string | null;
  approval_code: string | null;
```

**Step 2: Run typecheck (will show errors - expected)**

```bash
npm run typecheck
```

Expected: Errors in upsertCourse and transforms/course.ts

**Step 3: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add new fields to Course interface"
```

---

## Task 6: Update Section Interface with New Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts`

**Step 1: Add new fields to Section interface**

Add these fields to the Section interface (around line 30):

```typescript
  section_title: string | null;
  status_code: string | null;
  section_status_code: string | null;
  section_text: string | null;
  section_notes: string | null;
  capp_area: string | null;
  date_range_text: string | null;
  part_of_term: string | null;
  start_date: string | null;
  end_date: string | null;
  credit_hours: string | null;
```

**Step 2: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add new fields to Section interface"
```

---

## Task 7: Add Database Operations for New Tables

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts`

**Step 1: Add upsertSubject function**

```typescript
export async function upsertSubject(db: D1Database, subject: Subject): Promise<void> {
  await db.prepare(`
    INSERT INTO subjects (id, name, college_code, department_code, unit_name,
                          contact_name, contact_title, address_line1, address_line2,
                          phone_number, website_url, description, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      college_code = excluded.college_code,
      department_code = excluded.department_code,
      unit_name = excluded.unit_name,
      contact_name = excluded.contact_name,
      contact_title = excluded.contact_title,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      phone_number = excluded.phone_number,
      website_url = excluded.website_url,
      description = excluded.description,
      last_synced = excluded.last_synced
  `).bind(
    subject.id, subject.name, subject.college_code, subject.department_code,
    subject.unit_name, subject.contact_name, subject.contact_title,
    subject.address_line1, subject.address_line2, subject.phone_number,
    subject.website_url, subject.description, subject.last_synced
  ).run();
}
```

**Step 2: Add upsertInstructor function**

```typescript
export async function upsertInstructor(
  db: D1Database,
  instructor: Omit<Instructor, 'id'>
): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO instructors (first_name, last_name, display_name, rmp_rating,
                             rmp_difficulty, avg_gpa, gpa_sample_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(last_name, first_name) DO UPDATE SET
      display_name = excluded.display_name
    RETURNING id
  `).bind(
    instructor.first_name, instructor.last_name, instructor.display_name,
    instructor.rmp_rating, instructor.rmp_difficulty, instructor.avg_gpa,
    instructor.gpa_sample_size
  ).first<{ id: number }>();
  return result?.id ?? 0;
}
```

**Step 3: Add insertMeeting function**

```typescript
export async function insertMeeting(db: D1Database, meeting: Omit<Meeting, 'id'>): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO meetings (section_crn, meeting_index, type_code, type_name,
                          days, start_time, end_time, building_name, room_number,
                          date_range_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(section_crn, meeting_index) DO UPDATE SET
      type_code = excluded.type_code,
      type_name = excluded.type_name,
      days = excluded.days,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      building_name = excluded.building_name,
      room_number = excluded.room_number,
      date_range_text = excluded.date_range_text
    RETURNING id
  `).bind(
    meeting.section_crn, meeting.meeting_index, meeting.type_code, meeting.type_name,
    meeting.days, meeting.start_time, meeting.end_time, meeting.building_name,
    meeting.room_number, meeting.date_range_text
  ).first<{ id: number }>();
  return result?.id ?? 0;
}
```

**Step 4: Add linkMeetingInstructor function**

```typescript
export async function linkMeetingInstructor(
  db: D1Database,
  meetingId: number,
  instructorId: number
): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO meeting_instructors (meeting_id, instructor_id)
    VALUES (?, ?)
  `).bind(meetingId, instructorId).run();
}
```

**Step 5: Add insertCourseGened function**

```typescript
export async function insertCourseGened(
  db: D1Database,
  gened: Omit<CourseGened, 'id'>
): Promise<void> {
  await db.prepare(`
    INSERT INTO course_gened (course_id, category_id, category_name, attribute_code, attribute_name)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    gened.course_id, gened.category_id, gened.category_name,
    gened.attribute_code, gened.attribute_name
  ).run();
}
```

**Step 6: Add deleteCourseGeneds function**

```typescript
export async function deleteCourseGeneds(db: D1Database, courseId: string): Promise<void> {
  await db.prepare('DELETE FROM course_gened WHERE course_id = ?').bind(courseId).run();
}
```

**Step 7: Run typecheck**

```bash
npm run typecheck
```

**Step 8: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): add database operations for new tables"
```

---

## Task 8: Update upsertCourse with New Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts`

**Step 1: Update upsertCourse SQL**

Replace the upsertCourse function (around line 63-88) to include new fields:

```typescript
export async function upsertCourse(db: D1Database, course: Omit<Course, 'created_at' | 'updated_at'>): Promise<void> {
  await db.prepare(`
    INSERT INTO courses (id, subject, number, title, description, credit_hours, gened,
                         subject_id, course_info, degree_attributes, class_schedule_info,
                         date_range_text, registration_notes, approval_code,
                         year, term, avg_gpa, gpa_sample_size, primary_instructor,
                         primary_instructor_rmp, difficulty_score, quality_score, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      credit_hours = excluded.credit_hours,
      gened = excluded.gened,
      subject_id = excluded.subject_id,
      course_info = excluded.course_info,
      degree_attributes = excluded.degree_attributes,
      class_schedule_info = excluded.class_schedule_info,
      date_range_text = excluded.date_range_text,
      registration_notes = excluded.registration_notes,
      approval_code = excluded.approval_code,
      avg_gpa = excluded.avg_gpa,
      gpa_sample_size = excluded.gpa_sample_size,
      primary_instructor = excluded.primary_instructor,
      primary_instructor_rmp = excluded.primary_instructor_rmp,
      difficulty_score = excluded.difficulty_score,
      quality_score = excluded.quality_score,
      last_synced = excluded.last_synced,
      updated_at = unixepoch()
  `).bind(
    course.id, course.subject, course.number, course.title, course.description,
    course.credit_hours, course.gened, course.subject_id, course.course_info,
    course.degree_attributes, course.class_schedule_info, course.date_range_text,
    course.registration_notes, course.approval_code, course.year, course.term,
    course.avg_gpa, course.gpa_sample_size, course.primary_instructor,
    course.primary_instructor_rmp, course.difficulty_score, course.quality_score,
    course.last_synced
  ).run();
}
```

**Step 2: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): update upsertCourse with new fields"
```

---

## Task 9: Update upsertSection with New Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/db/index.ts`

**Step 1: Update upsertSection SQL**

Replace the upsertSection function (around line 90-114):

```typescript
export async function upsertSection(db: D1Database, section: Section): Promise<void> {
  await db.prepare(`
    INSERT INTO sections (crn, course_id, section_number, status, type, days,
                          start_time, end_time, location, instructor,
                          section_title, status_code, section_status_code,
                          section_text, section_notes, capp_area, date_range_text,
                          part_of_term, start_date, end_date, credit_hours,
                          instructor_rmp, instructor_gpa, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(crn) DO UPDATE SET
      section_number = excluded.section_number,
      status = excluded.status,
      type = excluded.type,
      days = excluded.days,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      location = excluded.location,
      instructor = excluded.instructor,
      section_title = excluded.section_title,
      status_code = excluded.status_code,
      section_status_code = excluded.section_status_code,
      section_text = excluded.section_text,
      section_notes = excluded.section_notes,
      capp_area = excluded.capp_area,
      date_range_text = excluded.date_range_text,
      part_of_term = excluded.part_of_term,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      credit_hours = excluded.credit_hours,
      instructor_rmp = excluded.instructor_rmp,
      instructor_gpa = excluded.instructor_gpa,
      last_synced = excluded.last_synced
  `).bind(
    section.crn, section.course_id, section.section_number, section.status,
    section.type, section.days, section.start_time, section.end_time,
    section.location, section.instructor, section.section_title,
    section.status_code, section.section_status_code, section.section_text,
    section.section_notes, section.capp_area, section.date_range_text,
    section.part_of_term, section.start_date, section.end_date,
    section.credit_hours, section.instructor_rmp, section.instructor_gpa,
    section.last_synced
  ).run();
}
```

**Step 2: Commit**

```bash
git add src/db/index.ts
git commit -m "feat(db): update upsertSection with new fields"
```

---

## Task 10: Update CISAPI Types

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/cisapi/types.ts`

**Step 1: Add CISAPISubjectDetail interface**

Add after CISAPISubject interface:

```typescript
export interface CISAPISubjectDetail {
  id: string;
  label: string;
  collegeCode: string;
  departmentCode: string;
  unitName: string;
  contactName: string;
  contactTitle: string;
  addressLine1: string;
  addressLine2: string;
  phoneNumber: string;
  webSiteURL: string;
  collegeDepartmentDescription: string;
}
```

**Step 2: Update CISAPISection interface**

Replace the existing CISAPISection interface:

```typescript
export interface CISAPISection {
  crn: string;
  sectionNumber: string;
  sectionTitle: string;           // NEW - for topics courses
  statusCode: string;
  sectionStatusCode: string;
  enrollmentStatus: string;
  sectionText: string;            // NEW
  sectionNotes: string;           // NEW
  sectionCappArea: string;        // NEW
  sectionDateRange: string;       // NEW
  partOfTerm: string;
  startDate: string;
  endDate: string;
  creditHours: string;            // NEW - section-level override
  meetings: CISAPIMeeting[];
}
```

**Step 3: Update CISAPIMeeting interface**

Replace existing:

```typescript
export interface CISAPIMeeting {
  type: string;
  typeCode: string;
  start: string;
  end: string;
  daysOfTheWeek: string;
  roomNumber: string;
  buildingName: string;
  meetingDateRange: string;       // NEW
  instructors: CISAPIInstructor[];
}
```

**Step 4: Update CISAPICourseDetail interface**

Replace existing:

```typescript
export interface CISAPICourseDetail {
  id: string;
  subjectId: string;
  label: string;
  description: string;
  creditHours: string;
  courseSectionInformation: string;
  classScheduleInformation: string;
  sectionDegreeAttributes: string;      // NEW
  sectionDateRange: string;             // NEW
  sectionRegistrationNotes: string;     // NEW
  sectionApprovalCode: string;          // NEW
  genEdCategories: CISAPIGenEd[];
  sections: CISAPISection[];
}
```

**Step 5: Update CISAPIGenEd interface**

Replace existing:

```typescript
export interface CISAPIGenEd {
  id: string;
  description: string;
  attributes: CISAPIGenEdAttribute[];   // NEW
}

export interface CISAPIGenEdAttribute {
  code: string;
  description: string;
}
```

**Step 6: Run typecheck (expect errors)**

```bash
npm run typecheck
```

**Step 7: Commit**

```bash
git add src/cisapi/types.ts
git commit -m "feat(cisapi): update types with all CISAPI fields"
```

---

## Task 11: Update Parser - Subject Metadata Extraction

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/cisapi/parser.ts`

**Step 1: Add ParsedSubjectMetadata interface**

Add after existing interface declarations:

```typescript
export interface ParsedSubjectMetadata {
  id: string;
  label: string;
  collegeCode: string;
  departmentCode: string;
  unitName: string;
  contactName: string;
  contactTitle: string;
  addressLine1: string;
  addressLine2: string;
  phoneNumber: string;
  websiteUrl: string;
  description: string;
}
```

**Step 2: Update ParsedSubjectCascade interface**

Add subject metadata field:

```typescript
export interface ParsedSubjectCascade {
  subjectId: string;
  subjectLabel: string;
  subjectMetadata: ParsedSubjectMetadata;  // NEW
  courses: ParsedCascadeCourse[];
}
```

**Step 3: Update parseSubjectCascadeXml to extract metadata**

In the parseSubjectCascadeXml function, add metadata extraction. Update the result initialization and add handlers for new fields in onclosetag.

**Step 4: Run tests**

```bash
npm run test
```

**Step 5: Commit**

```bash
git add src/cisapi/parser.ts
git commit -m "feat(parser): extract subject metadata from cascade"
```

---

## Task 12: Update Parser - Course New Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/cisapi/parser.ts`

**Step 1: Update ParsedCascadeCourse interface**

Replace existing:

```typescript
export interface ParsedCascadeCourse {
  id: string;
  subject: string;
  title: string;
  description: string;
  creditHours: string;
  courseInfo: string;              // NEW - courseSectionInformation
  degreeAttributes: string;        // NEW - sectionDegreeAttributes
  classScheduleInfo: string;       // NEW - classScheduleInformation
  dateRangeText: string;           // NEW - sectionDateRange
  registrationNotes: string;       // NEW - sectionRegistrationNotes
  approvalCode: string;            // NEW - sectionApprovalCode
  genEdCategories: ParsedGenEdCategory[];  // UPDATED
  sections: ParsedCascadeSection[];
}

export interface ParsedGenEdCategory {
  id: string;
  name: string;
  attributes: { code: string; name: string }[];
}
```

**Step 2: Update parser to extract new course fields**

Update the onclosetag handler to capture:
- `courseSectionInformation` -> `courseInfo`
- `sectionDegreeAttributes` -> `degreeAttributes`
- `classScheduleInformation` -> `classScheduleInfo`
- `sectionDateRange` -> `dateRangeText`
- `sectionRegistrationNotes` -> `registrationNotes`
- `sectionApprovalCode` -> `approvalCode`

**Step 3: Run tests**

```bash
npm run test
```

**Step 4: Commit**

```bash
git add src/cisapi/parser.ts
git commit -m "feat(parser): extract new course fields from cascade"
```

---

## Task 13: Update Parser - Section New Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/cisapi/parser.ts`

**Step 1: Update ParsedCascadeSection interface**

Replace existing:

```typescript
export interface ParsedCascadeSection {
  crn: string;
  sectionNumber: string;
  sectionTitle: string;            // NEW
  enrollmentStatus: string;
  statusCode: string;              // NEW
  sectionStatusCode: string;       // NEW
  sectionText: string;             // NEW
  sectionNotes: string;            // NEW
  cappArea: string;                // NEW
  dateRangeText: string;           // NEW
  partOfTerm: string;              // NEW
  startDate: string;               // NEW
  endDate: string;                 // NEW
  creditHours: string;             // NEW - section level override
  meetings: ParsedMeeting[];       // UPDATED - multiple meetings
}

export interface ParsedMeeting {
  index: number;
  typeCode: string;
  typeName: string;
  startTime: string;
  endTime: string;
  days: string;
  buildingName: string;
  roomNumber: string;
  dateRangeText: string;
  instructors: { firstName: string; lastName: string }[];
}
```

**Step 2: Update parser to extract new section fields and multiple meetings**

Update the parseSubjectCascadeXml function to:
- Track multiple meetings per section
- Extract sectionTitle, sectionText, sectionNotes, sectionCappArea
- Extract sectionDateRange, partOfTerm, startDate, endDate
- Extract section-level creditHours

**Step 3: Run tests**

```bash
npm run test
```

**Step 4: Commit**

```bash
git add src/cisapi/parser.ts
git commit -m "feat(parser): extract new section fields and multiple meetings"
```

---

## Task 14: Update Transformer - Course Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/transforms/course.ts`

**Step 1: Update CourseWithSections interface**

Add genEd categories:

```typescript
export interface CourseWithSections {
  course: Omit<Course, 'created_at' | 'updated_at'>;
  sections: Section[];
  genEdCategories: { categoryId: string; categoryName: string; attributeCode: string; attributeName: string }[];
}
```

**Step 2: Update fromSubjectCascade to include new course fields**

Update the course object creation to include:
- subject_id
- course_info
- degree_attributes
- class_schedule_info
- date_range_text
- registration_notes
- approval_code

**Step 3: Run typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add src/transforms/course.ts
git commit -m "feat(transform): add new course fields to transformer"
```

---

## Task 15: Update Transformer - Section Fields

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/transforms/course.ts`

**Step 1: Update section transformation**

Update the sections.map() to include:
- section_title
- status_code
- section_status_code
- section_text
- section_notes
- capp_area
- date_range_text
- part_of_term
- start_date
- end_date
- credit_hours (section-level)

**Step 2: Keep primary meeting fields for backwards compatibility**

Still populate type, days, start_time, end_time, location, instructor from first meeting.

**Step 3: Run typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add src/transforms/course.ts
git commit -m "feat(transform): add new section fields to transformer"
```

---

## Task 16: Update Transformer - Subject Metadata

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/transforms/course.ts`

**Step 1: Add SubjectData to return type**

Update function signature and return:

```typescript
export interface TransformResult {
  subject: Subject;
  coursesWithSections: CourseWithSections[];
}

export function fromSubjectCascade(
  parsed: ParsedSubjectCascade,
  year: number,
  term: string
): TransformResult {
  const now = Math.floor(Date.now() / 1000);

  const subject: Subject = {
    id: parsed.subjectId,
    name: parsed.subjectLabel,
    college_code: parsed.subjectMetadata?.collegeCode || null,
    department_code: parsed.subjectMetadata?.departmentCode || null,
    unit_name: parsed.subjectMetadata?.unitName || null,
    contact_name: parsed.subjectMetadata?.contactName || null,
    contact_title: parsed.subjectMetadata?.contactTitle || null,
    address_line1: parsed.subjectMetadata?.addressLine1 || null,
    address_line2: parsed.subjectMetadata?.addressLine2 || null,
    phone_number: parsed.subjectMetadata?.phoneNumber || null,
    website_url: parsed.subjectMetadata?.websiteUrl || null,
    description: parsed.subjectMetadata?.description || null,
    last_synced: now,
  };

  // ... rest of transformation

  return { subject, coursesWithSections };
}
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/transforms/course.ts
git commit -m "feat(transform): add subject metadata to transformer"
```

---

## Task 17: Update Parallel Sync to Use New Schema

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/services/parallel-sync.ts`

**Step 1: Update imports**

Add new database operation imports.

**Step 2: Update sync logic to save subject metadata**

After parsing, call upsertSubject.

**Step 3: Update sync logic to save course geneds**

After upserting course, call deleteCourseGeneds then insertCourseGened for each.

**Step 4: Run typecheck**

```bash
npm run typecheck
```

**Step 5: Run tests**

```bash
npm run test
```

**Step 6: Commit**

```bash
git add src/services/parallel-sync.ts
git commit -m "feat(sync): update parallel sync to use expanded schema"
```

---

## Task 18: Update Parser Tests

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/cisapi/__tests__/parser.test.ts`

**Step 1: Add test for subject metadata extraction**

**Step 2: Add test for new course fields**

**Step 3: Add test for new section fields**

**Step 4: Add test for multiple meetings**

**Step 5: Add test for multiple GenEd categories**

**Step 6: Run tests**

```bash
npm run test
```

**Step 7: Commit**

```bash
git add src/cisapi/__tests__/parser.test.ts
git commit -m "test(parser): add tests for expanded schema parsing"
```

---

## Task 19: Update Transformer Tests

**Files:**
- Modify: `/Users/lu/uiuc-course-search/src/transforms/__tests__/course.test.ts`

**Step 1: Update test fixtures with new fields**

**Step 2: Add assertions for new course fields**

**Step 3: Add assertions for new section fields**

**Step 4: Add assertions for subject metadata**

**Step 5: Run tests**

```bash
npm run test
```

**Step 6: Commit**

```bash
git add src/transforms/__tests__/course.test.ts
git commit -m "test(transform): update tests for expanded schema"
```

---

## Task 20: Run Full Test Suite and Typecheck

**Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors

**Step 2: Run all tests**

```bash
npm run test
```

Expected: All tests pass

**Step 3: Commit if any fixes needed**

---

## Task 21: Deploy Schema to D1

**Step 1: Apply schema to local D1**

```bash
npx wrangler d1 execute uiuc-courses --local --file=src/db/schema.sql
```

**Step 2: Verify tables created**

```bash
npx wrangler d1 execute uiuc-courses --local --command="SELECT name FROM sqlite_master WHERE type='table'"
```

**Step 3: Apply schema to production D1**

```bash
npx wrangler d1 execute uiuc-courses --file=src/db/schema.sql
```

---

## Task 22: Re-sync Historical Data

**Step 1: Run historical sync on a single term to test**

Test with one small term first.

**Step 2: Verify data in database**

Check that subjects, courses, sections, meetings, instructors, and course_gened tables have data.

**Step 3: Run full historical sync**

If test passes, run full sync.

---

## Summary

Total: 22 tasks covering:
1. Database schema changes (Tasks 1-3)
2. TypeScript types (Tasks 4-6)
3. Database operations (Tasks 7-9)
4. CISAPI types (Task 10)
5. Parser updates (Tasks 11-13)
6. Transformer updates (Tasks 14-16)
7. Sync service updates (Task 17)
8. Tests (Tasks 18-20)
9. Deployment and sync (Tasks 21-22)
