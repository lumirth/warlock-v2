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
      const result = extractQueryLite('easy CS 225 morning');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'course_code',
          metadata: { subject: 'CS', number: '225' }
        })
      );
      expect(result.residual).toContain('easy');
      expect(result.residual).toContain('morning');
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
      expect(result.residual).toBe('easy');
    });

    it('extracts "by instructor" pattern', () => {
      const result = extractQueryLite('cs 225 by fagen');
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'instructor', value: 'fagen' }));
    });
  });
});
