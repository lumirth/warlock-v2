import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';

describe('extract', () => {
  describe('phase 1: entities', () => {
    it('extracts course code "CS 225"', () => {
      const result = extract('CS 225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: { subject: 'CS', number: '225' },
        })
      );
    });

    it('extracts course code without space "cs225"', () => {
      const result = extract('cs225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: expect.objectContaining({ subject: 'CS', number: '225' }),
        })
      );
    });

    it('extracts CRN "12345"', () => {
      const result = extract('12345');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '12345',
        })
      );
    });

    it('extracts standalone subject "MATH"', () => {
      const result = extract('MATH course');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'subject',
          value: 'MATH',
        })
      );
    });

    it('extracts standalone number "225"', () => {
      const result = extract('225 course');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: { subject: '', number: '225' },
        })
      );
    });

    it('handles duplicate entities "CS 225 vs CS 440"', () => {
      const result = extract('CS 225 vs CS 440');
      const courseCodes = result.hints.filter(h => h.type === 'courseCode');
      expect(courseCodes).toHaveLength(2);
      expect(courseCodes).toContainEqual(expect.objectContaining({ value: { subject: 'CS', number: '225' } }));
      expect(courseCodes).toContainEqual(expect.objectContaining({ value: { subject: 'CS', number: '440' } }));
      expect(result.residual).toBe('vs');
    });
  });

  describe('phase 2: attributes', () => {
    it('extracts credits "3 credits"', () => {
      const result = extract('3 credits');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'credits',
          value: 3,
        })
      );
    });

    it('extracts level "400 level"', () => {
      const result = extract('400 level');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 400,
        })
      );
    });

    it('extracts aliases like "MWF" and "morning"', () => {
      const result = extract('MWF morning');
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'days', value: 'MWF' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'time', value: 'morning' }));
    });

    it('extracts difficulty "easy"', () => {
      const result = extract('easy class');
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'difficulty', value: 'easy' }));
    });
  });

  describe('order independence', () => {
    it('extracts "CS 400 level" and "400 level CS" identically', () => {
      const res1 = extract('CS 400 level');
      const res2 = extract('400 level CS');

      const getSubject = (h: any[]) => h.find(x => x.type === 'subject')?.value;
      const getLevel = (h: any[]) => h.find(x => x.type === 'level')?.value;

      expect(getSubject(res1.hints)).toBe('CS');
      expect(getLevel(res1.hints)).toBe(400);
      expect(getSubject(res2.hints)).toBe('CS');
      expect(getLevel(res2.hints)).toBe(400);
    });

    it('extracts "3 credit CS course" and "CS course 3 credit" identically', () => {
      const res1 = extract('3 credit CS course');
      const res2 = extract('CS course 3 credit');

      const getSubject = (h: any[]) => h.find(x => x.type === 'subject')?.value;
      const getCredits = (h: any[]) => h.find(x => x.type === 'credits')?.value;

      expect(getSubject(res1.hints)).toBe('CS');
      expect(getCredits(res1.hints)).toBe(3);
      expect(getSubject(res2.hints)).toBe('CS');
      expect(getCredits(res2.hints)).toBe(3);
    });
  });

  describe('phase 3: NLP & Negations', () => {
    it('extracts instructor "with Fagen"', () => {
      const result = extract('CS 225 with Fagen');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Fagen',
        })
      );
    });

    it('extracts instructor with special characters "Prof O\'Brien"', () => {
      const result = extract('Prof O\'Brien');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'O\'Brien',
        })
      );
    });

    it('extracts instructor with hyphen "with Liu-Prasad"', () => {
      const result = extract('with Liu-Prasad');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Liu-Prasad',
        })
      );
    });

    it('extracts negations "no morning"', () => {
      const result = extract('no morning');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'negation',
          value: expect.objectContaining({ target: 'time', value: 'morning' }),
        })
      );
    });
    
    it('does not extract positive hint when negated', () => {
      const result = extract('no morning');
      const timeHints = result.hints.filter(h => h.type === 'time');
      expect(timeHints).toHaveLength(0);
    });
  });

  describe('residual handling', () => {
    it('removes extracted hints from residual', () => {
      const result = extract('CS 225 with Fagen easy');
      expect(result.residual).not.toContain('CS 225');
      expect(result.residual).not.toContain('Fagen');
      expect(result.residual).not.toContain('easy');
    });

    it('keeps unmatched text in residual', () => {
      const result = extract('interesting course about algorithms');
      expect(result.residual).toContain('interesting');
      expect(result.residual).toContain('algorithms');
    });

    it('cleans up whitespace in residual', () => {
      const result = extract('  data   structures  ');
      expect(result.residual).toBe('data structures');
    });
  });

  describe('stop-phrase removal', () => {
    it('removes "gen ed" from residual', () => {
      const result = extract('easy humanities gen ed');
      expect(result.residual).not.toContain('gen ed');
      expect(result.residual.trim()).toBe('');
    });

    it('removes "sections" from residual', () => {
      const result = extract('open sections');
      expect(result.residual).not.toContain('sections');
    });

    it('removes "courses" from residual', () => {
      const result = extract('online courses');
      expect(result.residual).not.toContain('courses');
    });

    it('removes "classes" from residual', () => {
      const result = extract('morning classes');
      expect(result.residual).not.toContain('classes');
    });

    it('removes "booster" from residual', () => {
      const result = extract('gpa booster');
      expect(result.residual).not.toContain('booster');
    });

    it('removes "only" from residual', () => {
      const result = extract('online only');
      expect(result.residual).not.toContain('only');
    });

    it('removes stop words even from valid titles (intended side effect)', () => {
      // "Class" is a stop word, so "World Class Manufacturing" becomes "World Manufacturing"
      const result = extract('World Class Manufacturing');
      expect(result.residual).not.toContain('Class');
      expect(result.residual).toContain('World');
      expect(result.residual).toContain('Manufacturing');
    });
  });
});
