import { describe, it, expect } from 'vitest';
import { formatInstructorName, fromSubjectCascade } from '../course.js';
import type { ParsedSubjectCascade } from '../../cisapi/parser.js';

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
        courseInfo: 'Prerequisite: CS 173.',
        degreeAttributes: 'Quantitative Reasoning II.',
        classScheduleInfo: 'Students must register for one lecture and one discussion.',
        dateRangeText: 'Meets Jan 20 - May 06.',
        registrationNotes: 'Restricted to CS majors.',
        approvalCode: 'Department Approval Required',
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
            cappArea: 'Restricted.',
            dateRangeText: 'Jan 20 - May 06',
            partOfTerm: '1',
            startDate: '2026-01-20',
            endDate: '2026-05-06',
            creditHours: '4',
            meetings: [
              {
                index: 0,
                typeCode: 'LEC',
                typeName: 'Lecture',
                startTime: '09:00',
                endTime: '09:50',
                days: 'MWF',
                buildingName: 'Siebel',
                roomNumber: '1404',
                dateRangeText: 'Jan 20 - May 06',
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
            cappArea: '',
            dateRangeText: 'Jan 20 - May 06',
            partOfTerm: '1',
            startDate: '2026-01-20',
            endDate: '2026-05-06',
            creditHours: '0',
            meetings: [
              {
                index: 0,
                typeCode: 'DIS',
                typeName: 'Discussion',
                startTime: '10:00',
                endTime: '10:50',
                days: 'T',
                buildingName: 'Siebel',
                roomNumber: '0218',
                dateRangeText: 'Jan 20 - May 06',
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
    expect(result.coursesWithSections).toHaveLength(1);
    const cs225 = result.coursesWithSections[0];
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
    expect(result.coursesWithSections[0].course.primary_instructor).toBe('Fagen, W');
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
    const course = result.coursesWithSections[0].course;
    const section = result.coursesWithSections[0].sections[0].section;

    expect(course.primary_instructor).toBe('Fagen, W; Challen, G');
    expect(section.instructor).toBe('Fagen, W; Challen, G');
  });

  it('transforms all sections with new fields', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    const sectionsWithDetails = result.coursesWithSections[0].sections;

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
