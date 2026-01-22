import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';

describe('extract', () => {
  describe('phase 1: regex patterns', () => {
    it('extracts course code "CS 225"', () => {
      const result = extract('CS 225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: { subject: 'CS', number: '225' },
          metadata: expect.objectContaining({ source: 'regex' }),
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
          metadata: expect.objectContaining({ source: 'regex' }),
        })
      );
    });

    it('extracts CRN with prefix "CRN 67890"', () => {
      const result = extract('CRN 67890');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '67890',
        })
      );
    });

    it('extracts credits "3 credits"', () => {
      const result = extract('3 credits');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'credits',
          value: 3,
        })
      );
    });

    it('extracts credits "4 credit hours"', () => {
      const result = extract('4 credit hours');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'credits',
          value: 4,
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

    it('extracts level "intro" as 100', () => {
      const result = extract('intro class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 100,
        })
      );
    });

    it('extracts level "advanced" as 400', () => {
      const result = extract('advanced course');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 400,
        })
      );
    });

    it('extracts level "graduate" as 500', () => {
      const result = extract('graduate seminar');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 500,
        })
      );
    });

    it('extracts days "MWF"', () => {
      const result = extract('MWF morning');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'days',
          value: 'MWF',
        })
      );
    });

    it('extracts days "TR"', () => {
      const result = extract('TR afternoon');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'days',
          value: 'TR',
        })
      );
    });

    it('correctly parses "CS 400 level" as Level 400, not Course Code CS 400', () => {
      const result = extract('CS 400 level');

      // Should NOT contain courseCode CS 400
      expect(result.hints).not.toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: { subject: 'CS', number: '400' }
        })
      );

      // Should contain Level 400
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 400
        })
      );

      // Residual should contain CS (which will be handled by query expansion)
      expect(result.residual).toContain('CS');
    });
  });

  describe('phase 2: alias matching', () => {
    it('extracts difficulty "easy"', () => {
      const result = extract('easy class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'difficulty',
          value: 'easy',
          metadata: expect.objectContaining({ source: 'alias' }),
        })
      );
    });

    it('extracts difficulty "gpa booster" as easy', () => {
      const result = extract('gpa booster');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'difficulty',
          value: 'easy',
        })
      );
    });

    it('extracts status "open"', () => {
      const result = extract('open sections');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'status',
          value: 'open',
        })
      );
    });

    it('extracts online "true" for "online"', () => {
      const result = extract('online class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'online',
          value: true,
        })
      );
    });

    it('extracts online "false" for "in person"', () => {
      const result = extract('in person class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'online',
          value: false,
        })
      );
    });

    it('extracts time "morning"', () => {
      const result = extract('morning class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'time',
          value: 'morning',
        })
      );
    });

    it('extracts gened with cue "humanities gen ed"', () => {
      const result = extract('humanities gen ed');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'gened',
          value: 'HUM',
        })
      );
    });

    it('does NOT extract gened without cue "humanities"', () => {
      const result = extract('humanities');
      const genedHints = result.hints.filter(h => h.type === 'gened');
      expect(genedHints).toHaveLength(0);
      expect(result.residual).toContain('humanities');
    });
  });

  describe('phase 3: NLP (instructor)', () => {
    it('extracts instructor with "with Fagen"', () => {
      const result = extract('CS 225 with Fagen');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Fagen',
          metadata: expect.objectContaining({ source: 'nlp' }),
        })
      );
    });

    it('extracts instructor with "by Fleck"', () => {
      const result = extract('data structures by Fleck');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Fleck',
        })
      );
    });

    it('extracts instructor with "professor Smith"', () => {
      const result = extract('professor Smith');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Smith',
        })
      );
    });
  });

  describe('residual handling', () => {
    it('removes extracted hints from residual', () => {
      const result = extract('CS 225 with Fagen morning');
      expect(result.residual).not.toContain('CS 225');
      expect(result.residual).not.toContain('Fagen');
      expect(result.residual).not.toContain('morning');
    });

    it('keeps unmatched text in residual', () => {
      const result = extract('data structures algorithms');
      expect(result.residual).toContain('data');
      expect(result.residual).toContain('structures');
      expect(result.residual).toContain('algorithms');
    });
  });

  describe('combined extraction', () => {
    it('extracts multiple hints from complex query', () => {
      const result = extract('easy CS 225 MWF morning with Fagen');
      expect(result.hints.length).toBeGreaterThanOrEqual(4);
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'difficulty' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'courseCode' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'days' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'instructor' }));
    });
  });
});
