import type {
  AdvancedSearchStateDto,
  Ambiguity,
  CourseCodeValue,
  Hint,
  NegationValue,
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchFilters,
  SearchPlan,
  SearchUiPlanDto,
  TermValue,
} from '@uiuc-course-search/query-types';

export function buildSearchUiPlan(hints: Hint[], plan: SearchPlan, residual: string): SearchUiPlanDto {
  return {
    chips: buildSearchChips(hints, residual),
    advanced: buildAdvancedState(hints, plan.filters),
    ambiguityActions: buildAmbiguityActions(plan.ambiguities ?? []),
  };
}

function buildSearchChips(hints: Hint[], residual: string): SearchChipDto[] {
  const chips = hints.map((hint, index): SearchChipDto => ({
    id: `${hint.type}-${index}`,
    type: hint.type,
    label: formatHintLabel(hint),
    value: formatHintValue(hint.value),
    source: 'natural_language',
    removable: true,
    editable: isEditableHint(hint),
    filter: filterFromHint(hint),
    queryPatch: {
      removeText: hint.metadata.raw,
    },
  }));

  if (residual) {
    chips.push({
      id: 'semantic-query',
      type: 'semantic',
      label: `Topic: ${residual}`,
      value: residual,
      source: 'natural_language',
      removable: true,
      editable: true,
      queryPatch: {
        removeText: residual,
      },
    });
  }

  return chips;
}

function buildAdvancedState(hints: Hint[], filters: SearchFilters): AdvancedSearchStateDto {
  const instructorHint = hints.find((hint) => hint.type === 'instructor');

  return {
    subject: filters.subject,
    number: filters.number,
    instructor: instructorHint ? formatHintValue(instructorHint.value) : undefined,
    term: filters.term,
    year: filters.year,
    gened: filters.gened_code ?? filters.gened_any?.[0] ?? filters.gened_all?.[0],
    credits: filters.credits,
    days: filters.days,
    time: filters.time,
    online: filters.online,
    status: filters.status,
    difficulty: filters.difficulty,
  };
}

function buildAmbiguityActions(ambiguities: Ambiguity[]): SearchAmbiguityActionDto[] {
  return ambiguities.flatMap((ambiguity, ambiguityIndex) =>
    ambiguity.alternatives.map((alternative, alternativeIndex) => {
      const filter = ambiguityFilter(alternative.type, alternative.value);

      return {
        id: `${ambiguityIndex}-${alternativeIndex}-${alternative.type}-${alternative.value}`,
        term: ambiguity.term,
        label: alternative.label,
        filter,
        queryPatch: {
          replaceQuery: queryForFilter(filter),
        },
      };
    })
  );
}

function ambiguityFilter(type: string, value: string): Partial<SearchFilters> {
  if (type === 'subject') {
    return { subject: value.toUpperCase() };
  }

  if (type === 'gened') {
    return { gened_code: value.toUpperCase() };
  }

  return {};
}

function queryForFilter(filter: Partial<SearchFilters>): string {
  if (filter.subject) {
    return `subject:${filter.subject}`;
  }

  if (filter.gened_code) {
    return `gened:${filter.gened_code}`;
  }

  return '';
}

function formatHintLabel(hint: Hint): string {
  switch (hint.type) {
    case 'courseCode': {
      const value = hint.value as CourseCodeValue;
      return `Course ${value.subject} ${value.number}`.trim();
    }
    case 'crn':
      return `CRN ${formatHintValue(hint.value)}`;
    case 'subject':
      return `Subject ${formatHintValue(hint.value)}`;
    case 'instructor':
      return `Instructor ${formatHintValue(hint.value)}`;
    case 'days':
      return `Meets ${formatHintValue(hint.value)}`;
    case 'time':
      return `${capitalize(formatHintValue(hint.value))} classes`;
    case 'level':
      return `${formatHintValue(hint.value)} level`;
    case 'levelBoost':
      return `${formatHintValue(hint.value)} level preference`;
    case 'credits':
      return `${formatHintValue(hint.value)} credits`;
    case 'online':
      return hint.value ? 'Online' : 'In person';
    case 'status':
      return `${capitalize(formatHintValue(hint.value))} sections`;
    case 'difficulty':
      return `${capitalize(formatHintValue(hint.value))} workload`;
    case 'gened':
      return `GenEd ${formatHintValue(hint.value)}`;
    case 'term': {
      const term = hint.value as TermValue;
      return `${capitalize(term.term)} ${term.year}`;
    }
    case 'partOfTerm':
      return `Part of term ${formatHintValue(hint.value)}`;
    case 'negation': {
      const negation = hint.value as NegationValue;
      return `No ${negation.value}`;
    }
  }
}

function formatHintValue(value: Hint['value']): string {
  if (typeof value === 'object' && value !== null) {
    if ('subject' in value && 'number' in value) {
      return `${value.subject} ${value.number}`.trim();
    }
    if ('term' in value && 'year' in value) {
      return `${value.term} ${value.year}`;
    }
    if ('target' in value && 'value' in value) {
      return value.value;
    }
  }

  return String(value);
}

function filterFromHint(hint: Hint): Partial<SearchFilters> {
  switch (hint.type) {
    case 'courseCode': {
      const value = hint.value as CourseCodeValue;
      return {
        subject: value.subject || undefined,
        number: value.number,
      };
    }
    case 'subject':
      return { subject: formatHintValue(hint.value).toUpperCase() };
    case 'crn':
      return { crn: formatHintValue(hint.value) };
    case 'days':
      return { days: formatHintValue(hint.value) };
    case 'time':
      return { time: formatHintValue(hint.value) };
    case 'credits':
      return { credits: Number(hint.value) };
    case 'online':
      return { online: Boolean(hint.value) };
    case 'status':
      return { status: formatHintValue(hint.value) };
    case 'difficulty':
      return { difficulty: hint.value as 'easy' | 'hard' };
    case 'gened':
      return { gened_code: formatHintValue(hint.value).toUpperCase() };
    case 'term': {
      const value = hint.value as TermValue;
      return { term: value.term, year: value.year };
    }
    case 'partOfTerm':
      return { partOfTerm: formatHintValue(hint.value) };
    default:
      return {};
  }
}

function isEditableHint(hint: Hint): boolean {
  return hint.type !== 'crn' && hint.type !== 'negation';
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
