import { describe, expect, it } from 'vitest';
import { requirementFilter, singleRequirementFilter } from '@uiuc-course-search/query-types';
import type { Hint, SearchPlan } from '@uiuc-course-search/query-types/search-planner';
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
      filter: { gened: 'CS' },
      queryPatch: { replaceQuery: 'gened:CS' },
    }]);
  });

  it('renders subject shorthand as a GenEd chip when the resolver chose the requirement meaning', () => {
    const hints: Hint[] = [
      {
        type: 'difficulty',
        value: 'easy',
        metadata: { source: 'alias', confidence: 0.9, raw: 'easy' },
      },
      {
        type: 'subject',
        value: 'CS',
        metadata: { source: 'regex', confidence: 0.6, raw: 'cs' },
      },
    ];
    const plan: SearchPlan = {
      filters: { difficulty: 'easy', requirement: singleRequirementFilter('CS') },
      keywordQuery: '',
      semanticQuery: '',
      ambiguities: [{
        term: 'cs',
        chosen: { type: 'gened', value: 'CS', label: 'Cultural Studies' },
        alternatives: [{ type: 'subject', value: 'CS', label: 'Computer Science' }],
      }],
    };

    const ui = buildSearchUiPlan(hints, plan, '');

    expect(ui.chips.map(chip => chip.label)).toEqual(['Easy workload', 'GenEd CS']);
    expect(ui.chips[1].filter).toEqual({ gened: 'CS' });
    expect(ui.advanced.gened).toBe('CS');
    expect(ui.advanced.subject).toBeUndefined();
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

  it('hides rescue assumptions already represented by concrete filter chips', () => {
    const plan = buildSearchUiPlan([{
      type: 'online',
      value: true,
      metadata: { source: 'alias', confidence: 0.9, raw: 'online' },
    }], {
      filters: { online: true },
      keywordQuery: '',
      semanticQuery: '',
      rescue: {
        queryTypes: ['schedule', 'subjective_vibe', 'avoidance'],
        negativeTerms: ['writing_heavy'],
        topicTerms: [],
        expandedTerms: [],
        assumptions: [
          { kind: 'schedule_fit', label: 'Schedule or delivery fit matters', confidence: 0.78, source: 'rule' },
          { kind: 'online_preferred', label: 'Online preferred', confidence: 0.86, source: 'rule' },
          { kind: 'low_workload', label: 'Low workload preferred', confidence: 0.82, source: 'rule' },
          { kind: 'low_writing', label: 'Low writing preferred', confidence: 0.82, source: 'rule' },
        ],
        warnings: [],
        interpretedLanes: ['structured_section', 'student_language_alias', 'workload_evidence'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.82,
      },
    }, '');

    expect(plan.chips).toEqual([
      expect.objectContaining({ type: 'online', label: 'Online', queryPatch: { removeText: 'online' } }),
      expect.objectContaining({ type: 'assumption', label: 'Low workload preferred', queryPatch: { removeText: 'easy' } }),
      expect.objectContaining({ type: 'assumption', label: 'Low writing preferred', queryPatch: { removeText: 'no essays' } }),
    ]);
  });

  it('hides low-workload assumptions already represented by an easy workload chip', () => {
    const plan = buildSearchUiPlan([{
      type: 'difficulty',
      value: 'easy',
      metadata: { source: 'alias', confidence: 0.9, raw: 'easy' },
    }], {
      filters: { difficulty: 'easy' },
      keywordQuery: '',
      semanticQuery: '',
      rescue: {
        queryTypes: ['subjective_vibe'],
        negativeTerms: [],
        topicTerms: [],
        expandedTerms: [],
        assumptions: [
          { kind: 'low_workload', label: 'Low workload preferred', confidence: 0.82, source: 'rule' },
        ],
        warnings: [],
        interpretedLanes: ['student_language_alias', 'workload_evidence'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.74,
      },
    }, '');

    expect(plan.chips).toEqual([
      expect.objectContaining({ type: 'difficulty', label: 'Easy workload', queryPatch: { removeText: 'easy' } }),
    ]);
  });

  it('shows a concrete Any GenEd chip for generic gened intent without polluting advanced state', () => {
    const plan = buildSearchUiPlan([], {
      filters: {
        requirement: requirementFilter('any', [
          'HUM',
          'NAT',
          'SBS',
          'CS',
          'QR',
          'QR1',
          'QR2',
          'NW',
          'US',
          'WCC',
          'ACP',
        ]),
      },
      keywordQuery: '',
      semanticQuery: '',
      rescue: {
        queryTypes: ['requirement'],
        negativeTerms: [],
        topicTerms: [],
        expandedTerms: [],
        assumptions: [
          { kind: 'requirement_match', label: 'Requirement match matters', confidence: 0.78, source: 'rule' },
        ],
        warnings: [],
        interpretedLanes: ['official_text', 'requirement'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.74,
      },
    }, '');

    expect(plan.chips).toEqual([
      expect.objectContaining({
        id: 'gened-any',
        type: 'gened',
        label: 'Any GenEd',
      }),
    ]);
    expect(plan.advanced.gened).toBeUndefined();
  });

  it('preserves part-of-term filters in chips and advanced state', () => {
    const plan = buildSearchUiPlan([{
      type: 'partOfTerm',
      value: 'B',
      metadata: { source: 'regex', confidence: 0.8, raw: 'part B' },
    }], {
      filters: { partOfTerm: 'B' },
      keywordQuery: '',
      semanticQuery: '',
    }, '');

    expect(plan.chips).toEqual([
      expect.objectContaining({
        type: 'partOfTerm',
        filter: { partOfTerm: 'B' },
      }),
    ]);
    expect(plan.advanced.partOfTerm).toBe('B');
  });
});
