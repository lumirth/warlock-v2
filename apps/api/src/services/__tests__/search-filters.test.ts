import { describe, it, expect } from 'vitest';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { buildFilterClauses, requirementLaneSearch, TIME_RANGES, DIFFICULTY_THRESHOLDS } from '../search.js';
import type { SearchFilters, SearchPlan } from '@uiuc-course-search/query-types';

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
      const filters: SearchFilters = { difficulty: 'easy' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('quality_score'))).toBe(false);
      expect(result.where.some(w => w.includes('c.difficulty_score <= ?'))).toBe(true);
      expect(result.params).toContain(DIFFICULTY_THRESHOLDS.easy.max_difficulty);
    });

    it('generates workload-only SQL for difficulty=hard', () => {
      const filters: SearchFilters = { difficulty: 'hard' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('quality_score'))).toBe(false);
      expect(result.where.some(w => w.includes('c.difficulty_score >= ?'))).toBe(true);
      expect(result.params).toContain(DIFFICULTY_THRESHOLDS.hard.min_difficulty);
    });
  });

  describe('gened_any filter', () => {
    it('generates SQL for gened_any', () => {
      const filters: SearchFilters = { gened_any: ['HUM', 'US'] };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('cg.category_id IN') && w.includes('cg.attribute_code IN'))).toBe(true);
      expect(result.params.filter(param => param === 'HUM')).toHaveLength(2);
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
      filters: { subject: 'CS', difficulty: 'easy' },
      keywordQuery: '',
      semanticQuery: '',
      rescue: {
        queryTypes: ['requirement', 'subjective_vibe'],
        negativeTerms: [],
        topicTerms: [],
        expandedTerms: [],
        assumptions: [],
        warnings: [],
        retrievalLanes: ['requirement'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.74,
      },
    };

    await requirementLaneSearch(db, plan);

    expect(capturedSql).toContain('JOIN course_gened cg_requirement');
    expect(capturedSql).toContain('c.subject = ?');
  });
});
