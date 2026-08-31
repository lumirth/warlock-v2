import { describe, expect, it } from 'vitest';
import { parseEnrollmentStatusesXml, parseSubjectCascadeXml } from '../parser.js';

function stream(xml: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(xml));
      controller.close();
    },
  });
}

const CASCADE = `
  <ns2:subject xmlns:ns2="urn:test" id="CS">
    <label>Computer Science</label>
    <cascadingCourse id="CS 225">
      <label>Data Structures</label>
      <description>Data &amp; algorithms.</description>
      <creditHours>4</creditHours>
      <genEdCategories>
        <genEdCategory id="QR">
          <description>Quantitative Reasoning</description>
          <genEdAttributes>
            <genEdAttribute code="QR2">Quantitative Reasoning II</genEdAttribute>
          </genEdAttributes>
        </genEdCategory>
      </genEdCategories>
      <detailedSection id="12345">
        <sectionNumber>AL1</sectionNumber>
        <enrollmentStatus>Open</enrollmentStatus>
        <meeting>
          <type>Lecture</type>
          <start>09:00 AM</start>
          <end>09:50 AM</end>
          <daysOfTheWeek>MWF</daysOfTheWeek>
          <buildingName>Siebel Center</buildingName>
          <roomNumber>1404</roomNumber>
          <instructor><firstName>Wade</firstName><lastName>Fagen-Ulmschneider</lastName></instructor>
        </meeting>
      </detailedSection>
    </cascadingCourse>
  </ns2:subject>`;

describe('CISAPI parsing boundary', () => {
  it('decodes enrollment statuses and entities', () => {
    expect(parseEnrollmentStatusesXml(`
      <subject>
        <detailedSection><enrollmentStatus>Open</enrollmentStatus></detailedSection>
        <detailedSection><enrollmentStatus>Wait &amp; List</enrollmentStatus></detailedSection>
      </subject>
    `)).toEqual(['Open', 'Wait & List']);
  });

  it('preserves course, requirement, section, meeting, and instructor data', async () => {
    const parsed = await parseSubjectCascadeXml(stream(CASCADE));

    expect(parsed).toMatchObject({
      subjectId: 'CS',
      subjectLabel: 'Computer Science',
      courses: [{
        id: 'CS 225',
        label: 'Data Structures',
        description: 'Data & algorithms.',
        genEdCategories: [{
          id: 'QR',
          description: 'Quantitative Reasoning',
          attributes: [{ code: 'QR2', description: 'Quantitative Reasoning II' }],
        }],
        sections: [{
          crn: '12345',
          sectionNumber: 'AL1',
          enrollmentStatus: 'Open',
          meetings: [{
            type: 'Lecture',
            start: '09:00',
            end: '09:50',
            daysOfTheWeek: 'MWF',
            buildingName: 'Siebel Center',
            roomNumber: '1404',
            instructors: [{ firstName: 'Wade', lastName: 'Fagen-Ulmschneider' }],
          }],
        }],
      }],
    });
  });

  it('rejects documents without an authoritative subject id', async () => {
    await expect(parseSubjectCascadeXml(stream('<subject><label>Missing</label></subject>')))
      .rejects.toThrow('missing subject id');
  });
});
