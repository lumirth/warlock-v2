import { describe, expect, it } from 'vitest';
import {
  GENERIC_REQUIREMENT_CODES,
  requirementFilter,
  singleRequirementFilter,
} from '@uiuc-course-search/query-types';
import type { Course } from '../../db/types.js';
import type { SearchResult } from '../../services/search-types.js';
import { presentSearchCourseResult } from '../../services/search-result-presentation.js';
import type { CourseSnapshot } from '../../transforms/course.js';
import {
  courseSnapshotToCourseDetailResponseDto,
  toCourseDto,
  toInstructorLinkDto,
} from '../course.js';

const course: Course = {
  id: 'CS-225-2026-spring',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data abstractions and algorithms.',
  credit_hours: 4,
  year: 2026,
  term: 'spring',
  avg_gpa: 3.5,
  gpa_sample_size: 100,
  primary_instructor: 'Lovelace, A',
  primary_instructor_rmp: 4.8,
  difficulty_score: 22,
  quality_score: 91,
  subject_id: 'CS',
  course_info: null,
  degree_attributes: null,
  class_schedule_info: null,
  date_range_text: null,
  registration_notes: null,
  approval_code: null,
  last_synced: 1,
  created_at: 1,
  updated_at: 1,
};

const courseRequirements = [
  {
    categoryId: 'QR',
    categoryName: 'Quantitative Reasoning',
    attributeCode: 'QR2',
    attributeName: 'Quantitative Reasoning II',
  },
];

function searchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    course,
    score: 1,
    keywordRank: 1,
    semanticRank: 2,
    historical: false,
    ...overrides,
  };
}

describe('search result DTO evidence', () => {
  it('builds evidence for hard filters, ranking signals, preferences, and metadata', () => {
    const evidence = presentSearchCourseResult(searchResult({
      requirements: courseRequirements,
    }), {
      rawQuery: 'easy CS 225 QR MWF morning online data structures',
      hints: [{ type: 'instructor', value: 'Lovelace', metadata: { source: 'alias', confidence: 0.8, raw: 'Lovelace' } }],
      plan: {
        filters: {
          subject: 'CS',
          number: '225',
          requirement: singleRequirementFilter('QR'),
          days: 'MWF',
          time: 'morning',
          online: true,
          workload: 'easy',
          term: 'spring',
          year: 2026,
        },
        introductoryGateway: true,
        softPreferences: { levelBoost: 100 },
        keywordQuery: 'data structures',
        semanticQuery: 'data structures',
      },
    }).matchEvidence ?? [];

    expect(evidence.map(item => item.kind)).toEqual(expect.arrayContaining([
      'course_code',
      'title',
      'requirement',
      'schedule',
      'delivery',
      'instructor',
      'workload',
      'quality',
      'topic',
      'term',
      'keyword',
      'semantic',
    ]));
    expect(evidence.find(item => item.kind === 'course_code')).toMatchObject({ weight: 'hard' });
    expect(evidence.find(item => item.kind === 'workload')?.label).toBe('Easier workload fit');
    expect(evidence.find(item => item.kind === 'quality')?.label).toBe('Excellent quality tier');
    expect(evidence.find(item => item.kind === 'semantic')).toMatchObject({ source: 'semantic' });
    expect(evidence.find(item => item.kind === 'keyword')?.label).toBe('Strong keyword match');
    expect(evidence.find(item => item.kind === 'semantic')?.label).toBe('Related topic match');
    expect(evidence.map(item => item.label).join(' ')).not.toContain('rank #');
    expect(evidence.map(item => item.label).join(' ')).not.toMatch(/Quality \d/);
  });

  it('does not claim topical intro searches are introductory gateway evidence', () => {
    const evidence = presentSearchCourseResult(searchResult(), {
      rawQuery: 'intro to data structures',
      hints: [],
      plan: {
        filters: {},
        softPreferences: { levelBoost: 100 },
        keywordQuery: 'intro to data structures',
        semanticQuery: 'intro to data structures',
      },
    }).matchEvidence ?? [];

    expect(evidence).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Introductory course' }),
    ]));
  });

  it('does not add title evidence for empty raw queries', () => {
    const evidence = presentSearchCourseResult(searchResult(), {
      rawQuery: '   ',
      hints: [],
      plan: {
        filters: {},
        keywordQuery: '',
        semanticQuery: '',
      },
    }).matchEvidence ?? [];

    expect(evidence.some(item => item.kind === 'title')).toBe(false);
  });

  it('attaches result evidence and historical warnings to search DTOs', () => {
    const dto = presentSearchCourseResult(searchResult({ historical: true }), {
      rawQuery: 'CS 225',
      hints: [],
      plan: {
        filters: { subject: 'CS', number: '225' },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.matchEvidence?.some(item => item.kind === 'course_code')).toBe(true);
    expect(dto.warnings).toEqual([{ kind: 'historical', message: 'Historical term result' }]);
    expect(dto.course.metrics.avgGpa).toBe(3.5);
    expect(dto.course.metrics.gpaSampleSize).toBe(100);
    expect(dto.course.metrics.primaryInstructorRating).toBe(4.8);
    expect(dto.course.metrics.qualityScore).toBe(91);
    expect(dto.course.metrics.workloadScore).toBe(22);
    expect(dto.course.links.courseExplorerUrl).toBe('https://courses.illinois.edu/schedule/2026/spring/CS/225');
  });

  it('explains subjective decision matches with evidence and uncertainty', () => {
    const dto = presentSearchCourseResult(searchResult({
      requirements: courseRequirements,
    }), {
      rawQuery: 'easy online gen ed no essays',
      hints: [],
      plan: {
        filters: { requirement: singleRequirementFilter('QR'), online: true, workload: 'easy' },
        keywordQuery: '',
        semanticQuery: '',
        intent: {
          queryTypes: ['requirement', 'schedule', 'subjective_vibe', 'avoidance'],
          negativeTerms: ['writing_heavy', 'essays', 'papers'],
          topicTerms: [],
          expandedTerms: [],
          warnings: [
            { kind: 'writing_evidence_incomplete', message: 'Essay and writing workload evidence is incomplete for many courses.', confidence: 0.78 },
          ],
          confidence: 0.82,
        },
      },
    });

    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining([
      expect.stringContaining('GenEd'),
      expect.stringContaining('Easier workload fit'),
    ]));
    expect(dto.explanation?.watchOut).toEqual(expect.arrayContaining([
      'Essay and writing workload evidence is incomplete for many courses.',
    ]));
    expect(dto.explanation?.confidence.label).toBe('medium');
  });

  it('labels generic requirement filters as Any GenEd in result evidence', () => {
    const dto = presentSearchCourseResult(searchResult({
      course: { ...course },
      requirements: [{
        categoryId: 'QR',
        categoryName: 'Quantitative Reasoning',
        attributeCode: 'QR2',
        attributeName: 'Quantitative Reasoning II',
      }],
    }), {
      rawQuery: 'easy cs gened',
      hints: [],
      plan: {
        filters: {
          subject: 'CS',
          workload: 'easy',
          requirement: requirementFilter('any', GENERIC_REQUIREMENT_CODES),
        },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining(['Any GenEd: QR']));
    expect(dto.matchEvidence?.find(item => item.kind === 'requirement')).toMatchObject({
      label: 'Any GenEd',
      value: 'QR',
      weight: 'hard',
    });
    expect(dto.explanation?.confidence.reasons).toContain('GenEd evidence came from structured mappings.');
  });

  it('explains Cultural Studies sub-attributes from full requirement DTOs', () => {
    const dto = presentSearchCourseResult(searchResult({
      course: { ...course },
      requirements: [{
        categoryId: 'CS',
        categoryName: 'Cultural Studies',
        attributeCode: 'US',
        attributeName: 'US Minority Cultures',
      }],
    }), {
      rawQuery: 'us minority class',
      hints: [],
      plan: {
        filters: { requirement: singleRequirementFilter('US') },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.matchEvidence?.find(item => item.kind === 'requirement')).toMatchObject({
      label: 'GenEd US',
      value: 'US',
      weight: 'hard',
    });
    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining(['GenEd US: US']));
  });

  it('includes explicit sort controls as ordering explanation without changing score evidence', () => {
    const dto = presentSearchCourseResult(searchResult({
      scoreComponents: [{
        name: 'attribute_sort',
        value: 0,
        reason: 'Sorted by Avg GPA (descending); relevance breaks ties.',
        evidence: ['Avg GPA: 3.50.'],
      }],
    }), {
      rawQuery: 'easy gen ed',
      hints: [],
      plan: {
        filters: {},
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining([
      'Sorted by Avg GPA (descending); relevance breaks ties.: Avg GPA: 3.50.',
    ]));
    expect(dto.explanation?.confidence.label).toBe('medium');
  });

  it('does not claim requirement evidence for unmapped courses', () => {
    const dto = presentSearchCourseResult(searchResult({
      course: { ...course },
    }), {
      rawQuery: 'counts for something',
      hints: [],
      plan: {
        filters: {},
        keywordQuery: '',
        semanticQuery: '',
        intent: {
          queryTypes: ['requirement'],
          negativeTerms: [],
          topicTerms: [],
          expandedTerms: [],
          warnings: [],
          confidence: 0.74,
        },
      },
    });

    expect(dto.matchEvidence?.map(item => item.label)).not.toContain('Requirement lane match');
    expect(dto.matchEvidence?.some(item => item.kind === 'requirement')).toBe(false);
    expect(dto.explanation?.confidence.reasons).not.toContain('GenEd evidence came from structured mappings.');
    expect(dto.explanation?.confidence.label).toBe('medium');
    expect(dto.explanation?.confidence.reasons).toContain(
      'Requested requirement has no visible mapping for this course.',
    );
  });

  it('keeps warning construction narrow and non-secret', () => {
    expect(presentSearchCourseResult(searchResult()).warnings).toEqual([]);
    expect(presentSearchCourseResult(searchResult({ historical: true })).warnings)
      .toEqual([{ kind: 'historical', message: 'Historical term result' }]);
  });

  it('does not surface zero-valued RMP rows as ratings', () => {
    const dto = toCourseDto({
      ...course,
      primary_instructor_rmp: 0,
    });
    const link = toInstructorLinkDto({
      instructor_name: 'Fox, E',
      rmp_rating: 0,
      rmp_difficulty: 0,
      rmp_id: 'fox',
      num_ratings: 0,
    });

    expect(dto.metrics.primaryInstructorRating).toBeNull();
    expect(link).toMatchObject({
      instructorName: 'Fox, E',
      rmpRating: null,
      rmpDifficulty: null,
      rmpId: 'fox',
      rmpUrl: null,
      rmpSearchUrl: 'https://www.ratemyprofessors.com/search/professors/1112?q=Fox%2C%20E',
      numRatings: 0,
    });
  });

  it('surfaces public direct RMP links only for numeric professor IDs', () => {
    const link = toInstructorLinkDto({
      instructor_name: 'Fagen-Ulmschneider, W',
      rmp_rating: 4.9,
      rmp_difficulty: 3.4,
      rmp_id: '85515',
      num_ratings: 120,
    });

    expect(link.rmpUrl).toBe('https://www.ratemyprofessors.com/professor/85515');
    expect(link.rmpSearchUrl).toBe('https://www.ratemyprofessors.com/search/professors/1112?q=Fagen-Ulmschneider%2C%20W');
  });

  it('converts fresh course snapshots to the same visible DTO surface as cached rows', () => {
    const { created_at: _createdAt, updated_at: _updatedAt, ...snapshotCourse } = course;
    const snapshot: CourseSnapshot = {
      course: {
        ...snapshotCourse,
        subject_id: 'CS',
        course_info: 'Prerequisite: CS 173.',
        degree_attributes: 'Quantitative Reasoning II.',
        class_schedule_info: 'Register for a lecture and discussion.',
        date_range_text: 'Jan 20 - May 06',
        registration_notes: 'Restricted to majors.',
        approval_code: 'Department Approval Required',
      },
      genEdCategories: [{
        categoryId: 'QR',
        categoryName: 'Quantitative Reasoning',
        attributeCode: '1QR2',
        attributeName: 'Quantitative Reasoning II',
      }],
      sections: [{
        section: {
          id: '2026-spring-12345',
          crn: '12345',
          course_id: 'CS-225-2026-spring',
          term_id: '2026-spring',
          section_number: 'AL1',
          status: 'Open',
          type: 'Lecture',
          days: 'MWF',
          start_time: '09:00',
          end_time: '09:50',
          location: 'Siebel Center 1404',
          instructor: 'Lovelace, A',
          instructor_rmp: null,
          instructor_gpa: null,
          section_title: 'Data Structures Lecture',
          status_code: 'A',
          section_status_code: 'A',
          section_text: 'Lecture notes.',
          section_notes: 'Majors first.',
          capp_area: 'CS',
          date_range_text: 'Jan 20 - May 06',
          part_of_term: '1',
          start_date: '2026-01-20',
          end_date: '2026-05-06',
          credit_hours: '4',
          last_synced: 1,
        },
        meetings: [{
          section_id: '2026-spring-12345',
          meeting_index: 0,
          type_code: 'LEC',
          type_name: 'Lecture',
          days: 'MWF',
          start_time: '09:00',
          end_time: '09:50',
          building_name: 'Siebel Center',
          room_number: '1404',
          date_range_text: 'Jan 20 - May 06',
          instructors: [{ firstName: 'Ada', lastName: 'Lovelace' }],
        }],
      }],
    };

    const dto = courseSnapshotToCourseDetailResponseDto(snapshot, {
      instructorLinks: {
        'Lovelace, A': toInstructorLinkDto({
          instructor_name: 'Lovelace, A',
          rmp_rating: 4.8,
          avg_gpa: 3.62,
          gpa_sample_size: 820,
          num_ratings: 12,
        }),
      },
      medianGpa: 3.6,
    }, {
      cached: false,
    });

    expect(dto).toMatchObject({
      course: {
        id: 'CS-225-2026-spring',
        catalog: {
          courseInfo: 'Prerequisite: CS 173.',
        },
        metrics: {
          medianGpa: 3.6,
        },
      },
      cache: { cached: false },
    });
    expect(dto.course.requirements).toEqual([{
      categoryId: 'QR',
      categoryName: 'Quantitative Reasoning',
      attributeCode: 'QR2',
      attributeName: 'Quantitative Reasoning II',
    }]);
    expect(dto.course.sections[0]).toMatchObject({
      sectionNumber: 'AL1',
      schedule: {
        partOfTerm: '1',
      },
      sourceFacts: {
        sectionNotes: 'Majors first.',
      },
      instructors: {
        rmpRating: 4.8,
        avgGpa: 3.62,
      },
    });
    expect(dto.course.sections[0]?.schedule.meetings[0]).toMatchObject({
      typeCode: 'LEC',
      buildingName: 'Siebel Center',
      instructorNames: ['Lovelace, A'],
      instructors: [expect.objectContaining({ instructorName: 'Lovelace, A' })],
    });
  });
});
