import { describe, it, expect } from 'vitest';
import { extractQueryLite } from './index.js';

describe('extractQueryLite', () => {
  describe('course code extraction', () => {
    it('extracts "CS 225" as course_code', () => {
      const result = extractQueryLite('CS 225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          value: 'CS 225',
          metadata: { subject: 'CS', number: '225' }
        })
      );
      expect(result.residual.trim()).toBe('');
    });

    it('extracts "cs225" (no space, lowercase)', () => {
      const result = extractQueryLite('cs225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
    });

    it('extracts "CS225" (no space)', () => {
      const result = extractQueryLite('CS225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
    });

    it('extracts course code with surrounding text', () => {
      const result = extractQueryLite('fun CS 225 intro');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
      expect(result.residual).toContain('fun');
      expect(result.residual).toContain('intro');
    });

    it('extracts 4-letter subject codes', () => {
      const result = extractQueryLite('MATH 241');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'MATH', number: '241' }
        })
      );
    });

    it('extracts 2-letter subject codes', () => {
      const result = extractQueryLite('UP 101');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'UP', number: '101' }
        })
      );
    });
  });

  describe('CRN extraction', () => {
    it('extracts 5-digit CRN', () => {
      const result = extractQueryLite('12345');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '12345'
        })
      );
    });

    it('extracts CRN with prefix', () => {
      const result = extractQueryLite('CRN 67890');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '67890'
        })
      );
    });
  });

  describe('existing instructor extraction', () => {
    it('extracts instructor with "with" keyword', () => {
      const result = extractQueryLite('CS 225 with fagen');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'instructor', value: 'fagen' })
      );
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'course_code' })
      );
    });
  });

  describe('gened extraction (existing)', () => {
    it('extracts gened patterns', () => {
      const result = extractQueryLite('easy gened humanities');
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'gened', value: 'humanities' }));
    });

    it('extracts "by instructor" pattern', () => {
      const result = extractQueryLite('cs 225 by fagen');
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'instructor', value: 'fagen' }));
    });
  });

  describe('difficulty extraction', () => {
    it('extracts "easy" keyword', () => {
      const result = extractQueryLite('easy gen ed');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'difficulty', value: 'easy' })
      );
    });

    it('extracts "hard" keyword', () => {
      const result = extractQueryLite('hard CS class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'difficulty', value: 'hard' })
      );
    });

    it('extracts "simple" as easy', () => {
      const result = extractQueryLite('simple science class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'difficulty', value: 'easy' })
      );
    });

    it('extracts "challenging" as hard', () => {
      const result = extractQueryLite('challenging math');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'difficulty', value: 'hard' })
      );
    });
  });

  describe('time extraction', () => {
    it('extracts "morning"', () => {
      const result = extractQueryLite('morning classes');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'time', value: 'morning' })
      );
    });

    it('extracts "afternoon"', () => {
      const result = extractQueryLite('afternoon lecture');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'time', value: 'afternoon' })
      );
    });

    it('extracts "evening"', () => {
      const result = extractQueryLite('evening class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'time', value: 'evening' })
      );
    });
  });

  describe('days extraction', () => {
    it('extracts "MWF"', () => {
      const result = extractQueryLite('MWF classes');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'days', value: 'MWF' })
      );
    });

    it('extracts "TR"', () => {
      const result = extractQueryLite('TR lecture');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'days', value: 'TR' })
      );
    });

    it('extracts "tuesday thursday"', () => {
      const result = extractQueryLite('tuesday thursday');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'days', value: 'TR' })
      );
    });
  });

  describe('online extraction', () => {
    it('extracts "online"', () => {
      const result = extractQueryLite('online classes');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'online', value: 'true' })
      );
    });

    it('extracts "remote"', () => {
      const result = extractQueryLite('remote lecture');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'online', value: 'true' })
      );
    });

    it('extracts "in person"', () => {
      const result = extractQueryLite('in person class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'online', value: 'false' })
      );
    });
  });

  describe('status extraction', () => {
    it('extracts "open sections"', () => {
      const result = extractQueryLite('open sections');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'status', value: 'open' })
      );
    });

    it('extracts "available classes"', () => {
      const result = extractQueryLite('available classes');
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'status', value: 'open' })
      );
    });
  });
});
