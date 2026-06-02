import { describe, expect, it } from 'vitest';
import type { Hint, SearchPlan } from '@uiuc-course-search/query-types';
import { buildSearchUiPlan } from '../search-ui.js';

describe('buildSearchUiPlan', () => {
  it('turns extraction hints and residual text into public chips', () => {
    const hints: Hint[] = [
      {
        type: 'courseCode',
        value: { subject: 'CS', number: '225' },
        metadata: { source: 'regex', confidence: 0.95, raw: 'CS 225' },
      },
      {
        type: 'instructor',
        value: 'fagen',
        metadata: { source: 'nlp', confidence: 0.8, raw: 'professor fagen' },
      },
      {
        type: 'difficulty',
        value: 'hard',
        metadata: { source: 'alias', confidence: 0.9, raw: 'hard' },
      },
    ];

    const plan = buildSearchUiPlan(hints, {
      filters: {
        subject: 'CS',
        number: '225',
        difficulty: 'hard',
        instructor_ids: [1],
      },
      keywordQuery: 'systems',
      semanticQuery: 'systems',
    }, 'systems');

    expect(plan.chips.map(chip => chip.label)).toEqual([
      'Course CS 225',
      'Instructor fagen',
      'Hard workload',
      'Topic: systems',
    ]);
    expect(plan.chips[0].queryPatch?.removeText).toBe('CS 225');
    expect(plan.advanced).toMatchObject({
      subject: 'CS',
      number: '225',
      instructor: 'fagen',
      difficulty: 'hard',
    });
  });

  it('exposes ambiguity alternatives as clickable query actions', () => {
    const plan: SearchPlan = {
      filters: { subject: 'CS' },
      keywordQuery: '',
      semanticQuery: '',
      ambiguities: [{
        term: 'CS',
        chosen: { type: 'subject', value: 'CS', label: 'Computer Science' },
        alternatives: [{ type: 'gened', value: 'CS', label: 'Cultural Studies' }],
      }],
    };

    expect(buildSearchUiPlan([], plan, '').ambiguityActions).toEqual([{
      id: '0-0-gened-CS',
      term: 'CS',
      label: 'Cultural Studies',
      filter: { gened_code: 'CS' },
      queryPatch: { replaceQuery: 'gened:CS' },
    }]);
  });

  it('does not show restored topic words inside instructor chips', () => {
    const plan = buildSearchUiPlan([{
      type: 'instructor',
      value: 'fagen algorithms',
      metadata: { source: 'nlp', confidence: 0.8, raw: 'professor fagen algorithms' },
    }], {
      filters: { instructor_ids: [3365] },
      keywordQuery: 'algorithms',
      semanticQuery: 'algorithms',
    }, 'algorithms');

    expect(plan.chips.map(chip => chip.label)).toEqual([
      'Instructor fagen',
      'Topic: algorithms',
    ]);
    expect(plan.chips[0].value).toBe('fagen');
    expect(plan.chips[0].queryPatch?.removeText).toBe('professor fagen');
    expect(plan.advanced.instructor).toBe('fagen');
  });

  it('labels introductory level boosts in student-facing language', () => {
    const plan = buildSearchUiPlan([{
      type: 'levelBoost',
      value: 100,
      metadata: { source: 'regex', confidence: 0.5, raw: 'intro' },
    }], {
      filters: { subject: 'CS' },
      keywordQuery: '',
      semanticQuery: '',
      intents: ['introductory_gateway'],
    }, '');

    expect(plan.chips.map(chip => chip.label)).toEqual(['Introductory courses']);
  });
});
