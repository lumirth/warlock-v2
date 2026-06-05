import { describe, it, expect } from 'vitest';
import {
  parseCourseDetailXml,
  parseEnrollmentStatusesXml,
  parseSubjectCascadeXml,
} from '../parser.js';

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

describe('parseEnrollmentStatusesXml', () => {
  it('extracts enrollment statuses from cascade XML with namespaces and entities', () => {
    expect(parseEnrollmentStatusesXml(`
      <ns2:subject xmlns:ns2="http://example.com">
        <detailedSection id="11111">
          <enrollmentStatus>Open</enrollmentStatus>
        </detailedSection>
        <detailedSection id="22222">
          <enrollmentStatus>Wait &amp; List</enrollmentStatus>
        </detailedSection>
      </ns2:subject>
    `)).toEqual(['Open', 'Wait & List']);
  });
});

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

  it('does not let gen-ed descriptions overwrite course descriptions', async () => {
    const result = await parseSubjectCascadeXml(createStream(SAMPLE_CASCADE_XML));
    const cs225 = result?.courses.find(c => c.id === '225');

    expect(cs225?.description).toBe('Data abstractions and algorithms.');
    expect(cs225?.genEdCategories[0].name).toBe('Quantitative Reasoning I');
  });

  it('parses cultural-studies genEd sub-attributes', async () => {
    const result = await parseSubjectCascadeXml(createStream(`
      <ns2:subject xmlns:ns2="http://example.com" id="CLCV" href="http://example.com">
        <label>Classics</label>
        <cascadingCourse id="CLCV 100" href="http://example.com">
          <label>Classical Mythology</label>
          <creditHours>3</creditHours>
          <genEdCategories>
            <genEdCategory id="CS">
              <description>Cultural Studies</description>
              <genEdAttributes>
                <genEdAttribute code="WCC">Western/Comparative Cultures</genEdAttribute>
              </genEdAttributes>
            </genEdCategory>
          </genEdCategories>
        </cascadingCourse>
      </ns2:subject>
    `));
    const clcv100 = result?.courses.find(c => c.id === '100');

    expect(clcv100?.genEdCategories).toEqual([
      {
        id: 'CS',
        name: 'Cultural Studies',
        attributes: [
          {
            code: 'WCC',
            name: 'Western/Comparative Cultures'
          }
        ]
      }
    ]);
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
        <description>Algorithms &amp; proofs use &lt;models&gt; and decimal &#39;quotes&#39;.</description>
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
    expect(result?.description).toBe("Algorithms & proofs use <models> and decimal 'quotes'.");
    expect(result?.sections[0].meetings[0].type).toBe('Lecture & Lab');
    expect(result?.sections[0].meetings[0].buildingName).toBe('Electrical & Computer Eng Bldg');
  });

  it('extracts declared course and section metadata in course detail XML', () => {
    const result = parseCourseDetailXml(`
      <course id="CS 225">
        <subject id="CS">Computer Science</subject>
        <label>Data Structures</label>
        <description>Data abstractions and algorithms.</description>
        <creditHours>4 hours.</creditHours>
        <courseSectionInformation>Prerequisite: CS 173.</courseSectionInformation>
        <classScheduleInformation>Students must attend lecture.</classScheduleInformation>
        <sectionDegreeAttributes>Quantitative Reasoning I course.</sectionDegreeAttributes>
        <sectionDateRange>01/20/2026 - 05/06/2026</sectionDateRange>
        <sectionRegistrationNotes>Majors only.</sectionRegistrationNotes>
        <sectionApprovalCode>DP</sectionApprovalCode>
        <detailedSection id="12345">
          <sectionNumber>AL1</sectionNumber>
          <sectionTitle>Honors</sectionTitle>
          <statusCode>A</statusCode>
          <sectionStatusCode>A</sectionStatusCode>
          <enrollmentStatus>Open</enrollmentStatus>
          <sectionText>Lecture section text.</sectionText>
          <sectionNotes>Bring laptop.</sectionNotes>
          <sectionCappArea>CS Area</sectionCappArea>
          <sectionDateRange>03/01/2026 - 05/01/2026</sectionDateRange>
          <partOfTerm>B</partOfTerm>
          <startDate>2026-03-01Z</startDate>
          <endDate>2026-05-01Z</endDate>
          <creditHours>4</creditHours>
          <meeting>
            <type>Lecture</type>
          </meeting>
        </detailedSection>
      </course>
    `);

    expect(result).toMatchObject({
      sectionDegreeAttributes: 'Quantitative Reasoning I course.',
      sectionDateRange: '01/20/2026 - 05/06/2026',
      sectionRegistrationNotes: 'Majors only.',
      sectionApprovalCode: 'DP',
    });
    expect(result?.sections[0]).toMatchObject({
      sectionText: 'Lecture section text.',
      sectionNotes: 'Bring laptop.',
      sectionCappArea: 'CS Area',
      sectionDateRange: '03/01/2026 - 05/01/2026',
      partOfTerm: 'B',
    });
    expect(result?.sections[0].meetings[0]).toMatchObject({
      type: 'Lecture',
      typeCode: '',
    });
  });

  it('parses wrapped meeting and instructor collections in course detail XML', () => {
    const result = parseCourseDetailXml(`
      <course id="CLCV 100">
        <subject id="CLCV">Classics</subject>
        <label>Classical Mythology</label>
        <detailedSection id="54321">
          <sectionNumber>A</sectionNumber>
          <meetings>
            <meeting>
              <type code="LCD">Lecture-Discussion</type>
              <start>09:30 AM</start>
              <end>10:45 AM</end>
              <instructors>
                <instructor>
                  <firstName>Jane</firstName>
                  <lastName>Doe</lastName>
                </instructor>
              </instructors>
            </meeting>
          </meetings>
        </detailedSection>
      </course>
    `);

    expect(result?.sections[0].meetings[0]).toMatchObject({
      type: 'Lecture-Discussion',
      typeCode: 'LCD',
      start: '09:30',
      end: '10:45',
      instructors: [{ firstName: 'Jane', lastName: 'Doe' }],
    });
  });

  it('parses genEd sub-attributes in live course detail XML', () => {
    const result = parseCourseDetailXml(`
      <course id="CLCV 100">
        <subject id="CLCV">Classics</subject>
        <label>Classical Mythology</label>
        <genEdCategories>
          <genEdCategory id="CS">
            <description>Cultural Studies</description>
            <genEdAttributes>
              <genEdAttribute code="WCC">Western/Comparative Cultures</genEdAttribute>
              <ns2:genEdAttr id="1US">
                <description>US Minority Cultures</description>
              </ns2:genEdAttr>
            </genEdAttributes>
          </genEdCategory>
        </genEdCategories>
      </course>
    `);

    expect(result?.genEdCategories).toEqual([
      {
        id: 'CS',
        description: 'Cultural Studies',
        attributes: [
          { code: 'WCC', description: 'Western/Comparative Cultures' },
          { code: '1US', description: 'US Minority Cultures' },
        ],
      },
    ]);
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
