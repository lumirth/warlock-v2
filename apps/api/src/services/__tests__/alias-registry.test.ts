import { describe, it, expect, beforeEach } from 'vitest';
import { AliasRegistry, createDefaultRegistry } from '../alias-registry.js';

describe('AliasRegistry', () => {
  let registry: AliasRegistry;

  beforeEach(() => {
    registry = createDefaultRegistry();
  });

  describe('time aliases', () => {
    it('matches "morning"', () => {
      const matches = registry.match('morning classes');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'time', canonical: 'morning' })
      );
    });

    it('matches "early morning" as early', () => {
      const matches = registry.match('early morning');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'time', canonical: 'early' })
      );
    });
  });

  describe('difficulty aliases', () => {
    it('matches "easy"', () => {
      const matches = registry.match('easy class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'easy' })
      );
    });

    it('matches "gpa booster" as easy', () => {
      const matches = registry.match('gpa booster');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'easy' })
      );
    });

    it('matches "hard"', () => {
      const matches = registry.match('hard class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'hard' })
      );
    });
  });

  describe('status aliases', () => {
    it('matches "open"', () => {
      const matches = registry.match('open sections');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'status', canonical: 'open' })
      );
    });

    it('matches "has seats" as open', () => {
      const matches = registry.match('has seats');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'status', canonical: 'open' })
      );
    });
  });

  describe('delivery aliases', () => {
    it('matches "online"', () => {
      const matches = registry.match('online class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'delivery', canonical: 'true' })
      );
    });

    it('matches "in person" as not online', () => {
      const matches = registry.match('in person');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'delivery', canonical: 'false' })
      );
    });
  });

  describe('subject aliases', () => {
    it.each([
      ['philosophy', 'PHIL'],
      ['political science', 'PS'],
      ['information sciences', 'IS'],
      ['art history', 'ARTH'],
      ['electrical computer engineering', 'ECE'],
      ['psych', 'PSYC'],
      ['stats', 'STAT'],
    ])('matches "%s" as %s', (query, subject) => {
      const matches = registry.match(query);
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'subject', canonical: subject })
      );
    });

    it('does not match unsafe lowercase subject codes as aliases', () => {
      const matches = registry.match('this is a test for me');
      expect(matches).not.toContainEqual(
        expect.objectContaining({ kind: 'subject', canonical: 'IS' })
      );
      expect(matches).not.toContainEqual(
        expect.objectContaining({ kind: 'subject', canonical: 'ME' })
      );
    });

    it.each([
      ['philosphy', 'PHIL'],
      ['philospohy', 'PHIL'],
      ['computr science', 'CS'],
      ['politcal science', 'PS'],
      ['informaton sciences', 'IS'],
      ['art histry', 'ARTH'],
      ['psycology', 'PSYC'],
    ])('fuzzy-matches typo "%s" as %s', (query, subject) => {
      const matches = registry.match(query);
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'subject', canonical: subject })
      );
    });

    it('keeps fuzzy subject matching away from short aliases and common prose', () => {
      const matches = registry.match('this is a test for me about art and law');
      expect(matches.filter(match => match.kind === 'subject')).toHaveLength(0);
    });
  });

  describe('days aliases', () => {
    it('matches "tuesday thursday" as TR', () => {
      const matches = registry.match('tuesday thursday');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'days', canonical: 'TR' })
      );
    });

    it('matches "monday wednesday friday" as MWF', () => {
      const matches = registry.match('monday wednesday friday');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'days', canonical: 'MWF' })
      );
    });
  });

  describe('gened aliases with cue rule', () => {
    it('matches common gened phrases like "humanities" without cue', () => {
      const matches = registry.match('humanities');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });

    it('matches "humanities gen ed" with cue', () => {
      const matches = registry.match('humanities gen ed');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });

    it('matches "humanities requirement" with cue', () => {
      const matches = registry.match('humanities requirement');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });

    it('matches gened code directly without cue', () => {
      const matches = registry.match('HUM');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });

    it('matches the longer CS GenEd phrase before the shorter CS subject code', () => {
      const matches = registry.match('easy cs gened');

      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'CS', raw: 'cs gened' })
      );
      expect(matches).not.toContainEqual(
        expect.objectContaining({ kind: 'subject', canonical: 'CS' })
      );
    });

    it('handles PS as Physical Sciences when explicit GenEd language is present', () => {
      const matches = registry.match('easy ps gened');

      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'PS', raw: 'ps gened' })
      );
      expect(matches).not.toContainEqual(
        expect.objectContaining({ kind: 'subject', canonical: 'PS' })
      );
    });
  });

  describe('longest match first', () => {
    it('matches "early morning" before "morning"', () => {
      const matches = registry.match('early morning');
      const timeMatches = matches.filter(m => m.kind === 'time');
      expect(timeMatches).toHaveLength(1);
      expect(timeMatches[0].canonical).toBe('early');
    });

    it('matches "gpa booster" before "gpa"', () => {
      const matches = registry.match('gpa booster class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'easy' })
      );
    });
  });
});
