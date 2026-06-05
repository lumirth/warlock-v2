import { describe, expect, it } from 'vitest';
import { requirementFilter, singleRequirementFilter } from '@uiuc-course-search/query-types';
import type { Course } from '../../db/index.js';
import type { SearchResult } from '../../services/search.js';
import {
  buildMatchEvidence,
  buildResultWarnings,
} from '../../services/search-result-presentation.js';
import type { CourseSnapshot } from '../../transforms/course.js';
import {
  courseSnapshotToCourseDetailResponseDto,
  searchResultToCourseDto,
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

const courseGeneds = [
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
    const evidence = buildMatchEvidence(searchResult(), {
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
        softPreferences: { levelBoost: 'introductory' },
        keywordQuery: 'data structures',
        semanticQuery: 'data structures',
      },
      requirementCodes: courseGeneds,
    });

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

  it('does not add title evidence for empty raw queries', () => {
    const evidence = buildMatchEvidence(searchResult(), {
      rawQuery: '   ',
      hints: [],
      plan: {
        filters: {},
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(evidence.some(item => item.kind === 'title')).toBe(false);
  });

  it('attaches result evidence and historical warnings to search DTOs', () => {
    const dto = searchResultToCourseDto(searchResult({ historical: true }), {
      rawQuery: 'CS 225',
      hints: [],
      plan: {
        filters: { subject: 'CS', number: '225' },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.match_evidence?.some(item => item.kind === 'course_code')).toBe(true);
    expect(dto.warnings).toEqual([{ kind: 'historical', message: 'Historical term result' }]);
    expect(dto.avg_gpa).toBe(3.5);
    expect(dto.gpa_sample_size).toBe(100);
    expect(dto.primary_instructor_rmp).toBe(4.8);
    expect(dto.quality_score).toBe(91);
    expect(dto.difficulty_score).toBe(22);
    expect(dto.course_explorer_url).toBe('https://courses.illinois.edu/schedule/2026/spring/CS/225');
  });

  it('explains subjective decision matches with evidence and uncertainty', () => {
    const dto = searchResultToCourseDto(searchResult({
      laneMatches: ['requirement', 'student_language_alias'],
      supportedSubjectiveClaims: [],
    }), {
      rawQuery: 'easy online gen ed no essays',
      hints: [],
      plan: {
        filters: { requirement: singleRequirementFilter('QR'), online: true },
        keywordQuery: '',
        semanticQuery: '',
        rescue: {
          queryTypes: ['requirement', 'schedule', 'subjective_vibe', 'avoidance'],
          negativeTerms: ['writing_heavy', 'essays', 'papers'],
          topicTerms: [],
          expandedTerms: [],
          assumptions: [
            { kind: 'online_preferred', label: 'Online preferred', confidence: 0.86, source: 'rule' },
            { kind: 'low_writing', label: 'Low writing preferred', confidence: 0.82, source: 'rule' },
          ],
          warnings: [
            { kind: 'writing_evidence_incomplete', message: 'Essay and writing workload evidence is incomplete for many courses.', confidence: 0.78 },
          ],
          interpretedLanes: ['requirement', 'structured_section', 'student_language_alias', 'workload_evidence'],
          relaxationPlan: [],
          needsStudentProfile: false,
          confidence: 0.82,
        },
      },
      requirementCodes: courseGeneds,
    });

    expect(dto.explanation?.matchedChips).toEqual(['Online preferred', 'Low writing preferred']);
    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining([
      expect.stringContaining('Requirement'),
      'Student-language alias match',
    ]));
    expect(dto.explanation?.watchOut).toEqual(expect.arrayContaining([
      'Essay and writing workload evidence is incomplete for many courses.',
      'Subjective preferences are not fully backed by assignment-level evidence for this course.',
    ]));
    expect(dto.explanation?.confidence.label).toBe('medium');
  });

  it('labels generic requirement filters as Any Requirement in result evidence', () => {
    const dto = searchResultToCourseDto(searchResult({
      course: { ...course },
      laneMatches: ['requirement'],
    }), {
      rawQuery: 'easy cs gened',
      hints: [],
      requirementCodes: [{
        categoryId: 'QR',
        categoryName: 'Quantitative Reasoning',
        attributeCode: 'QR2',
        attributeName: 'Quantitative Reasoning II',
      }],
      plan: {
        filters: {
          subject: 'CS',
          workload: 'easy',
          requirement: requirementFilter('any', [
            'HUM',
            'NAT',
            'SBS',
            'CS',
            'QR',
            'QR1',
            'QR2',
            'NW',
            'US',
            'WCC',
            'ACP',
          ]),
        },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining(['Any Requirement: QR, QR2']));
    expect(dto.match_evidence?.find(item => item.kind === 'requirement')).toMatchObject({
      label: 'Any Requirement',
      value: 'QR, QR2',
      weight: 'hard',
    });
    expect(dto.explanation?.confidence.reasons).toContain('Requirement evidence came from structured mappings.');
  });

  it('explains Cultural Studies sub-attributes from full requirement DTOs', () => {
    const dto = searchResultToCourseDto(searchResult({
      course: { ...course },
      laneMatches: ['requirement'],
    }), {
      rawQuery: 'us minority class',
      hints: [],
      requirementCodes: [{
        categoryId: 'CS',
        categoryName: 'Cultural Studies',
        attributeCode: 'US',
        attributeName: 'US Minority Cultures',
      }],
      plan: {
        filters: { requirement: singleRequirementFilter('US') },
        keywordQuery: '',
        semanticQuery: '',
      },
    });

    expect(dto.match_evidence?.find(item => item.kind === 'requirement')).toMatchObject({
      label: 'Requirement US',
      value: 'US',
      weight: 'hard',
    });
    expect(dto.explanation?.whyMatched).toEqual(expect.arrayContaining(['Requirement US: US']));
  });

  it('includes explicit sort controls as ordering explanation without changing score evidence', () => {
    const dto = searchResultToCourseDto(searchResult({
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
    expect(dto.explanation?.confidence.score).toBe(0.72);
  });

  it('does not claim requirement evidence for unmapped courses', () => {
    const dto = searchResultToCourseDto(searchResult({
      course: { ...course },
      laneMatches: ['requirement'],
    }), {
      rawQuery: 'counts for something',
      hints: [],
      plan: {
        filters: {},
        keywordQuery: '',
        semanticQuery: '',
        rescue: {
          queryTypes: ['requirement'],
          negativeTerms: [],
          topicTerms: [],
          expandedTerms: [],
          assumptions: [],
          warnings: [],
          interpretedLanes: ['requirement'],
          relaxationPlan: [],
          needsStudentProfile: false,
          confidence: 0.74,
        },
      },
    });

    expect(dto.match_evidence?.map(item => item.label)).not.toContain('Requirement lane match');
    expect(dto.match_evidence?.some(item => item.kind === 'requirement')).toBe(false);
    expect(dto.explanation?.confidence.reasons).not.toContain('Requirement evidence came from structured mappings.');
    expect(dto.explanation?.confidence.score).toBe(0.74);
    expect(dto.explanation?.confidence.label).toBe('medium');
  });

  it('keeps warning construction narrow and non-secret', () => {
    expect(buildResultWarnings(searchResult())).toEqual([]);
    expect(buildResultWarnings(searchResult({ historical: true }))[0].message).toBe('Historical term result');
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

    expect(dto.primary_instructor_rmp).toBeNull();
    expect(link).toMatchObject({
      instructor_name: 'Fox, E',
      rmp_rating: null,
      rmp_difficulty: null,
      rmp_id: 'fox',
      rmp_url: null,
      rmp_search_url: 'https://www.ratemyprofessors.com/search/professors/1112?q=Fox%2C%20E',
      num_ratings: 0,
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

    expect(link.rmp_url).toBe('https://www.ratemyprofessors.com/professor/85515');
    expect(link.rmp_search_url).toBe('https://www.ratemyprofessors.com/search/professors/1112?q=Fagen-Ulmschneider%2C%20W');
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
      cached: false,
    });

    expect(dto).toMatchObject({
      id: 'CS-225-2026-spring',
      course_info: 'Prerequisite: CS 173.',
      median_gpa: 3.6,
      cache: { cached: false },
    });
    expect(dto.geneds).toEqual([{
      categoryId: 'QR',
      categoryName: 'Quantitative Reasoning',
      attributeCode: 'QR2',
      attributeName: 'Quantitative Reasoning II',
    }]);
    expect(dto.sections?.[0]).toMatchObject({
      sectionNumber: 'AL1',
      partOfTerm: '1',
      sectionNotes: 'Majors first.',
      instructorRmp: 4.8,
      instructorGpa: 3.62,
    });
    expect(dto.sections?.[0]?.meetings[0]).toMatchObject({
      typeCode: 'LEC',
      buildingName: 'Siebel Center',
      instructorNames: ['Lovelace, A'],
      instructors: [expect.objectContaining({ instructor_name: 'Lovelace, A' })],
    });
  });
});
