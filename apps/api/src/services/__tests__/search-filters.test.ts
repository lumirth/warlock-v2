import { describe, it, expect } from 'vitest';
import { buildFilterClauses, TIME_RANGES, DIFFICULTY_THRESHOLDS } from '../search.js';
import type { SearchFilters } from '@uiuc-course-search/query-types';

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
    it('generates SQL for difficulty=easy', () => {
      const filters: SearchFilters = { difficulty: 'easy' };
      const result = buildFilterClauses(filters);
      // Legacy GPA check
      if ('min_gpa' in DIFFICULTY_THRESHOLDS.easy) {
        expect(result.where).toContain('c.avg_gpa >= ?');
        expect(result.params).toContain((DIFFICULTY_THRESHOLDS.easy as any).min_gpa);
      }
      // New Quality/Difficulty check
      if ('min_quality' in DIFFICULTY_THRESHOLDS.easy) {
        expect(result.where.some(w => w.includes('c.quality_score >= ?'))).toBe(true);
        expect(result.params).toContain(DIFFICULTY_THRESHOLDS.easy.min_quality);
      }
      if ('max_difficulty' in DIFFICULTY_THRESHOLDS.easy) {
        expect(result.where.some(w => w.includes('c.difficulty_score <= ?'))).toBe(true);
        expect(result.params).toContain(DIFFICULTY_THRESHOLDS.easy.max_difficulty);
      }
    });

    it('generates SQL for difficulty=hard', () => {
      const filters: SearchFilters = { difficulty: 'hard' };
      const result = buildFilterClauses(filters);
      // Legacy GPA check
      if ('max_gpa' in DIFFICULTY_THRESHOLDS.hard) {
        expect(result.where).toContain('c.avg_gpa <= ?');
        expect(result.params).toContain((DIFFICULTY_THRESHOLDS.hard as any).max_gpa);
      }
      // New Quality/Difficulty check
      if ('max_quality' in DIFFICULTY_THRESHOLDS.hard) {
        expect(result.where.some(w => w.includes('c.quality_score <= ?'))).toBe(true);
        expect(result.params).toContain(DIFFICULTY_THRESHOLDS.hard.max_quality);
      }
      if ('min_difficulty' in DIFFICULTY_THRESHOLDS.hard) {
        expect(result.where.some(w => w.includes('c.difficulty_score >= ?'))).toBe(true);
        expect(result.params).toContain(DIFFICULTY_THRESHOLDS.hard.min_difficulty);
      }
    });
  });

  describe('gened_any filter', () => {
    it('generates SQL for gened_any', () => {
      const filters: SearchFilters = { gened_any: ['HUM', 'US'] };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('cg.category_id IN'))).toBe(true);
      expect(result.params).toContain('HUM');
      expect(result.params).toContain('US');
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
