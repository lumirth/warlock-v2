import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';
import type { Hint } from '../search-planner-types.js';

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
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'workload', value: 'easy' }));
    });

    describe('intro as boost', () => {
      it('extracts "intro" as levelBoost, not level', () => {
        const result = extract('intro to compilers');

        // Should NOT have a level hint
        const levelHints = result.hints.filter(h => h.type === 'level');
        expect(levelHints).toHaveLength(0);

        // Should have a levelBoost hint
        const boostHints = result.hints.filter(h => h.type === 'levelBoost');
        expect(boostHints).toHaveLength(1);
        expect(boostHints[0].value).toBe(100);

        // "intro" should REMAIN in residual
        expect(result.residual).toContain('intro');
      });

      it('explicit level overrides intro boost', () => {
        const result = extract('intro to compilers 400 level');

        // Should have level=400 from explicit "400 level"
        const levelHints = result.hints.filter(h => h.type === 'level');
        expect(levelHints).toHaveLength(1);
        expect(levelHints[0].value).toBe(400);
      });

      it('extracts "graduate" as level and masks it', () => {
        const result = extract('graduate algorithms');
        // Should have level=500
        expect(result.hints).toContainEqual(expect.objectContaining({ type: 'level', value: 500 }));
        // "graduate" should be REMOVED from residual
        expect(result.residual).not.toContain('graduate');
        expect(result.residual).toContain('algorithms');
      });
    });
  });

  describe('order independence', () => {
    it('extracts "CS 400 level" and "400 level CS" identically', () => {
      const res1 = extract('CS 400 level');
      const res2 = extract('400 level CS');

      const getSubject = (h: Hint[]) => h.find(x => x.type === 'subject')?.value;
      const getLevel = (h: Hint[]) => h.find(x => x.type === 'level')?.value;

      expect(getSubject(res1.hints)).toBe('CS');
      expect(getLevel(res1.hints)).toBe(400);
      expect(getSubject(res2.hints)).toBe('CS');
      expect(getLevel(res2.hints)).toBe(400);
    });

    it('extracts "3 credit CS course" and "CS course 3 credit" identically', () => {
      const res1 = extract('3 credit CS course');
      const res2 = extract('CS course 3 credit');

      const getSubject = (h: Hint[]) => h.find(x => x.type === 'subject')?.value;
      const getCredits = (h: Hint[]) => h.find(x => x.type === 'credits')?.value;

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

    it('extracts lowercase professor-name searches', () => {
      const result = extract('professor fagen');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'fagen',
        })
      );
      expect(result.residual).toBe('');
    });

    it('extracts shorthand and taught-by instructor phrases', () => {
      const prof = extract('prof fagen-ulmschneider');
      const taughtBy = extract('taught by wade fagen');

      expect(prof.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'fagen-ulmschneider',
        })
      );
      expect(taughtBy.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'wade fagen',
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

    it('does not treat generic by/with phrases as instructor filters', () => {
      expect(extract('sort by difficulty').hints.find(h => h.type === 'instructor')).toBeUndefined();
      expect(extract('with no friday').hints.find(h => h.type === 'instructor')).toBeUndefined();
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

    it('extracts positive no/not aliases before generic negation masking', () => {
      expect(extract('not hard').hints).toContainEqual(
        expect.objectContaining({ type: 'workload', value: 'easy' })
      );
      expect(extract('not full').hints).toContainEqual(
        expect.objectContaining({ type: 'status', value: 'open' })
      );
      expect(extract('no waitlist').hints).toContainEqual(
        expect.objectContaining({ type: 'status', value: 'open' })
      );
    });

    it('extracts workload negations instead of searching them as positive text', () => {
      const result = extract('no exams');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'negation',
          value: expect.objectContaining({ target: 'workload', value: 'exams' }),
        })
      );
      expect(result.residual).toBe('');
    });

    it('extracts not online as an in-person constraint', () => {
      const result = extract('not online');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'online',
          value: false,
        })
      );
      expect(result.residual).toBe('');
    });

    it('does not turn negated subjects into positive subject hints', () => {
      const result = extract('easy science but no math');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'negation',
          value: expect.objectContaining({ target: 'subject', value: 'MATH' }),
        })
      );
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'requirement', value: 'NAT' })
      );
      expect(result.hints).not.toContainEqual(
        expect.objectContaining({ type: 'subject', value: 'MATH' })
      );
    });

    it('keeps connector text after a negation available for requirement parsing', () => {
      const result = extract('not math but counts for science');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'negation',
          value: expect.objectContaining({ target: 'subject', value: 'MATH' }),
        })
      );
      expect(result.hints).toContainEqual(
        expect.objectContaining({ type: 'requirement', value: 'NAT' })
      );
    });

    it('recognizes contextual gen-ed language without stealing protected science subjects', () => {
      expect(extract('social science class').hints).toContainEqual(
        expect.objectContaining({ type: 'requirement', value: 'SBS' })
      );
      expect(extract('diversity').hints).toContainEqual(
        expect.objectContaining({ type: 'requirement', value: 'CS' })
      );
      expect(extract('computer science class').hints).toContainEqual(
        expect.objectContaining({ type: 'subject', value: 'CS' })
      );
      expect(extract('computer science class').hints).not.toContainEqual(
        expect.objectContaining({ type: 'requirement', value: 'NAT' })
      );
    });

    it('normalizes maintained student shorthand into subject plus topic language', () => {
      const orgo = extract('how hard is orgo');
      expect(orgo.hints).toContainEqual(
        expect.objectContaining({ type: 'subject', value: 'CHEM' })
      );
      expect(orgo.hints).not.toContainEqual(
        expect.objectContaining({ type: 'workload', value: 'hard' })
      );
      expect(orgo.residual).toContain('organic');

      const diffeq = extract('diffeq');
      expect(diffeq.hints).toContainEqual(
        expect.objectContaining({ type: 'subject', value: 'MATH' })
      );
      expect(diffeq.residual).toContain('differential');
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

    it('preserves meaningful words inside a title-like query', () => {
      const result = extract('World Class Manufacturing');
      expect(result.residual).toBe('World Class Manufacturing');
    });
  });

  describe('term extraction', () => {
    it('extracts "spring 2026"', () => {
      const result = extract('CS spring 2026');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'term',
          value: { term: 'spring', year: 2026 }
        })
      );
    });

    it('extracts "fall 2025"', () => {
      const result = extract('fall 2025 MATH');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'term',
          value: { term: 'fall', year: 2025 }
        })
      );
    });

    it('extracts "summer 2026"', () => {
      const result = extract('summer 2026 online');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'term',
          value: { term: 'summer', year: 2026 }
        })
      );
    });

    it('removes term from residual', () => {
      const result = extract('CS spring 2026');
      expect(result.residual).not.toContain('spring');
      expect(result.residual).not.toContain('2026');
    });
  });
});
