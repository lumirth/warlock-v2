import { describe, it, expect } from 'vitest';
import { parseSubjectCascadeXmlFromString } from '../../apps/api/src/cisapi/parser.js';
import { courseGenedSqlStatements, escapeSQL, makeCourseId } from '../historical-sync.js';

// Real XML sample from ~/cisapp (trimmed to 1 course with 2 sections)
const REAL_CS_CASCADE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:subject xmlns:ns2="http://rest.cis.illinois.edu" id="CS">
  <label>Computer Science</label>
  <collegeCode>KP</collegeCode>
  <departmentCode>1434</departmentCode>
  <unitName>Siebel School of Computing and Data Science</unitName>
  <contactName>Nancy Amato</contactName>
  <contactTitle>Head of Department</contactTitle>
  <addressLine1>Department Office</addressLine1>
  <addressLine2>2232 Siebel Center, 201 N. Goodwin Avenue, Urbana</addressLine2>
  <phoneNumber>217-333-3426</phoneNumber>
  <webSiteURL>www.cs.illinois.edu</webSiteURL>
  <collegeDepartmentDescription>Head of Department: Nancy Amato
Department Office, 2232 Siebel Center, 201 N. Goodwin Avenue, Urbana, 217-333-3426
www.cs.illinois.edu</collegeDepartmentDescription>
  <cascadingCourses>
    <cascadingCourse id="CS 101" href="https://courses.illinois.edu/cisapp/explorer/schedule/2026/spring/CS/101.xml">
      <label>Intro Computing: Engrg &amp; Sci</label>
      <description>Fundamental principles, concepts, and methods of computing, with emphasis on applications in the physical sciences and engineering.</description>
      <creditHours>3 hours.</creditHours>
      <courseSectionInformation>Prerequisite: One of MATH 220 or MATH 221.</courseSectionInformation>
      <sectionDegreeAttributes>Quantitative Reasoning I course.</sectionDegreeAttributes>
      <genEdCategories>
        <category id="QR1">
          <description>Quantitative Reasoning I</description>
          <genEdAttributes>
            <genEdAttribute code="QR1">Quantitative Reasoning I</genEdAttribute>
          </genEdAttributes>
        </category>
      </genEdCategories>
      <detailedSection id="31115" href="https://courses.illinois.edu/cisapp/explorer/schedule/2026/spring/CS/101/31115.xml">
        <sectionNumber>AYA</sectionNumber>
        <statusCode>A</statusCode>
        <partOfTerm>1</partOfTerm>
        <sectionStatusCode>A</sectionStatusCode>
        <enrollmentStatus>Closed</enrollmentStatus>
        <startDate>2026-01-20Z</startDate>
        <endDate>2026-05-06Z</endDate>
        <sectionText>This section is for engineering students only.</sectionText>
        <sectionNotes>Major restrictions apply.</sectionNotes>
        <meetings>
          <meeting id="0">
            <type code="LBD">Laboratory-Discussion</type>
            <start>09:00 AM</start>
            <end>10:50 AM</end>
            <daysOfTheWeek>T      </daysOfTheWeek>
            <roomNumber>432</roomNumber>
            <buildingName>Armory</buildingName>
            <instructors>
              <instructor lastName="Fowler" firstName="M">Fowler, M</instructor>
            </instructors>
          </meeting>
        </meetings>
      </detailedSection>
      <detailedSection id="31116" href="https://courses.illinois.edu/cisapp/explorer/schedule/2026/spring/CS/101/31116.xml">
        <sectionNumber>AYB</sectionNumber>
        <statusCode>A</statusCode>
        <partOfTerm>1</partOfTerm>
        <sectionStatusCode>A</sectionStatusCode>
        <enrollmentStatus>Open</enrollmentStatus>
        <startDate>2026-01-20Z</startDate>
        <endDate>2026-05-06Z</endDate>
        <meetings>
          <meeting id="0">
            <type code="LEC">Lecture</type>
            <start>11:00 AM</start>
            <end>11:50 AM</end>
            <daysOfTheWeek>MWF    </daysOfTheWeek>
            <roomNumber>1404</roomNumber>
            <buildingName>Siebel Center for Comp Sci</buildingName>
            <instructors>
              <instructor lastName="Fagen-Ulmschneider" firstName="Wade">Fagen-Ulmschneider, Wade</instructor>
            </instructors>
          </meeting>
        </meetings>
      </detailedSection>
    </cascadingCourse>
  </cascadingCourses>
</ns2:subject>`;

function makeTermId(year: number, term: string): string {
  return `${year}-${term}`;
}

function makeSectionId(termId: string, crn: string): string {
  return `${termId}-${crn}`;
}

function formatInstructorName(inst: { firstName: string; lastName: string }): string {
  if (inst.firstName) {
    return `${inst.lastName}, ${inst.firstName.charAt(0)}`;
  }
  return inst.lastName;
}

describe('Historical Sync SQL Generation', () => {
  it('parses real CISAPI cascade XML correctly', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);

    expect(parsed.subjectId).toBe('CS');
    expect(parsed.subjectLabel).toBe('Computer Science');
    expect(parsed.subjectMetadata.collegeCode).toBe('KP');
    expect(parsed.subjectMetadata.unitName).toBe('Siebel School of Computing and Data Science');
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0].id).toBe('101');
    expect(parsed.courses[0].sections).toHaveLength(2);
  });

  it('generates valid SQL for subjects table', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    const meta = parsed.subjectMetadata;
    const now = 1234567890;

    const sql = `INSERT OR REPLACE INTO subjects (id, name, college_code, department_code, unit_name, contact_name, contact_title, address_line1, address_line2, phone_number, website_url, description, last_synced) VALUES (${escapeSQL(parsed.subjectId)}, ${escapeSQL(parsed.subjectLabel || meta.label)}, ${escapeSQL(meta.collegeCode)}, ${escapeSQL(meta.departmentCode)}, ${escapeSQL(meta.unitName)}, ${escapeSQL(meta.contactName)}, ${escapeSQL(meta.contactTitle)}, ${escapeSQL(meta.addressLine1)}, ${escapeSQL(meta.addressLine2)}, ${escapeSQL(meta.phoneNumber)}, ${escapeSQL(meta.websiteUrl)}, ${escapeSQL(meta.description)}, ${now});`;

    // Should contain all expected values
    expect(sql).toContain("'CS'");
    expect(sql).toContain("'Computer Science'");
    expect(sql).toContain("'KP'");
    expect(sql).toContain("'1434'");
    expect(sql).toContain("'Siebel School of Computing and Data Science'");
    expect(sql).toContain("'Nancy Amato'");

    // Description with newlines should be flattened
    expect(sql).not.toContain('\n');
    expect(sql).toContain('Head of Department: Nancy Amato Department Office');
  });

  it('generates valid SQL for courses table', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    const course = parsed.courses[0];
    const year = 2026;
    const term = 'spring';
    const courseId = makeCourseId(parsed.subjectId, course.id, year, term);
    const now = 1234567890;

    // Get primary instructor from lecture section
    const lectureSection = course.sections.find(s =>
      s.meetings.some(m => m.typeName.toLowerCase().includes('lecture'))
    ) || course.sections[0];
    const primaryInstructor = lectureSection?.meetings[0]?.instructors[0];
    const primaryInstructorName = primaryInstructor ? formatInstructorName(primaryInstructor) : null;

    const creditHours = parseInt(course.creditHours) || null;
    const firstGenEd = course.genEdCategories[0]?.id || null;

    const sql = `INSERT OR REPLACE INTO courses (id, subject, number, title, description, credit_hours, gened, subject_id, course_info, degree_attributes, class_schedule_info, date_range_text, registration_notes, approval_code, year, term, primary_instructor, last_synced) VALUES (${escapeSQL(courseId)}, ${escapeSQL(parsed.subjectId)}, ${escapeSQL(course.id)}, ${escapeSQL(course.title)}, ${escapeSQL(course.description)}, ${creditHours ?? 'NULL'}, ${escapeSQL(firstGenEd)}, ${escapeSQL(parsed.subjectId)}, ${escapeSQL(course.courseInfo)}, ${escapeSQL(course.degreeAttributes)}, ${escapeSQL(course.classScheduleInfo)}, ${escapeSQL(course.dateRangeText)}, ${escapeSQL(course.registrationNotes)}, ${escapeSQL(course.approvalCode)}, ${year}, ${escapeSQL(term)}, ${escapeSQL(primaryInstructorName)}, ${now});`;

    expect(sql).toContain("'CS-101-2026-spring'");
    expect(sql).toContain("'CS'");
    expect(sql).toContain("'101'");
    expect(sql).toContain("'Intro Computing: Engrg & Sci'");
    expect(sql).toContain("'QR1'");
    expect(sql).toContain("'Fagen-Ulmschneider, W'"); // Primary instructor from lecture
    expect(sql).toContain("2026");
    expect(sql).toContain("'spring'");
  });

  it('generates valid SQL for sections table', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    const course = parsed.courses[0];
    const section = course.sections[0];
    const year = 2026;
    const term = 'spring';
    const courseId = makeCourseId(parsed.subjectId, course.id, year, term);
    const termId = makeTermId(year, term);
    const sectionId = makeSectionId(termId, section.crn);
    const now = 1234567890;

    const firstMeeting = section.meetings[0];
    const instructorName = firstMeeting?.instructors[0] ? formatInstructorName(firstMeeting.instructors[0]) : null;
    const location = `${firstMeeting?.buildingName || ''} ${firstMeeting?.roomNumber || ''}`.trim();

    const sql = `INSERT OR REPLACE INTO sections (id, crn, course_id, term_id, section_number, status, type, days, start_time, end_time, location, instructor, section_title, status_code, section_status_code, section_text, section_notes, capp_area, date_range_text, part_of_term, start_date, end_date, credit_hours, last_synced) VALUES (${escapeSQL(sectionId)}, ${escapeSQL(section.crn)}, ${escapeSQL(courseId)}, ${escapeSQL(termId)}, ${escapeSQL(section.sectionNumber)}, ${escapeSQL(section.enrollmentStatus)}, ${escapeSQL(firstMeeting?.typeName)}, ${escapeSQL(firstMeeting?.days)}, ${escapeSQL(firstMeeting?.startTime)}, ${escapeSQL(firstMeeting?.endTime)}, ${escapeSQL(location)}, ${escapeSQL(instructorName)}, ${escapeSQL(section.sectionTitle)}, ${escapeSQL(section.statusCode)}, ${escapeSQL(section.sectionStatusCode)}, ${escapeSQL(section.sectionText)}, ${escapeSQL(section.sectionNotes)}, ${escapeSQL(section.cappArea)}, ${escapeSQL(section.dateRangeText)}, ${escapeSQL(section.partOfTerm)}, ${escapeSQL(section.startDate)}, ${escapeSQL(section.endDate)}, ${escapeSQL(section.creditHours)}, ${now});`;

    expect(sql).toContain("'2026-spring-31115'"); // Section ID
    expect(sql).toContain("'31115'"); // CRN
    expect(sql).toContain("'2026-spring'");
    expect(sql).toContain("'CS-101-2026-spring'");
    expect(sql).toContain("'AYA'");
    expect(sql).toContain("'Closed'");
    expect(sql).toContain("'Laboratory-Discussion'");
    expect(sql).toContain("'09:00'");
    expect(sql).toContain("'Armory 432'");
    expect(sql).toContain("'Fowler, M'");
    expect(sql).toContain("'This section is for engineering students only.'");
    expect(sql).toContain("'Major restrictions apply.'");
  });

  it('generates valid SQL for meetings table', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    const section = parsed.courses[0].sections[0];
    const meeting = section.meetings[0];
    const sectionId = makeSectionId(makeTermId(2026, 'spring'), section.crn);

    const sql = `INSERT OR REPLACE INTO meetings (section_id, meeting_index, type_code, type_name, days, start_time, end_time, building_name, room_number, date_range_text) VALUES (${escapeSQL(sectionId)}, 0, ${escapeSQL(meeting.typeCode)}, ${escapeSQL(meeting.typeName)}, ${escapeSQL(meeting.days)}, ${escapeSQL(meeting.startTime)}, ${escapeSQL(meeting.endTime)}, ${escapeSQL(meeting.buildingName)}, ${escapeSQL(meeting.roomNumber)}, ${escapeSQL(meeting.dateRangeText)});`;

    expect(sql).toContain("'2026-spring-31115'");
    expect(sql).toContain("'LBD'");
    expect(sql).toContain("'Laboratory-Discussion'");
    expect(sql).toContain("'Armory'");
    expect(sql).toContain("'432'");
  });

  it('generates valid SQL for instructors table', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    const instructor = parsed.courses[0].sections[0].meetings[0].instructors[0];
    const displayName = formatInstructorName(instructor);

    const sql = `INSERT OR IGNORE INTO instructors (first_name, last_name, display_name) VALUES (${escapeSQL(instructor.firstName)}, ${escapeSQL(instructor.lastName)}, ${escapeSQL(displayName)});`;

    expect(sql).toContain("'M'");
    expect(sql).toContain("'Fowler'");
    expect(sql).toContain("'Fowler, M'");
  });

  it('generates valid SQL for course_gened table', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    const course = parsed.courses[0];
    const courseId = makeCourseId(parsed.subjectId, course.id, 2026, 'spring');
    const genEd = course.genEdCategories[0];

    const sql = `INSERT OR REPLACE INTO course_gened (course_id, category_id, category_name, attribute_code, attribute_name) VALUES (${escapeSQL(courseId)}, ${escapeSQL(genEd.id)}, ${escapeSQL(genEd.name)}, ${escapeSQL(genEd.attributes[0]?.code)}, ${escapeSQL(genEd.attributes[0]?.name)});`;

    expect(sql).toContain("'CS-101-2026-spring'");
    expect(sql).toContain("'QR1'");
    expect(sql).toContain("'Quantitative Reasoning I'");
  });

  it('pre-cleans nullable GenEd attribute rows before historical SQL insert', () => {
    const courseId = makeCourseId('CLCV', '100', 2026, 'spring');
    const sql = courseGenedSqlStatements(courseId, [{
      categoryId: 'HUM',
      categoryName: 'Humanities - Lit Arts',
      attributeCode: null,
      attributeName: null,
    }]);

    expect(sql).toEqual([
      "DELETE FROM course_gened WHERE course_id = 'CLCV-100-2026-spring' AND category_id = 'HUM' AND attribute_code IS NULL;",
      "INSERT OR REPLACE INTO course_gened (course_id, category_id, category_name, attribute_code, attribute_name) VALUES ('CLCV-100-2026-spring', 'HUM', 'Humanities - Lit Arts', NULL, NULL);",
    ]);
  });

  it('handles special characters in SQL escaping', async () => {
    // Test single quotes
    expect(escapeSQL("O'Brien")).toBe("'O''Brien'");

    // Test newlines
    expect(escapeSQL("Line1\nLine2")).toBe("'Line1 Line2'");
    expect(escapeSQL("Line1\r\nLine2")).toBe("'Line1 Line2'");

    // Test backslashes
    expect(escapeSQL("path\\to\\file")).toBe("'path\\\\to\\\\file'");

    // Test null
    expect(escapeSQL(null)).toBe('NULL');

    // Test empty string (should NOT be NULL)
    expect(escapeSQL('')).toBe("''");
  });

  it('handles meeting_instructors link SQL correctly', async () => {
    const sectionId = '2026-spring-31115';
    const meetingIndex = 0;
    const inst = { firstName: 'M', lastName: 'Fowler' };

    // With first name
    const firstName = inst.firstName || '';

    const sql = `INSERT OR IGNORE INTO meeting_instructors (meeting_id, instructor_id) SELECT m.id, i.id FROM meetings m, instructors i WHERE m.section_id = ${escapeSQL(sectionId)} AND m.meeting_index = ${meetingIndex} AND i.last_name = ${escapeSQL(inst.lastName)} AND i.first_name = ${escapeSQL(firstName)};`;

    expect(sql).toContain("m.section_id = '2026-spring-31115'");
    expect(sql).toContain("i.first_name = 'M'");
    expect(sql).not.toContain("IS NULL");

    // Without first name
    const instNoFirst = { firstName: '', lastName: 'Smith' };
    const noFirstName = instNoFirst.firstName || '';

    const sql2 = `INSERT OR IGNORE INTO meeting_instructors (meeting_id, instructor_id) SELECT m.id, i.id FROM meetings m, instructors i WHERE m.section_id = ${escapeSQL(sectionId)} AND m.meeting_index = ${meetingIndex} AND i.last_name = ${escapeSQL(instNoFirst.lastName)} AND i.first_name = ${escapeSQL(noFirstName)};`;

    expect(sql2).toContain("i.first_name = ''");
  });
});
