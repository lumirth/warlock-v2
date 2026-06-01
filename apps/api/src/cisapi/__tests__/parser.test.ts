import { describe, it, expect } from 'vitest';
import { parseCourseDetailXml, parseSubjectCascadeXml } from '../parser.js';

// Helper to create a stream from a string for testing
function createStream(str: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(str));
      controller.close();
    }
  });
}

// Sample XML that matches actual CISAPI cascade response structure
// Note: CISAPI uses <cascadingCourse> and <detailedSection> in cascade mode
const SAMPLE_CASCADE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:subject xmlns:ns2="http://example.com" id="CS" href="http://example.com">
  <label>Computer Science</label>
  <cascadingCourse id="CS 225" href="http://example.com">
    <label>Data Structures</label>
    <description>Data abstractions and algorithms.</description>
    <creditHours>4</creditHours>
    <genEdCategories>
      <genEdCategory id="QR">
        <description>Quantitative Reasoning I</description>
      </genEdCategory>
    </genEdCategories>
    <detailedSection id="12345" href="http://example.com">
      <sectionNumber>AL1</sectionNumber>
      <enrollmentStatus>Open</enrollmentStatus>
      <meeting>
        <type>Lecture</type>
        <start>09:00 AM</start>
        <end>09:50 AM</end>
        <daysOfTheWeek>MWF</daysOfTheWeek>
        <buildingName>Siebel Center</buildingName>
        <roomNumber>1404</roomNumber>
        <instructor>
          <firstName>Wade</firstName>
          <lastName>Fagen-Ulmschneider</lastName>
        </instructor>
      </meeting>
    </detailedSection>
    <detailedSection id="12346" href="http://example.com">
      <sectionNumber>AYA</sectionNumber>
      <enrollmentStatus>Closed</enrollmentStatus>
      <meeting>
        <type>Discussion/Recitation</type>
        <start>10:00 AM</start>
        <end>10:50 AM</end>
        <daysOfTheWeek>T</daysOfTheWeek>
        <buildingName>Siebel Center</buildingName>
        <roomNumber>0218</roomNumber>
        <instructor>
          <firstName>John</firstName>
          <lastName>Doe</lastName>
        </instructor>
      </meeting>
    </detailedSection>
  </cascadingCourse>
  <cascadingCourse id="CS 374" href="http://example.com">
    <label>Intro to Algorithms</label>
    <description>Analysis of algorithms.</description>
    <creditHours>4</creditHours>
    <detailedSection id="12347" href="http://example.com">
      <sectionNumber>AL1</sectionNumber>
      <enrollmentStatus>Restricted</enrollmentStatus>
      <meeting>
        <type>Lecture</type>
        <start>11:00 AM</start>
        <end>11:50 AM</end>
        <daysOfTheWeek>MWF</daysOfTheWeek>
        <buildingName>Foellinger Auditorium</buildingName>
        <roomNumber></roomNumber>
      </meeting>
    </detailedSection>
  </cascadingCourse>
</ns2:subject>`;

describe('parseSubjectCascadeXml', () => {
  it('parses subject id and label correctly', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));

    expect(result).not.toBeNull();
    expect(result?.subjectId).toBe('CS');
    expect(result?.subjectLabel).toBe('Computer Science');
  });

  it('parses cascadingCourse elements (not just <course>)', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));

    expect(result?.courses).toHaveLength(2);
    expect(result?.courses[0].id).toBe('225');
    expect(result?.courses[0].title).toBe('Data Structures');
    expect(result?.courses[1].id).toBe('374');
    expect(result?.courses[1].title).toBe('Intro to Algorithms');
  });

  it('parses detailedSection elements (not just <section>)', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));

    // CS 225 should have 2 sections
    const cs225 = result?.courses.find(c => c.id === '225');
    expect(cs225?.sections).toHaveLength(2);

    // First section should be the lecture
    expect(cs225?.sections[0].crn).toBe('12345');
    expect(cs225?.sections[0].sectionNumber).toBe('AL1');
    expect(cs225?.sections[0].enrollmentStatus).toBe('Open');
    expect(cs225?.sections[0].meetings[0].typeName).toBe('Lecture');

    // Second section should be the discussion
    expect(cs225?.sections[1].crn).toBe('12346');
    expect(cs225?.sections[1].enrollmentStatus).toBe('Closed');
  });

  it('parses section meeting details correctly', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));
    const cs225 = result?.courses.find(c => c.id === '225');
    const lecture = cs225?.sections[0];
    const meeting = lecture?.meetings[0];

    expect(meeting?.startTime).toBe('09:00');
    expect(meeting?.endTime).toBe('09:50');
    expect(meeting?.days).toBe('MWF');
    expect(meeting?.buildingName).toBe('Siebel Center');
    expect(meeting?.roomNumber).toBe('1404');
  });

  it('parses instructor information correctly', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));
    const cs225 = result?.courses.find(c => c.id === '225');
    const lecture = cs225?.sections[0];
    const meeting = lecture?.meetings[0];

    expect(meeting?.instructors).toHaveLength(1);
    expect(meeting?.instructors[0].firstName).toBe('Wade');
    expect(meeting?.instructors[0].lastName).toBe('Fagen-Ulmschneider');
  });

  it('parses genEd categories correctly', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));
    const cs225 = result?.courses.find(c => c.id === '225');

    expect(cs225?.genEdCategories[0].id).toBe('QR');
  });

  it('throws for invalid XML without subject id', async () => {
    await expect(parseSubjectCascadeXml(createStream('<invalid>xml</invalid>'))).rejects.toThrow('Invalid XML: missing subject id');
  });

  it('handles sections without instructors gracefully', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));
    const cs374 = result?.courses.find(c => c.id === '374');
    const section = cs374?.sections[0];
    const meeting = section?.meetings[0];

    // Should have empty instructors array, not crash
    expect(meeting?.instructors).toEqual([]);
  });
});

describe('parseCourseDetailXml', () => {
  it('decodes XML entities in course detail text', () => {
    const result = parseCourseDetailXml(`
      <course id="CS 374">
        <subject id="CS">Computer Science</subject>
        <label>Introduction to Algorithms &amp; Models of Computation</label>
        <description>Algorithms &amp; proofs use &lt;models&gt;.</description>
        <creditHours>4 hours.</creditHours>
        <detailedSection id="12345">
          <sectionNumber>AL1</sectionNumber>
          <enrollmentStatus>Open</enrollmentStatus>
          <meeting>
            <type code="LEC">Lecture &amp; Lab</type>
            <buildingName>Electrical &amp; Computer Eng Bldg</buildingName>
            <roomNumber>2015</roomNumber>
            <instructor firstName="Ada" lastName="Lovelace"></instructor>
          </meeting>
        </detailedSection>
      </course>
    `);

    expect(result?.label).toBe('Introduction to Algorithms & Models of Computation');
    expect(result?.description).toBe('Algorithms & proofs use <models>.');
    expect(result?.sections[0].meetings[0].type).toBe('Lecture & Lab');
    expect(result?.sections[0].meetings[0].buildingName).toBe('Electrical & Computer Eng Bldg');
  });
});

// This test specifically documents the bug that was fixed
describe('parseSubjectCascadeXml - detailedSection bug regression test', () => {
  it('MUST parse detailedSection elements - this was a production bug', async () => {
    // This test exists because the parser originally looked for <section>
    // but CISAPI returns <detailedSection> in cascade mode.
    // If this test fails, sections will be 0 in the database.

    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));

    const totalSections = result?.courses.reduce(
      (sum, course) => sum + course.sections.length,
      0
    ) ?? 0;

    // CRITICAL: Must be > 0, otherwise we're back to the bug
    expect(totalSections).toBeGreaterThan(0);
    expect(totalSections).toBe(3); // 2 for CS 225, 1 for CS 374
  });
});

describe('parseSubjectCascadeXml - error handling', () => {
  it('throws on malformed XML', async () => {
    // HTML parser is very forgiving, but we can test our explicit throws
    // actually htmlparser2 might not throw on malformed xml, it just parses what it can
    // but our wrapper might throw if subjectId is missing
    await expect(parseSubjectCascadeXml(createStream('<broken'))).rejects.toThrow();
  });
});
