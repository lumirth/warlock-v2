import { describe, it, expect } from 'vitest';
import { parseSubjectCascadeXmlFromString } from '../../apps/api/src/cisapi/parser.js';
import { makeCourseId } from '../../apps/api/src/db/ids.js';
import {
  courseGenedSqlStatements,
  subjectSnapshotSqlStatements,
} from '../../apps/api/src/services/course-snapshot-writer.js';
import { escapeSqlValue } from '../../apps/api/src/services/snapshot-persistence-sql.js';
import { fromSubjectCascade } from '../../apps/api/src/transforms/course.js';
import { parseHistoricalSyncArgs } from '../lib/historical-sync-config.js';
import { chooseSqlOutputPlan } from '../lib/historical-sync-sql-output.js';

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

async function sampleSqlStatements(now = 1234567890): Promise<string[]> {
  const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
  const snapshot = fromSubjectCascade(parsed, 2026, 'spring', {
    syncTimestamp: now,
  });
  return subjectSnapshotSqlStatements(snapshot);
}

function findSqlStatement(statements: string[], needle: string): string {
  const statement = statements.find(sql => sql.includes(needle));
  expect(statement, `Expected SQL statement containing ${needle}`).toBeDefined();
  return statement as string;
}

describe('Historical Sync SQL Generation', () => {
  it('parses CLI args without reading process state', () => {
    expect(parseHistoricalSyncArgs([
      '--start-year=2020',
      '--end-year=2021',
      '--term=fall',
      '--dry-run',
      '--fresh',
      '--allow-partial-output',
    ], new Date('2026-06-01T12:34:56Z'))).toEqual({
      startYear: 2020,
      endYear: 2021,
      termFilter: 'fall',
      dryRun: true,
      fresh: true,
      allowPartialOutput: true,
      sqlFile: 'historical-data-2026-06-01T12-34-56.sql',
      logFile: 'historical-sync-2026-06-01T12-34-56.log',
    });
  });

  it('returns help and rejects invalid year ranges without exiting the process', () => {
    expect(parseHistoricalSyncArgs(['--help'])).toEqual(
      expect.objectContaining({ kind: 'help' })
    );
    expect(() => parseHistoricalSyncArgs(['--start-year=2027', '--end-year=2026']))
      .toThrow('--start-year (2027) cannot be greater than --end-year (2026)');
  });

  it('appends resumed SQL output when checkpointed work already exists', () => {
    expect(chooseSqlOutputPlan({
      dryRun: false,
      fresh: false,
      skippedCount: 1,
      sqlFileExists: true,
      sqlFileHasCommit: false,
    })).toEqual({
      enabled: true,
      flags: 'a',
      writeHeader: false,
      mode: 'resume',
    });
  });

  it('refuses checkpoint resume when the previous SQL artifact is unavailable or already closed', () => {
    expect(() => chooseSqlOutputPlan({
      dryRun: false,
      fresh: false,
      skippedCount: 1,
      sqlFileExists: false,
      sqlFileHasCommit: false,
    })).toThrow('SQL file is missing');

    expect(() => chooseSqlOutputPlan({
      dryRun: false,
      fresh: false,
      skippedCount: 1,
      sqlFileExists: true,
      sqlFileHasCommit: true,
    })).toThrow('already contains COMMIT');
  });

  it('parses real CISAPI cascade XML correctly', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);

    expect(parsed.subjectId).toBe('CS');
    expect(parsed.subjectLabel).toBe('Computer Science');
    expect(parsed.subjectMetadata.collegeCode).toBe('KP');
    expect(parsed.subjectMetadata.unitName).toBe('Siebel School of Computing and Data Science');
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0].id).toBe('CS 101');
    expect(parsed.courses[0].sections).toHaveLength(2);
  });

  it('generates valid SQL for subjects table', async () => {
    const sql = findSqlStatement(await sampleSqlStatements(), 'INSERT INTO subjects');

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
    const sql = findSqlStatement(await sampleSqlStatements(), 'INSERT INTO courses');

    expect(sql).toContain("'CS-101-2026-spring'");
    expect(sql).toContain("'CS'");
    expect(sql).toContain("'101'");
    expect(sql).toContain("'Intro Computing: Engrg & Sci'");
    expect(sql).not.toContain("'QR1'");
    expect(sql).toContain("'Fagen-Ulmschneider, W'"); // Primary instructor from lecture
    expect(sql).toContain("'Prerequisite: One of MATH 220 or MATH 221.'");
    expect(sql).toContain("'Quantitative Reasoning I course.'");
    expect(sql).toContain("2026");
    expect(sql).toContain("'spring'");
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(sql).not.toContain('INSERT OR REPLACE INTO courses');
  });

  it('generates valid SQL for sections table', async () => {
    const sql = findSqlStatement(await sampleSqlStatements(), "'2026-spring-31115'");

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
    expect(sql).toContain('ON CONFLICT(id) DO UPDATE SET');
    expect(sql).not.toContain('INSERT OR REPLACE INTO sections');
  });

  it('generates valid SQL for meetings table', async () => {
    const statements = await sampleSqlStatements();
    const sql = statements.find(statement =>
      statement.startsWith('INSERT INTO meetings')
      && statement.includes("'2026-spring-31115'")
    );
    expect(sql).toBeDefined();

    expect(sql as string).toContain("'2026-spring-31115'");
    expect(sql as string).toContain("'LBD'");
    expect(sql as string).toContain("'Laboratory-Discussion'");
    expect(sql as string).toContain("'Armory'");
    expect(sql as string).toContain("'432'");
    expect(sql as string).toContain('ON CONFLICT(section_id, meeting_index) DO UPDATE SET');
  });

  it('generates valid SQL for instructors table', async () => {
    const sql = findSqlStatement(await sampleSqlStatements(), 'INSERT INTO instructors');

    expect(sql).toContain("'M'");
    expect(sql).toContain("'Fowler'");
    expect(sql).toContain("'Fowler, M'");
    expect(sql).toContain('ON CONFLICT(last_name, first_name) DO UPDATE SET');
  });

  it('generates valid SQL for course_gened table', async () => {
    const sql = findSqlStatement(await sampleSqlStatements(), 'INSERT INTO course_gened');

    expect(sql).toContain("'CS-101-2026-spring'");
    expect(sql).toContain("'QR1'");
    expect(sql).toContain("'Quantitative Reasoning I'");
    expect(sql).toContain('ON CONFLICT(course_id, category_id, attribute_code) DO UPDATE SET');
  });

  it('stores category-only GenEd rows with a stable non-null key', () => {
    const courseId = makeCourseId('CLCV', '100', 2026, 'spring');
    const sql = courseGenedSqlStatements(courseId, [{
      categoryId: 'HUM',
      categoryName: 'Humanities - Lit Arts',
      attributeCode: null,
      attributeName: null,
    }]);

    expect(sql).toEqual([
      "INSERT INTO course_gened (course_id, category_id, category_name, attribute_code, attribute_name) VALUES ('CLCV-100-2026-spring', 'HUM', 'Humanities - Lit Arts', '', NULL) ON CONFLICT(course_id, category_id, attribute_code) DO UPDATE SET category_name = excluded.category_name, attribute_name = excluded.attribute_name;",
      "DELETE FROM course_gened WHERE course_id = 'CLCV-100-2026-spring' AND NOT ((category_id = 'HUM' AND attribute_code = ''));",
    ]);
  });

  it('prunes stale GenEd rows from historical SQL artifacts', () => {
    const courseId = makeCourseId('AAS', '100', 2026, 'spring');

    expect(courseGenedSqlStatements(courseId, [])).toEqual([
      "DELETE FROM course_gened WHERE course_id = 'AAS-100-2026-spring';",
    ]);

    const sql = courseGenedSqlStatements(courseId, [
      {
        categoryId: 'CS',
        categoryName: 'Cultural Studies',
        attributeCode: 'US',
        attributeName: 'US Minority Cultures',
      },
      {
        categoryId: 'SBS',
        categoryName: 'Social & Behavioral Sciences',
        attributeCode: null,
        attributeName: null,
      },
    ]);
    expect(sql.at(-1)).toBe(
      "DELETE FROM course_gened WHERE course_id = 'AAS-100-2026-spring' AND NOT ((category_id = 'CS' AND attribute_code = 'US') OR (category_id = 'SBS' AND attribute_code = ''));"
    );
  });

  it('handles special characters in SQL escaping', async () => {
    // Test single quotes
    expect(escapeSqlValue("O'Brien")).toBe("'O''Brien'");

    // Test newlines
    expect(escapeSqlValue("Line1\nLine2")).toBe("'Line1 Line2'");
    expect(escapeSqlValue("Line1\r\nLine2")).toBe("'Line1 Line2'");

    // Test backslashes
    expect(escapeSqlValue("path\\to\\file")).toBe("'path\\\\to\\\\file'");

    // Test null
    expect(escapeSqlValue(null)).toBe('NULL');

    // Test empty string (should NOT be NULL)
    expect(escapeSqlValue('')).toBe("''");
  });

  it('handles meeting_instructors link SQL correctly', async () => {
    const sql = findSqlStatement(await sampleSqlStatements(), 'INSERT INTO meeting_instructors');

    expect(sql).toContain("m.section_id = '2026-spring-31115'");
    expect(sql).toContain("i.first_name = 'M'");
    expect(sql).not.toContain("IS NULL");
    expect(sql).toContain('ON CONFLICT(meeting_id, instructor_id) DO NOTHING');
  });

  it('uses empty first-name keys when canonical SQL links instructors without a first name', async () => {
    const parsed = await parseSubjectCascadeXmlFromString(REAL_CS_CASCADE_XML);
    parsed.courses[0].sections[0].meetings[0].instructors = [{ firstName: '', lastName: 'Smith' }];
    const snapshot = fromSubjectCascade(parsed, 2026, 'spring', {
      syncTimestamp: 1234567890,
    });
    const sql = findSqlStatement(subjectSnapshotSqlStatements(snapshot), 'INSERT INTO meeting_instructors');

    expect(sql).toContain("i.last_name = 'Smith'");
    expect(sql).toContain("i.first_name = ''");
  });

  it('includes subject-level stale pruning in historical SQL artifacts', async () => {
    const sql = await sampleSqlStatements();

    expect(sql.slice(-5).map(statement => statement.replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('DELETE FROM meeting_instructors WHERE meeting_id IN'),
      expect.stringContaining('DELETE FROM meetings WHERE section_id IN'),
      expect.stringContaining('DELETE FROM sections WHERE course_id IN'),
      expect.stringContaining('DELETE FROM course_gened WHERE course_id IN'),
      expect.stringContaining('DELETE FROM courses WHERE subject ='),
    ]);
  });
});
