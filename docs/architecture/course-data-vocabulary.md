# Course Data Vocabulary

This project uses several honest vocabularies at once: Course Explorer source
labels, storage columns, internal domain concepts, public DTO fields, and UI
labels. The rule is not "rename everything immediately." The rule is: **rename
only at named boundaries, and do not let aliases leak past ingress.**

## Boundary Rules

- Parsers are source-shaped. A parser may preserve Course Explorer names because
  its job is to report what the source said. Both detail and subject-cascade
  parsing produce the same `CourseExplorerCourse` model.
- Snapshots and DB writers are storage-shaped. They may use table vocabulary such
  as `course_gened`, `difficulty_score`, `course_info`, or `part_of_term`.
- Domain and public DTO code is product-shaped. Search and web state should say
  `requirement`, `instructorDifficulty`, `catalog`, `scheduleNotes`,
  `availability`, and `sourceFacts`. Student-facing copy should call UIUC
  General Education requirements `GenEd`.
- Query aliases terminate at parser/codec edges. Downstream code should not
  prefer legacy aliases such as `gened` or `pot`; instructor difficulty uses
  the explicit `instructor_difficulty` field.
- UI components may render raw source facts, but they should not interpret raw
  source codes. Interpretation belongs in a policy or display-model module.

## Matrix

| Course Explorer / source | Parser model | DB / snapshot | Domain concept | Public DTO | UI label | Query aliases |
| --- | --- | --- | --- | --- | --- | --- |
| Gen-ed category and attribute | `genEdCategories` | `course_gened` | GenEd requirement evidence | `requirements: CourseRequirementDto[]` | GenEd | Canonical request field is `requirement`; visible copy says `GenEd`; forgiving parser accepts `gened`, `gen ed`; source-prefixed codes such as `1US` normalize to public codes such as `US`; Course Explorer `CMP` normalizes to the public code `COMP1`; dense cards render parent-child codes such as `CS:US` or `SBS:SS` when both category and attribute are present |
| Course section information | source detail text | `course_info` | Catalog course information | `catalog.courseInfo` | Course information | none |
| Degree attributes | source detail text | `degree_attributes` | Catalog degree attributes | `catalog.degreeAttributes` | Degree attributes | `requirement` when the parser infers a structured requirement |
| Class schedule information | source detail text | `class_schedule_info` | Schedule note | `scheduleNotes.classScheduleInfo` | Schedule information | none |
| Course date range text | source detail text | `date_range_text` | Schedule note | `scheduleNotes.dateRangeText` | Dates | none |
| Registration notes | source detail text | `registration_notes` | Registration constraint/note | `registration.registrationNotes` | Registration notes | none |
| Approval code | source detail text | `approval_code` | Registration approval requirement | `registration.approvalCode` | Approval | none |
| Enrollment status text | `enrollmentStatus` / section status text | `sections.status` | Section availability label and raw status | `section.availability.rawStatus`, `section.availability.label` | Status | `status` |
| Status codes | `statusCode`, `sectionStatusCode` | `sections.status_code`, `sections.section_status_code` | Section availability state | `section.availability.status`, raw code fields | Status code | `status` |
| Section type | source section type | `sections.type` | Section schedule type | `section.schedule.type` | Type | none |
| Days and times | source section schedule | `sections.days`, `start_time`, `end_time` | Section schedule | `section.schedule.days/startTime/endTime` | Day / Time | `days`, `time` |
| Meeting rows | source meeting rows | `meetings` | Per-meeting schedule | `section.schedule.meetings[]` | Meeting details | `days`, `time`, `online` where structured filters apply |
| Location | source location or meeting building/room | `sections.location`, `meetings.building_name`, `meetings.room_number` | Schedule location | `section.schedule.location`, `meeting.buildingName`, `meeting.roomNumber` | Location | `online` only when delivery intent is structured |
| Part of term | source part-of-term code | `sections.part_of_term` | Compressed-term schedule signal | `section.schedule.partOfTerm` | Part of term | `partOfTerm`, parser may accept `pot`, `8 week`, `first half`, `second half` at ingress |
| Section dates | source section date range | `sections.start_date`, `end_date`, `date_range_text` | Section schedule dates | `section.schedule.startDate/endDate/dateRangeText` | Dates | `partOfTerm` and schedule-language aliases at ingress |
| Section title / text / notes / CAPP area | source section facts | `sections.section_title`, `section_text`, `section_notes`, `capp_area` | Source facts | `section.sourceFacts.*` | Section title / Section notes / Section text / CAPP area | none |
| Section and meeting instructors | source instructor text | `sections.instructor` plus meeting instructors | Canonical course instructor profiles | `section.instructors[]`, `meeting.instructors[]` | Instructor | `instructor` |
| GPA and RMP source metrics | GPA/RMP enrichment with source sample counts | `avg_gpa`, `median_gpa`, `gpa_sample_size`, `quality_score`, `difficulty_score`, RMP rating/difficulty/count fields | Evidence-gated course and instructor signals | `course.metrics.*`, `CourseInstructorDto.*` | GPA / Quality / Instructor difficulty / Instructor rating | Quality is published only when GPA has at least 30 records and RMP has at least 5 ratings; instructor difficulty is an RMP-only signal with at least 5 ratings, not a grade-derived estimate or a claim about total course workload; canonical public fields are `gpa`, `quality`, and `instructor_difficulty` |

## Canonical Policy Owners

- GenEd option groups, public requirement code normalization, full/compact
  requirement labels, and public tier labels live in `packages/query-types`.
- GenEd requirement evidence extraction from snapshots lives in
  `apps/api/src/transforms/course-requirements.ts`.
- Instructor-difficulty and quality score production lives in
  `apps/api/src/services/course-score-policy.ts`.
- Search ranking thresholds and boosts live in
  `apps/api/src/services/ranking/ranking-policy.ts`.
- Raw section status normalization lives in
  `apps/api/src/services/section-availability-policy.ts`.
- Section display fallbacks and tones live in
  `apps/web/src/components/section-display-model.ts`.

When a new field is added, update this matrix in the same change that moves the
field through parser, snapshot/DB, DTO, and UI.
