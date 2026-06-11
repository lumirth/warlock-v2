import { describe, expect, it } from 'vitest';
import {
  normalizeSearchRequestDto,
  GENERIC_REQUIREMENT_CODES,
  type NormalizedSearchRequestDto,
  type SearchUiPlanDto,
  requirementFilter,
  singleRequirementFilter,
} from '@uiuc-course-search/query-types';
import type { Hint, SearchPlan } from '../search-planner-types.js';
import {
  buildSearchUiPlan,
} from '../search-ui-plan.js';
import { buildInterpretedSearchRequest } from '../search-interpreted-request.js';

const request = (query: string, filters = {}) =>
  normalizeSearchRequestDto({ query, filters });

function buildUiPlan(
  hints: Hint[],
  plan: SearchPlan,
  residual: string,
  executableRequest = request(''),
) {
  return buildSearchUiPlan(hints, plan, residual, {
    executableRequest,
    interpretedRequest: normalizeSearchRequestDto(
      buildInterpretedSearchRequest(hints, plan, residual, executableRequest),
    ),
  });
}

function expectRemovableChipActionsChangeRequest(
  ui: SearchUiPlanDto,
  executableRequest: NormalizedSearchRequestDto,
) {
  for (const chip of ui.chips) {
    expect(chip.removeRequest, chip.label).not.toEqual(executableRequest);
  }
}

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
        type: 'workload',
        value: 'hard',
        metadata: { source: 'alias', confidence: 0.9, raw: 'hard' },
      },
    ];

    const plan = buildUiPlan(hints, {
      filters: {
        subject: 'CS',
        number: '225',
        workload: 'hard',
        instructor_ids: [1],
      },
      keywordQuery: 'systems',
      semanticQuery: 'systems',
    }, 'systems', request('CS 225 professor fagen hard systems'));

    expect(plan.chips.map(chip => chip.label)).toEqual([
      'Course CS 225',
      'Instructor fagen',
      'Hard workload',
      'Topic: systems',
    ]);
    expectRemovableChipActionsChangeRequest(
      plan,
      request('CS 225 professor fagen hard systems'),
    );
    expect(plan.chips[0].removeRequest.query).toBe('professor fagen hard systems');
    expect(buildInterpretedSearchRequest(
      hints,
      {
        filters: {
          subject: 'CS',
          number: '225',
          workload: 'hard',
          instructor_ids: [1],
        },
        keywordQuery: 'systems',
        semanticQuery: 'systems',
      },
      'systems',
      request('CS 225 professor fagen hard systems'),
    )).toMatchObject({
      query: 'systems',
      filters: {
        subject: 'CS',
        number: '225',
        instructor: 'fagen',
        workload: 'hard',
      },
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
        alternatives: [{ type: 'requirement', value: 'CS', label: 'Cultural Studies' }],
      }],
    };

    expect(buildUiPlan([], plan, '', request('CS')).ambiguityActions).toEqual([{
      id: '0-0-requirement-CS',
      term: 'CS',
      label: 'Cultural Studies',
      nextRequest: {
        query: '',
        filters: { requirement: singleRequirementFilter('CS') },
        sort: { field: 'relevance', direction: 'desc' },
        scope: 'active',
      },
    }]);
  });

  it('renders subject shorthand as a GenEd chip when the resolver chose the requirement meaning', () => {
    const hints: Hint[] = [
      {
        type: 'workload',
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
      filters: { workload: 'easy', requirement: singleRequirementFilter('CS') },
      keywordQuery: '',
      semanticQuery: '',
      ambiguities: [{
        term: 'cs',
        chosen: { type: 'requirement', value: 'CS', label: 'Cultural Studies' },
        alternatives: [{ type: 'subject', value: 'CS', label: 'Computer Science' }],
      }],
    };

    const ui = buildUiPlan(hints, plan, '', request('easy cs'));

    expect(ui.chips.map(chip => chip.label)).toEqual(['Easy workload', 'GenEd CS']);
    expect(ui.chips[1].removeRequest.query).toBe('easy');
    expect(buildInterpretedSearchRequest(hints, plan, '', request('easy cs')).filters).toMatchObject({
      requirement: singleRequirementFilter('CS'),
      workload: 'easy',
    });
    expect(ui.ambiguityActions[0].nextRequest).toMatchObject({
      query: '',
      filters: { subject: 'CS', workload: 'easy' },
    });
  });

  it('does not show restored topic words inside instructor chips', () => {
    const executableRequest = request('professor fagen algorithms');
    const plan = buildUiPlan([{
      type: 'instructor',
      value: 'fagen algorithms',
      metadata: { source: 'nlp', confidence: 0.8, raw: 'professor fagen algorithms' },
    }], {
      filters: { instructor_ids: [3365] },
      keywordQuery: 'algorithms',
      semanticQuery: 'algorithms',
    }, 'algorithms', executableRequest);

    expect(plan.chips.map(chip => chip.label)).toEqual([
      'Instructor fagen',
      'Topic: algorithms',
    ]);
    expectRemovableChipActionsChangeRequest(plan, executableRequest);
    expect(plan.chips[0].value).toBe('fagen');
    expect(plan.chips[0].removeRequest).toEqual({
      query: 'algorithms',
      sort: { field: 'relevance', direction: 'desc' },
      scope: 'active',
    });
    expect(buildInterpretedSearchRequest([{
      type: 'instructor',
      value: 'fagen algorithms',
      metadata: { source: 'nlp', confidence: 0.8, raw: 'professor fagen algorithms' },
    }], {
      filters: { instructor_ids: [3365] },
      keywordQuery: 'algorithms',
      semanticQuery: 'algorithms',
    }, 'algorithms', request('professor fagen algorithms')).filters).toMatchObject({
      instructor: 'fagen',
    });
  });

  it('labels introductory level boosts in student-facing language', () => {
    const executableRequest = request('intro cs');
    const plan = buildUiPlan([{
      type: 'levelBoost',
      value: 100,
      metadata: { source: 'regex', confidence: 0.5, raw: 'intro' },
    }], {
      filters: { subject: 'CS' },
      keywordQuery: '',
      semanticQuery: '',
      introductoryGateway: true,
    }, '', executableRequest);

    expect(plan.chips.map(chip => chip.label)).toEqual(['Introductory courses']);
    expectRemovableChipActionsChangeRequest(plan, executableRequest);
    expect(plan.chips[0].removeRequest).toMatchObject({
      query: 'cs',
      filters: undefined,
    });
  });

  it('does not present topical intro scaffolding as an introductory-gateway chip', () => {
    const executableRequest = request('intro to compilers');
    const plan = buildUiPlan([{
      type: 'levelBoost',
      value: 100,
      metadata: { source: 'regex', confidence: 0.5, raw: 'intro' },
    }], {
      filters: {},
      keywordQuery: 'intro OR to OR compilers OR compiler',
      semanticQuery: 'intro to compilers compiler design programming languages',
      softPreferences: {
        levelBoost: 100,
        topicExpansions: ['compiler design programming languages'],
      },
      intent: {
        queryTypes: ['topic'],
        negativeTerms: [],
        topicTerms: ['intro to compilers'],
        expandedTerms: ['compiler design programming languages'],
        warnings: [],
        confidence: 0.74,
      },
    }, 'intro to compilers', executableRequest);

    expect(plan.chips.map(chip => chip.label)).toEqual(['Topic: intro to compilers']);
    expectRemovableChipActionsChangeRequest(plan, executableRequest);
  });

  it('shows only directly actionable intent in the chip row', () => {
    const plan = buildUiPlan([{
      type: 'online',
      value: true,
      metadata: { source: 'alias', confidence: 0.9, raw: 'online' },
    }], {
      filters: { online: true },
      keywordQuery: '',
      semanticQuery: '',
      intent: {
        queryTypes: ['schedule', 'subjective_vibe', 'avoidance'],
        negativeTerms: ['writing_heavy'],
        topicTerms: [],
        expandedTerms: [],
        warnings: [],
        confidence: 0.82,
      },
    }, '', request('online easy no essays'));

    expect(plan.chips).toEqual([
      expect.objectContaining({ type: 'online', label: 'Online', removeRequest: expect.any(Object) }),
    ]);
  });

  it('shows one workload chip for one workload intent', () => {
    const plan = buildUiPlan([{
      type: 'workload',
      value: 'easy',
      metadata: { source: 'alias', confidence: 0.9, raw: 'easy' },
    }], {
      filters: { workload: 'easy' },
      keywordQuery: '',
      semanticQuery: '',
      intent: {
        queryTypes: ['subjective_vibe'],
        negativeTerms: [],
        topicTerms: [],
        expandedTerms: [],
        warnings: [],
        confidence: 0.74,
      },
    }, '', request('easy'));

    expect(plan.chips).toEqual([
      expect.objectContaining({ type: 'workload', label: 'Easy workload', removeRequest: expect.any(Object) }),
    ]);
  });

  it('shows a concrete Any GenEd chip and preserves the canonical requirement filter', () => {
    const requirement = requirementFilter('any', GENERIC_REQUIREMENT_CODES)!;
    const executableRequest = request('gened', { requirement });
    const plan = buildUiPlan([], {
      filters: {
        requirement,
      },
      keywordQuery: '',
      semanticQuery: '',
      intent: {
        queryTypes: ['requirement'],
        negativeTerms: [],
        topicTerms: [],
        expandedTerms: [],
        warnings: [],
        confidence: 0.74,
      },
    }, '', executableRequest);

    expectRemovableChipActionsChangeRequest(plan, executableRequest);
    expect(plan.chips).toEqual([
      expect.objectContaining({
        id: 'manual-requirement-any',
        type: 'requirement',
        label: 'Any GenEd',
        removeRequest: expect.objectContaining({
          filters: undefined,
        }),
      }),
    ]);
    expect(buildInterpretedSearchRequest([], {
      filters: {
        requirement,
      },
      keywordQuery: '',
      semanticQuery: '',
    }, '', request('gened')).filters?.requirement).toEqual(requirement);
  });

  it('removes one structured GenEd code without collapsing the rest of the requirement filter', () => {
    const requirement = requirementFilter('any', ['HUM', 'US'])!;
    const executableRequest = request('', { requirement });
    const ui = buildUiPlan([], {
      filters: { requirement },
      keywordQuery: '',
      semanticQuery: '',
    }, '', executableRequest);

    expect(ui.chips.map(chip => chip.label)).toEqual(['GenEd HUM', 'GenEd US']);
    expect(ui.chips[0]).toMatchObject({
      removeRequest: {
        query: '',
        filters: { requirement: singleRequirementFilter('US') },
        sort: { field: 'relevance', direction: 'desc' },
        scope: 'active',
      },
    });
    expect(ui.chips[1]).toMatchObject({
      removeRequest: {
        filters: { requirement: singleRequirementFilter('HUM') },
      },
    });
  });

  it('removes orphan GenEd cue text when removing a single natural-language GenEd chip', () => {
    const executableRequest = request('easy humanities gen ed');
    const ui = buildUiPlan([{
      type: 'requirement',
      value: 'HUM',
      metadata: { source: 'alias', confidence: 0.9, raw: 'humanities' },
    }], {
      filters: { requirement: singleRequirementFilter('HUM') },
      keywordQuery: '',
      semanticQuery: '',
    }, '', executableRequest);

    expect(ui.chips.map(chip => chip.label)).toEqual(['GenEd HUM']);
    expect(ui.chips[0].removeRequest).toEqual({
      query: 'easy',
      sort: { field: 'relevance', direction: 'desc' },
      scope: 'active',
    });
  });

  it('keeps GenEd cue text when another concrete natural-language GenEd remains', () => {
    const executableRequest = request('humanities and social science gen ed');
    const ui = buildUiPlan([
      {
        type: 'requirement',
        value: 'HUM',
        metadata: { source: 'alias', confidence: 0.9, raw: 'humanities' },
      },
      {
        type: 'requirement',
        value: 'SBS',
        metadata: { source: 'alias', confidence: 0.9, raw: 'social science' },
      },
    ], {
      filters: { requirement: requirementFilter('any', ['HUM', 'SBS']) },
      keywordQuery: '',
      semanticQuery: '',
    }, '', executableRequest);

    expect(ui.chips.map(chip => chip.label)).toEqual(['GenEd HUM', 'GenEd SBS']);
    expect(ui.chips[0].removeRequest.query).toBe('social science gen ed');
    expect(ui.chips[1].removeRequest.query).toBe('humanities gen ed');
  });

  it('preserves part-of-term filters in chips and advanced state', () => {
    const plan = buildUiPlan([{
      type: 'partOfTerm',
      value: 'B',
      metadata: { source: 'regex', confidence: 0.8, raw: 'part B' },
    }], {
      filters: { partOfTerm: 'B' },
      keywordQuery: '',
      semanticQuery: '',
    }, '', request('part B'));

    expect(plan.chips).toEqual([
      expect.objectContaining({
        type: 'partOfTerm',
        removeRequest: expect.any(Object),
      }),
    ]);
    expect(buildInterpretedSearchRequest([{
      type: 'partOfTerm',
      value: 'B',
      metadata: { source: 'regex', confidence: 0.8, raw: 'part B' },
    }], {
      filters: { partOfTerm: 'B' },
      keywordQuery: '',
      semanticQuery: '',
    }, '', request('part B')).filters).toMatchObject({
      partOfTerm: 'B',
    });
  });

  it('removes manual instructor filters as filters and marks their chip provenance', () => {
    const plan = buildUiPlan([], {
      filters: { instructor_ids: [3365] },
      keywordQuery: '',
      semanticQuery: '',
    }, '', request('', { instructor: 'Fagen' }));

    expect(plan.chips[0]).toMatchObject({
      label: 'Instructor Fagen',
      removeRequest: {
        query: '',
        sort: { field: 'relevance', direction: 'desc' },
        scope: 'active',
      },
    });
  });
});
