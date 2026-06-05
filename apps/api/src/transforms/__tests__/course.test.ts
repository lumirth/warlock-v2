import { describe, it, expect } from 'vitest';
import { formatInstructorName, fromCourseDetail, fromSubjectCascade } from '../course.js';
import type { ParsedSubjectCascade } from '../../cisapi/parser.js';
import type { CISAPICourseDetail } from '../../cisapi/types.js';

describe('formatInstructorName', () => {
  it('formats full name as "LastName, F"', () => {
    const result = formatInstructorName({ firstName: 'Wade', lastName: 'Fagen-Ulmschneider' });
    expect(result).toBe('Fagen-Ulmschneider, W');
  });

  it('handles missing firstName', () => {
    const result = formatInstructorName({ firstName: '', lastName: 'Smith' });
    expect(result).toBe('Smith');
  });

  it('returns null for undefined instructor', () => {
    const result = formatInstructorName(undefined);
    expect(result).toBeNull();
  });
});

describe('fromSubjectCascade', () => {
  const sampleParsed: ParsedSubjectCascade = {
    subjectId: 'CS',
    subjectLabel: 'Computer Science',
    subjectMetadata: {
      id: 'CS',
      label: 'Computer Science',
      collegeCode: 'KV',
      departmentCode: '1404',
      unitName: 'Department of Computer Science',
      contactName: 'Nancy Amato',
      contactTitle: 'Head',
      addressLine1: 'Siebel Center',
      addressLine2: '201 N Goodwin',
      phoneNumber: '217-333-3333',
      websiteUrl: 'https://cs.illinois.edu',
      description: 'The best CS department.'
    },
    courses: [
      {
        id: '225',
        subject: 'CS',
        title: 'Data Structures',
        description: 'Learn data structures.',
        creditHours: '4',
        courseSectionInformation: 'Prerequisite: CS 173.',
        sectionDegreeAttributes: 'Quantitative Reasoning II.',
        classScheduleInformation: 'Students must register for one lecture and one discussion.',
        sectionDateRange: 'Meets Jan 20 - May 06.',
        sectionRegistrationNotes: 'Restricted to CS majors.',
        sectionApprovalCode: 'Department Approval Required',
        genEdCategories: [
          {
            id: 'QR',
            name: 'Quantitative Reasoning',
            attributes: [
              { code: '1QR2', name: 'Quantitative Reasoning II' }
            ]
          }
        ],
        sections: [
          {
            crn: '12345',
            sectionNumber: 'AL1',
            sectionTitle: 'Lecture 1',
            enrollmentStatus: 'Open',
            statusCode: 'A',
            sectionStatusCode: 'A',
            sectionText: 'Honors section.',
            sectionNotes: 'Must be James Scholar.',
            sectionCappArea: 'Restricted.',
            sectionDateRange: 'Jan 20 - May 06',
            partOfTerm: '1',
            startDate: '2026-01-20',
            endDate: '2026-05-06',
            creditHours: '4',
            meetings: [
              {
                index: 0,
                typeCode: 'LEC',
                type: 'Lecture',
                start: '09:00',
                end: '09:50',
                daysOfTheWeek: 'MWF',
                buildingName: 'Siebel',
                roomNumber: '1404',
                meetingDateRange: 'Jan 20 - May 06',
                instructors: [{ firstName: 'Wade', lastName: 'Fagen' }]
              }
            ]
          },
          {
            crn: '12346',
            sectionNumber: 'AYA',
            sectionTitle: 'Discussion A',
            enrollmentStatus: 'Closed',
            statusCode: 'A',
            sectionStatusCode: 'A',
            sectionText: '',
            sectionNotes: '',
            sectionCappArea: '',
            sectionDateRange: 'Jan 20 - May 06',
            partOfTerm: '1',
            startDate: '2026-01-20',
            endDate: '2026-05-06',
            creditHours: '0',
            meetings: [
              {
                index: 0,
                typeCode: 'DIS',
                type: 'Discussion',
                start: '10:00',
                end: '10:50',
                daysOfTheWeek: 'T',
                buildingName: 'Siebel',
                roomNumber: '0218',
                meetingDateRange: 'Jan 20 - May 06',
                instructors: []
              }
            ]
          }
        ]
      }
    ]
  };

  it('transforms parsed cascade to TransformResult', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');

    // Verify Subject
    expect(result.subject.id).toBe('CS');
    expect(result.subject.name).toBe('Computer Science');
    expect(result.subject.college_code).toBe('KV');
    expect(result.subject.contact_name).toBe('Nancy Amato');

    // Verify Courses
    expect(result.courses).toHaveLength(1);
    const cs225 = result.courses[0];
    expect(cs225.course.id).toBe('CS-225-2026-spring');
    expect(cs225.course.title).toBe('Data Structures');

    // Verify new course fields
    expect(cs225.course.course_info).toBe('Prerequisite: CS 173.');
    expect(cs225.course.degree_attributes).toBe('Quantitative Reasoning II.');
    expect(cs225.course.class_schedule_info).toContain('Students must register');

    // Verify GenEds
    expect(cs225.genEdCategories).toHaveLength(1);
    expect(cs225.genEdCategories[0].attributeCode).toBe('1QR2');
  });

  it('sets primary_instructor from first lecture section', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result.courses[0].course.primary_instructor).toBe('Fagen, W');
  });

  it('keeps gen-ed categories even when the source has no sub-attributes', () => {
    const parsed: ParsedSubjectCascade = {
      ...sampleParsed,
      courses: [
        {
          ...sampleParsed.courses[0],
          genEdCategories: [
            {
              id: 'HUM',
              name: 'Humanities - Lit Arts',
              attributes: []
            }
          ]
        }
      ]
    };

    const result = fromSubjectCascade(parsed, 2026, 'spring');

    expect(result.courses[0].genEdCategories).toEqual([
      {
        categoryId: 'HUM',
        categoryName: 'Humanities - Lit Arts',
        attributeCode: null,
        attributeName: null
      }
    ]);
  });

  it('keeps cultural-studies sub-attributes such as Western and Non-Western', () => {
    const parsed: ParsedSubjectCascade = {
      ...sampleParsed,
      courses: [
        {
          ...sampleParsed.courses[0],
          genEdCategories: [
            {
              id: 'CS',
              name: 'Cultural Studies',
              attributes: [
                { code: 'WCC', name: 'Western/Comparative Cultures' },
                { code: 'NW', name: 'Non-Western Cultures' }
              ]
            }
          ]
        }
      ]
    };

    const result = fromSubjectCascade(parsed, 2026, 'spring');

    expect(result.courses[0].genEdCategories).toEqual([
      {
        categoryId: 'CS',
        categoryName: 'Cultural Studies',
        attributeCode: 'WCC',
        attributeName: 'Western/Comparative Cultures'
      },
      {
        categoryId: 'CS',
        categoryName: 'Cultural Studies',
        attributeCode: 'NW',
        attributeName: 'Non-Western Cultures'
      }
    ]);
  });

  it('collects multiple unique instructors separated by "; "', () => {
    const multiInstructorParsed: ParsedSubjectCascade = {
      ...sampleParsed,
      courses: [
        {
          ...sampleParsed.courses[0],
          sections: [
            {
              ...sampleParsed.courses[0].sections[0],
              meetings: [
                {
                  ...sampleParsed.courses[0].sections[0].meetings[0],
                  instructors: [
                    { firstName: 'Wade', lastName: 'Fagen' },
                    { firstName: 'Geoffrey', lastName: 'Challen' }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };

    const result = fromSubjectCascade(multiInstructorParsed, 2026, 'spring');
    const course = result.courses[0].course;
    const section = result.courses[0].sections[0].section;

    expect(course.primary_instructor).toBe('Fagen, W; Challen, G');
    expect(section.instructor).toBe('Fagen, W; Challen, G');
  });

  it('transforms all sections with new fields', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    const sectionsWithDetails = result.courses[0].sections;

    expect(sectionsWithDetails).toHaveLength(2);
    expect(sectionsWithDetails[0].section.id).toBe('2026-spring-12345');
    expect(sectionsWithDetails[0].section.term_id).toBe('2026-spring');
    expect(sectionsWithDetails[0].section.crn).toBe('12345');
    expect(sectionsWithDetails[0].section.section_title).toBe('Lecture 1');
    expect(sectionsWithDetails[0].section.part_of_term).toBe('1');
    expect(sectionsWithDetails[0].section.start_date).toBe('2026-01-20');

    // Verify meetings
    expect(sectionsWithDetails[0].meetings).toHaveLength(1);
    expect(sectionsWithDetails[0].meetings[0].section_id).toBe('2026-spring-12345');
    expect(sectionsWithDetails[0].meetings[0].type_code).toBe('LEC');
    expect(sectionsWithDetails[0].meetings[0].instructors).toHaveLength(1);
    expect(sectionsWithDetails[0].meetings[0].instructors[0].lastName).toBe('Fagen');
  });
});

describe('fromCourseDetail', () => {
  it('uses the canonical snapshot mapping for live course detail data', () => {
    const parsed: CISAPICourseDetail = {
      id: 'CS 225',
      subjectId: 'CS',
      label: 'Data Structures',
      description: 'Data abstractions and algorithms.',
      creditHours: '4 hours.',
      courseSectionInformation: 'Prerequisite: CS 173.',
      classScheduleInformation: 'Register for one lecture and one discussion.',
      sectionDegreeAttributes: 'Quantitative Reasoning II.',
      sectionDateRange: 'Jan 20 - May 06',
      sectionRegistrationNotes: 'Restricted to majors.',
      sectionApprovalCode: 'Department Approval Required',
      genEdCategories: [{
        id: 'QR',
        description: 'Quantitative Reasoning',
        attributes: [{ code: '1QR2', description: 'Quantitative Reasoning II' }],
      }],
      sections: [{
        crn: '12345',
        sectionNumber: 'AL1',
        sectionTitle: 'Lecture 1',
        statusCode: 'A',
        sectionStatusCode: 'A',
        enrollmentStatus: 'Open',
        sectionText: 'Lecture notes.',
        sectionNotes: 'Majors first.',
        sectionCappArea: 'CS',
        sectionDateRange: 'Jan 20 - May 06',
        partOfTerm: '1',
        startDate: '2026-01-20',
        endDate: '2026-05-06',
        creditHours: '4',
        meetings: [{
          type: 'Lecture',
          typeCode: 'LEC',
          start: '09:00',
          end: '09:50',
          daysOfTheWeek: 'MWF',
          roomNumber: '1404',
          buildingName: 'Siebel Center',
          meetingDateRange: 'Jan 20 - May 06',
          instructors: [{ firstName: 'Ada', lastName: 'Lovelace' }],
        }],
      }],
    };

    const snapshot = fromCourseDetail(parsed, 'CS', '225', 2026, 'spring', {
      syncTimestamp: 1234567890,
    });

    expect(snapshot.course).toMatchObject({
      id: 'CS-225-2026-spring',
      primary_instructor: 'Lovelace, A',
      course_info: 'Prerequisite: CS 173.',
      registration_notes: 'Restricted to majors.',
      approval_code: 'Department Approval Required',
      last_synced: 1234567890,
    });
    expect(snapshot.genEdCategories).toEqual([{
      categoryId: 'QR',
      categoryName: 'Quantitative Reasoning',
      attributeCode: '1QR2',
      attributeName: 'Quantitative Reasoning II',
    }]);
    expect(snapshot.sections[0].section).toMatchObject({
      id: '2026-spring-12345',
      section_title: 'Lecture 1',
      part_of_term: '1',
      instructor: 'Lovelace, A',
    });
    expect(snapshot.sections[0].meetings[0]).toMatchObject({
      type_code: 'LEC',
      type_name: 'Lecture',
      start_time: '09:00',
      instructors: [{ firstName: 'Ada', lastName: 'Lovelace' }],
    });
  });
});
