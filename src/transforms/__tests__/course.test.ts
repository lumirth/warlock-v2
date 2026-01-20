import { describe, it, expect } from 'vitest';
import { formatInstructorName, fromSubjectCascade, type CourseWithSections } from '../course.js';
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
    courses: [
      {
        id: '225',
        subject: 'CS',
        title: 'Data Structures',
        description: 'Learn data structures.',
        creditHours: '4',
        genEdCategories: ['QR'],
        sections: [
          {
            crn: '12345',
            sectionNumber: 'AL1',
            enrollmentStatus: 'Open',
            type: 'Lecture',
            startTime: '09:00',
            endTime: '09:50',
            daysOfTheWeek: 'MWF',
            buildingName: 'Siebel',
            roomNumber: '1404',
            instructors: [{ firstName: 'Wade', lastName: 'Fagen' }]
          },
          {
            crn: '12346',
            sectionNumber: 'AYA',
            enrollmentStatus: 'Closed',
            type: 'Discussion',
            startTime: '10:00',
            endTime: '10:50',
            daysOfTheWeek: 'T',
            buildingName: 'Siebel',
            roomNumber: '0218',
            instructors: []
          }
        ]
      }
    ]
  };

  it('transforms parsed cascade to CourseWithSections array', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');

    expect(result).toHaveLength(1);
    expect(result[0].course.id).toBe('CS-225-2026-spring');
    expect(result[0].course.subject).toBe('CS');
    expect(result[0].course.number).toBe('225');
    expect(result[0].course.title).toBe('Data Structures');
  });

  it('sets primary_instructor from first lecture section', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].course.primary_instructor).toBe('Fagen, W');
  });

  it('transforms all sections', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].sections).toHaveLength(2);
    expect(result[0].sections[0].crn).toBe('12345');
    expect(result[0].sections[1].crn).toBe('12346');
  });

  it('formats section location correctly', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].sections[0].location).toBe('Siebel 1404');
  });

  it('sets gened from first category', () => {
    const result = fromSubjectCascade(sampleParsed, 2026, 'spring');
    expect(result[0].course.gened).toBe('QR');
  });
});
