import { describe, it, expect } from 'vitest';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { requirementFilter } from '@uiuc-course-search/query-types';
import { buildFilterClauses, requirementLaneSearch, TIME_RANGES } from '../search.js';
import { WORKLOAD_FILTER_THRESHOLDS } from '../ranking/ranking-policy.js';
import type { SearchFilters, SearchPlan } from '../search-planner-types.js';

describe('buildFilterClauses', () => {
  describe('days filter', () => {
    it('generates SQL for days filter', () => {
      const filters: SearchFilters = { days: 'MWF' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.days = ?');
      expect(result.params).toContain('MWF');
      expect(result.joins).toContain('JOIN sections s ON s.course_id = c.id');
      expect(result.joins).toContain('JOIN meetings m ON m.section_id = s.id');
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

  describe('online filter', () => {
    it('generates SQL for online=true', () => {
      const filters: SearchFilters = { online: true };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('online') || w.includes("building_name = ''"))).toBe(true);
    });

    it('generates SQL for online=false (in-person)', () => {
      const filters: SearchFilters = { online: false };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes("building_name != ''"))).toBe(true);
    });
  });

  describe('status filter', () => {
    it('generates SQL for status=open', () => {
      const filters: SearchFilters = { status: 'open' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('s.status'))).toBe(true);
    });
  });

  describe('difficulty filter', () => {
    it('generates workload-only SQL for difficulty=easy', () => {
      const filters: SearchFilters = { workload: 'easy' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('quality_score'))).toBe(false);
      expect(result.where.some(w => w.includes('c.difficulty_score <= ?'))).toBe(true);
      expect(result.params).toContain(WORKLOAD_FILTER_THRESHOLDS.easy.maxScoreInclusive);
    });

    it('generates workload-only SQL for difficulty=hard', () => {
      const filters: SearchFilters = { workload: 'hard' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('quality_score'))).toBe(false);
      expect(result.where.some(w => w.includes('c.difficulty_score > ?'))).toBe(true);
      expect(result.params).toContain(WORKLOAD_FILTER_THRESHOLDS.hard.minScoreExclusive);
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
      const sectionJoins = result.joins.filter(j => j.includes('sections s'));
      expect(sectionJoins.length).toBe(1);
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

describe('requirementLaneSearch', () => {
  it('requires a GenEd mapping for generic requirement intent instead of relabeling other filters', async () => {
    let capturedSql = '';
    const db = {
      prepare(sql: string): D1PreparedStatement {
        capturedSql = sql;
        return {
          bind: () => ({
            all: async () => ({ results: [] }),
          }),
        } as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
    const plan: SearchPlan = {
      filters: { subject: 'CS', workload: 'easy' },
      keywordQuery: '',
      semanticQuery: '',
      rescue: {
        queryTypes: ['requirement', 'subjective_vibe'],
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
    };

    const rows = await requirementLaneSearch(db, plan);

    expect(rows).toEqual([]);
    expect(capturedSql).toBe('');
  });
});
