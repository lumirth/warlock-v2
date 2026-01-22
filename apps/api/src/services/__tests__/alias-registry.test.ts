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
