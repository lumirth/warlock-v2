import { describe, expect, it } from 'vitest';
import type { ParsedSubjectCascade } from '../../cisapi/parser.js';
import { fromSubjectCascade, parseCourseCreditHours } from '../course.js';

const parsed: ParsedSubjectCascade = {
  subjectId: 'CS',
  subjectLabel: 'Computer Science',
  courses: [{
    id: 'CS 225', subjectId: 'CS', label: 'Data Structures', description: 'Algorithms',
    creditHours: '4 hours.', courseSectionInformation: 'Prerequisite: CS 173',
    classScheduleInformation: '', sectionDegreeAttributes: '', sectionDateRange: '',
    sectionRegistrationNotes: '', sectionApprovalCode: '',
    genEdCategories: [{
      id: 'QR', description: 'Quantitative Reasoning',
      attributes: [{ code: '1QR2', description: 'Quantitative Reasoning II' }],
    }],
    sections: [{
      crn: '12345', sectionNumber: 'AL1', sectionTitle: 'Lecture', statusCode: 'A',
      sectionStatusCode: 'A', enrollmentStatus: 'Open', sectionText: '', sectionNotes: '',
      sectionCappArea: '', sectionDateRange: '', partOfTerm: '1', startDate: '2026-01-20',
      endDate: '2026-05-06', creditHours: '4', meetings: [{
        type: 'Lecture', typeCode: 'LEC', start: '09:00', end: '09:50',
        daysOfTheWeek: 'MWF', roomNumber: '1404', buildingName: 'Siebel',
        meetingDateRange: '', instructors: [{ firstName: 'Ada', lastName: 'Lovelace' }],
      }],
    }],
  }],
};

describe('course snapshot transform', () => {
  it('maps one upstream cascade into the durable publication model', () => {
    const snapshot = fromSubjectCascade(parsed, 2026, 'spring', { syncTimestamp: 123 });
    expect(snapshot.subject).toMatchObject({ id: 'CS', name: 'Computer Science' });
    expect(snapshot.courses[0]).toMatchObject({
      course: {
        id: 'CS-225-2026-spring', credit_hours: 4, primary_instructor: 'Lovelace, Ada',
        course_info: 'Prerequisite: CS 173',
      },
      genEdCategories: [{ categoryId: 'QR', attributeCode: '1QR2' }],
      sections: [{
        section: { id: '2026-spring-12345', instructor: 'Lovelace, Ada' },
        meetings: [{ type_code: 'LEC', instructors: [{ firstName: 'Ada', lastName: 'Lovelace' }] }],
      }],
    });
  });

  it('keeps variable-credit wording without inventing an exact value', () => {
    expect(parseCourseCreditHours('1 to 4 hours.')).toEqual({ exact: null, text: '1 to 4 hours.' });
  });
});
