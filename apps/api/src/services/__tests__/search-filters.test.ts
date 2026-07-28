import { describe, it, expect } from 'vitest';
import { requirementFilter } from '@uiuc-course-search/query-types';
import { buildFilterClauses, TIME_RANGES } from '../search-filters.js';
import { buildFilteredCourseQuery } from '../search-lane-query-builder.js';
import {
  INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS,
} from '../ranking/ranking-policy.js';
import type { SearchFilters } from '../search-planner-types.js';

describe('buildFilterClauses', () => {
  describe('days filter', () => {
    it('generates SQL for days filter', () => {
      const filters: SearchFilters = { days: 'MWF' };
      const result = buildFilterClauses(filters);
      expect(result.where).toEqual(expect.arrayContaining([
        'm.days LIKE ?',
        'm.days LIKE ?',
        'm.days LIKE ?',
      ]));
      expect(result.params).toEqual(expect.arrayContaining(['%M%', '%W%', '%F%']));
      expect(result.joins).toEqual(['sections', 'meetings']);
    });
  });

  describe('time filter', () => {
    it('generates SQL for morning filter', () => {
      const filters: SearchFilters = { time: 'morning' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.start_time < ?');
      expect(result.params).toContain('12:00');
    });

    it('generates SQL for afternoon filter', () => {
      const filters: SearchFilters = { time: 'afternoon' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.start_time >= ?');
      expect(result.where).toContain('m.start_time < ?');
      expect(result.params).toContain('12:00');
      expect(result.params).toContain('17:00');
    });

    it('generates SQL for evening filter', () => {
      const filters: SearchFilters = { time: 'evening' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.start_time >= ?');
      expect(result.params).toContain('17:00');
    });
  });

  describe('level filter', () => {
    it('generates SQL for level filter', () => {
      const filters: SearchFilters = { level: 400 };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 = ?');
      expect(result.params).toContain(400);
    });

    it('treats the 500 level filter as 500+', () => {
      const filters: SearchFilters = { level: 500 };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 >= ?');
      expect(result.params).toContain(500);
    });
  });

  describe('credits filter', () => {
    it('generates SQL for credits filter', () => {
      const filters: SearchFilters = { credits: 3 };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('c.credit_hours = ?');
      expect(result.params).toContain(3);
    });
  });

  describe('term filters', () => {
    it('generates SQL for year and term filters', () => {
      const filters: SearchFilters = { year: 2026, term: 'spring' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('c.year = ?');
      expect(result.where).toContain('c.term = ?');
      expect(result.params).toContain(2026);
      expect(result.params).toContain('spring');
    });
  });

  describe('CRN filter', () => {
    it('generates section-scoped SQL so exact CRN recall cannot bypass hard filters', () => {
      const filters: SearchFilters = { crn: '12345', year: 2026, term: 'fall' };
      const result = buildFilterClauses(filters);
      expect(result.joins).toContain('sections');
      expect(result.where).toEqual(
        expect.arrayContaining(['s.crn = ?', 'c.year = ?', 'c.term = ?']),
      );
      expect(result.params).toEqual(['12345', 2026, 'fall']);
    });
  });

  describe('online filter', () => {
    it('requires explicit online delivery evidence', () => {
      const filters: SearchFilters = { online: true };
      const result = buildFilterClauses(filters);
      expect(result.where).toHaveLength(1);
      expect(result.where[0]).toContain("m.type_name");
      expect(result.where[0]).toContain("LIKE '%online%'");
      expect(result.where[0]).not.toContain("m.building_name = ''");
    });

    it('requires physical-location evidence for in-person delivery', () => {
      const filters: SearchFilters = { online: false };
      const result = buildFilterClauses(filters);
      expect(result.where).toHaveLength(1);
      expect(result.where[0]).toContain("NOT (LOWER");
      expect(result.where[0]).toContain("NULLIF(TRIM");
    });
  });

  describe('status filter', () => {
    it('uses the canonical availability policy for search status filters', () => {
      const filters: SearchFilters = { status: 'available' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('s.status'))).toBe(true);
      expect(result.where.join(" ")).toContain("s.section_status_code");
      expect(result.where.join(" ")).toContain("s.status_code");
      expect(result.where.join(" ")).toContain("IN ('open', 'restricted')");
      expect(result.params).toEqual([]);
    });

    it('preserves raw, section-code, then generic-code precedence for conflicts', () => {
      const sql = buildFilterClauses({ status: 'closed' }).where.join(" ");
      const rawPosition = sql.indexOf("COALESCE(s.status, '')");
      const sectionCodePosition = sql.indexOf("COALESCE(s.section_status_code, '')");
      const genericCodePosition = sql.indexOf("COALESCE(s.status_code, '')");

      expect(rawPosition).toBeGreaterThanOrEqual(0);
      expect(sectionCodePosition).toBeGreaterThan(rawPosition);
      expect(genericCodePosition).toBeGreaterThan(sectionCodePosition);
      expect(sql).toContain("NULLIF(");
      expect(sql).not.toContain("section_status_code, ''))) = 'c' OR");
    });
  });

  describe('structured schedule filters', () => {
    it('filters to compressed sections and exact start-time bounds', () => {
      const result = buildFilterClauses({
        compressedTerm: true,
        startAfterMinutes: 14 * 60,
        startBeforeMinutes: 17 * 60,
      });

      expect(result.where).toContain(
        "s.part_of_term IS NOT NULL AND s.part_of_term != '' AND s.part_of_term != '1'",
      );
      expect(result.where).toContain("m.start_time >= ?");
      expect(result.where).toContain("m.start_time < ?");
      expect(result.params).toContain("14:00");
      expect(result.params).toContain("17:00");
    });
  });

  describe('instructor-difficulty filter', () => {
    it('generates score-only SQL for lower instructor difficulty', () => {
      const filters: SearchFilters = { instructorDifficulty: 'lower' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('quality_score'))).toBe(false);
      expect(result.where.some(w => w.includes('c.difficulty_score <= ?'))).toBe(true);
      expect(result.params).toContain(
        INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS.lower.maxScoreInclusive,
      );
    });

    it('generates score-only SQL for higher instructor difficulty', () => {
      const filters: SearchFilters = { instructorDifficulty: 'higher' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('quality_score'))).toBe(false);
      expect(result.where.some(w => w.includes('c.difficulty_score > ?'))).toBe(true);
      expect(result.params).toContain(
        INSTRUCTOR_DIFFICULTY_FILTER_THRESHOLDS.higher.minScoreExclusive,
      );
    });
  });

  describe('requirement filter', () => {
    it('generates SQL for any requirement codes', () => {
      const filters: SearchFilters = { requirement: requirementFilter('any', ['HUM', 'US']) };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('cg.category_id IN') && w.includes('SUBSTR(cg.attribute_code, 2)'))).toBe(true);
      expect(result.params.filter(param => param === 'HUM')).toHaveLength(2);
      expect(result.params.filter(param => param === 'US')).toHaveLength(2);
    });

    it('normalizes source-prefixed gen-ed attribute codes before matching', () => {
      const filters: SearchFilters = { requirement: requirementFilter('all', ['1WCC', '1QR1', 'US']) };
      const result = buildFilterClauses(filters);
      expect(result.where.join('\n')).toContain('SUBSTR(cg_all_0.attribute_code, 2)');
      expect(result.where.join('\n')).toContain('cg_all_0');
      expect(result.where.join('\n')).toContain('cg_all_1');
      expect(result.where.join('\n')).toContain('cg_all_2');
      expect(result.params.filter(param => param === 'WCC')).toHaveLength(2);
      expect(result.params.filter(param => param === 'QR1')).toHaveLength(2);
      expect(result.params.filter(param => param === 'US')).toHaveLength(2);
    });
  });

  describe('join deduplication', () => {
    it('deduplicates joins when multiple filters need same table', () => {
      const filters: SearchFilters = { days: 'MWF', time: 'morning', online: true };
      const result = buildFilterClauses(filters);
      expect(result.joins.filter(join => join === 'sections')).toHaveLength(1);
    });
  });

  describe('resolved instructor filters', () => {
    it('makes an unresolved explicit instructor filter impossible to match', () => {
      const result = buildFilterClauses({ instructor_ids: [] });

      expect(result.where).toContain('0');
      expect(result.joins).toEqual([]);
      expect(result.params).toEqual([]);
    });
  });

  describe('negation filters', () => {
    it('uses course-level anti-join semantics for negated time filters', () => {
      const filters: SearchFilters = { not: { time: ['morning'] } };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('NOT EXISTS') && w.includes('m2.start_time < ?'))).toBe(true);
      expect(result.params).toContain('12:00');
      expect(result.joins.some(j => j.includes('JOIN meetings m '))).toBe(false);
    });

    it('uses course-level anti-join semantics for negated day filters', () => {
      const filters: SearchFilters = { not: { days: ['friday'] } };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('NOT EXISTS') && w.includes('m2.days LIKE ?'))).toBe(true);
      expect(result.params).toContain('%F%');
    });

    it('excludes negated subjects without requiring a positive subject filter', () => {
      const filters: SearchFilters = { not: { subjects: ['MATH', 'STAT'] } };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('c.subject NOT IN (?,?)');
      expect(result.params).toEqual(['MATH', 'STAT']);
    });

    it('excludes negated gen-ed attributes through course_gened', () => {
      const filters: SearchFilters = { not: { requirementCodes: ['QR'] } };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('course_gened cg_neg'))).toBe(true);
      expect(result.params.filter(param => param === 'QR')).toHaveLength(2);
    });

    it('keeps workload keyword negations as exclusion predicates', () => {
      const filters: SearchFilters = { not: { keywords: ['lab'] } };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('NOT LIKE ?'))).toBe(true);
      expect(result.params).toContain('%lab%');
    });
  });
});

describe('buildFilteredCourseQuery', () => {
  it('pushes active scope into candidate retrieval', () => {
    const query = buildFilteredCourseQuery({}, 'active');

    expect(query.whereSql()).toContain("search_scope_term.status IN ('active', 'registrable')");
  });

  it('does not override an explicit historical term filter', () => {
    const query = buildFilteredCourseQuery({ year: 2025, term: 'fall' }, 'active');

    expect(query.whereSql()).not.toContain('search_scope_term');
    expect(query.whereSql()).toContain('c.year = ?');
    expect(query.whereSql()).toContain('c.term = ?');
  });
});

describe('TIME_RANGES', () => {
  it('has correct range for early', () => {
    expect(TIME_RANGES.early).toEqual({ end: '09:00' });
  });

  it('has correct range for morning', () => {
    expect(TIME_RANGES.morning).toEqual({ end: '12:00' });
  });

  it('has correct range for midday', () => {
    expect(TIME_RANGES.midday).toEqual({ start: '10:00', end: '14:00' });
  });

  it('has correct range for afternoon', () => {
    expect(TIME_RANGES.afternoon).toEqual({ start: '12:00', end: '17:00' });
  });

  it('has correct range for evening', () => {
    expect(TIME_RANGES.evening).toEqual({ start: '17:00' });
  });
});
