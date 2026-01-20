import { describe, it, expect } from 'vitest';
import { parseSubjectCascadeXml } from '../parser.js';

// Sample XML that matches actual CISAPI cascade response structure
// Note: CISAPI uses <cascadingCourse> and <detailedSection> in cascade mode
const SAMPLE_CASCADE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:subject xmlns:ns2="http://example.com" id="CS" href="http://example.com">
  <label>Computer Science</label>
  <cascadingCourse id="CS 225" href="http://example.com">
    <label>Data Structures</label>
    <description>Data abstractions and algorithms.</description>
    <creditHours>4</creditHours>
    <category id="QR"/>
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
  it('parses subject id and label correctly', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);

    expect(result).not.toBeNull();
    expect(result?.subjectId).toBe('CS');
    expect(result?.subjectLabel).toBe('Computer Science');
  });

  it('parses cascadingCourse elements (not just <course>)', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);

    expect(result?.courses).toHaveLength(2);
    expect(result?.courses[0].id).toBe('225');
    expect(result?.courses[0].title).toBe('Data Structures');
    expect(result?.courses[1].id).toBe('374');
    expect(result?.courses[1].title).toBe('Intro to Algorithms');
  });

  it('parses detailedSection elements (not just <section>)', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);

    // CS 225 should have 2 sections
    const cs225 = result?.courses.find(c => c.id === '225');
    expect(cs225?.sections).toHaveLength(2);

    // First section should be the lecture
    expect(cs225?.sections[0].crn).toBe('12345');
    expect(cs225?.sections[0].sectionNumber).toBe('AL1');
    expect(cs225?.sections[0].enrollmentStatus).toBe('Open');
    expect(cs225?.sections[0].type).toBe('Lecture');

    // Second section should be the discussion
    expect(cs225?.sections[1].crn).toBe('12346');
    expect(cs225?.sections[1].enrollmentStatus).toBe('Closed');
  });

  it('parses section meeting details correctly', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);
    const cs225 = result?.courses.find(c => c.id === '225');
    const lecture = cs225?.sections[0];

    expect(lecture?.startTime).toBe('09:00');
    expect(lecture?.endTime).toBe('09:50');
    expect(lecture?.daysOfTheWeek).toBe('MWF');
    expect(lecture?.buildingName).toBe('Siebel Center');
    expect(lecture?.roomNumber).toBe('1404');
  });

  it('parses instructor information correctly', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);
    const cs225 = result?.courses.find(c => c.id === '225');
    const lecture = cs225?.sections[0];

    expect(lecture?.instructors).toHaveLength(1);
    expect(lecture?.instructors[0].firstName).toBe('Wade');
    expect(lecture?.instructors[0].lastName).toBe('Fagen-Ulmschneider');
  });

  it('parses genEd categories correctly', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);
    const cs225 = result?.courses.find(c => c.id === '225');

    expect(cs225?.genEdCategories).toContain('QR');
  });

  it('throws for invalid XML without subject id', () => {
    expect(() => parseSubjectCascadeXml('<invalid>xml</invalid>')).toThrow('Invalid XML: missing subject id');
  });

  it('handles sections without instructors gracefully', () => {
    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);
    const cs374 = result?.courses.find(c => c.id === '374');
    const section = cs374?.sections[0];

    // Should have empty instructors array, not crash
    expect(section?.instructors).toEqual([]);
  });
});

// This test specifically documents the bug that was fixed
describe('parseSubjectCascadeXml - detailedSection bug regression test', () => {
  it('MUST parse detailedSection elements - this was a production bug', () => {
    // This test exists because the parser originally looked for <section>
    // but CISAPI returns <detailedSection> in cascade mode.
    // If this test fails, sections will be 0 in the database.

    const result = parseSubjectCascadeXml(SAMPLE_CASCADE_XML);

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
  it('throws on malformed XML', () => {
    expect(() => parseSubjectCascadeXml('<broken')).toThrow();
  });

  it('throws on completely invalid input', () => {
    expect(() => parseSubjectCascadeXml('not xml at all')).toThrow();
  });
});
