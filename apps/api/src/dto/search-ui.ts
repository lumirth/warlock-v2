import type {
  AdvancedSearchStateDto,
  SearchAmbiguityActionDto,
  SearchChipDto,
  SearchRequestFilterPatchDto,
  SearchUiPlanDto,
} from '@uiuc-course-search/query-types';
import type {
  Ambiguity,
  CourseCodeValue,
  Hint,
  NegationValue,
  SearchFilters,
  SearchPlan,
  TermValue,
} from '@uiuc-course-search/query-types/search-planner';
import {
  effectiveRequirementFilter,
  isSearchDifficultyFilter,
  isSearchLevelFilter,
  isSearchStatusFilter,
  isSearchTermFilter,
  isSearchTimeFilter,
} from '@uiuc-course-search/query-types';
import { isGenericAnyGenedFilter } from '../services/gened-codes.js';

export function buildSearchUiPlan(hints: Hint[], plan: SearchPlan, residual: string): SearchUiPlanDto {
  return {
    chips: buildSearchChips(hints, plan, residual),
    advanced: buildAdvancedState(hints, plan.filters, residual),
    ambiguityActions: buildAmbiguityActions(plan.ambiguities ?? []),
  };
}

function buildSearchChips(hints: Hint[], plan: SearchPlan, residual: string): SearchChipDto[] {
  const chips = hints.map((hint, index): SearchChipDto => ({
    id: `${hint.type}-${index}`,
    type: hint.type,
    label: formatResolvedHintLabel(hint, plan, residual),
    value: formatResolvedHintValue(hint, plan, residual),
    source: 'natural_language',
    removable: true,
    editable: isEditableHint(hint),
    filter: resolvedFilterFromHint(hint, plan),
    queryPatch: {
      removeText: removeTextForHint(hint, residual),
    },
  }));

  if (shouldShowGenericGenedChip(hints, plan.filters)) {
    chips.push({
      id: 'gened-any',
      type: 'gened',
      label: 'Any GenEd',
      value: 'any',
      source: 'natural_language',
      removable: true,
      editable: false,
      queryPatch: {
        removeText: 'gened',
      },
    });
  }

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

  const existingLabels = new Set(chips.map(chip => chip.label.toLowerCase()));
  for (const assumption of plan.rescue?.assumptions ?? []) {
    if (shouldHideAssumptionChip(assumption.kind, hints, plan.filters)) {
      continue;
    }
    if (existingLabels.has(assumption.label.toLowerCase())) {
      continue;
    }
    chips.push({
      id: `assumption-${assumption.kind}`,
      type: 'assumption',
      label: assumption.label,
      value: assumption.kind,
      source: 'natural_language',
      removable: true,
      editable: false,
      queryPatch: {
        removeText: textToRemoveForAssumption(assumption.kind, residual),
      },
    });
  }

  return chips;
}

function shouldHideAssumptionChip(kind: string, hints: Hint[], filters: SearchFilters): boolean {
  if (kind === 'schedule_fit' || kind === 'requirement_match' || kind === 'requirement_ambiguous') {
    return true;
  }

  if (kind === 'low_workload') {
    return filters.difficulty === 'easy' || hints.some(hint => hint.type === 'difficulty' && hint.value === 'easy');
  }

  if (kind === 'online_preferred') {
    return filters.online !== undefined || hints.some(hint => hint.type === 'online');
  }

  if (kind === 'credit_count') {
    return filters.credits !== undefined || hints.some(hint => hint.type === 'credits');
  }

  return false;
}

function shouldShowGenericGenedChip(hints: Hint[], filters: SearchFilters): boolean {
  const requirement = effectiveRequirementFilter(filters);
  return requirement?.mode === 'any'
    && isGenericAnyGenedFilter(requirement.codes)
    && !hints.some(hint => hint.type === 'gened');
}

function textToRemoveForAssumption(kind: string, residual: string): string | undefined {
  if (kind === 'low_writing') return 'no essays';
  if (kind === 'low_exams') return 'no tests';
  if (kind === 'low_math') return 'not math';
  if (kind === 'low_workload') return 'easy';
  if (kind === 'no_listed_prereq') return 'no prereq';
  if (kind === 'online_preferred') return 'online';
  return residual || undefined;
}

function buildAdvancedState(hints: Hint[], filters: SearchFilters, residual: string): AdvancedSearchStateDto {
  const instructorHint = hints.find((hint) => hint.type === 'instructor');

  return {
    subject: filters.subject,
    number: filters.number,
    instructor: instructorHint ? formatDisplayHintValue(instructorHint, residual) : undefined,
    term: publicTerm(filters.term),
    year: filters.year,
    gened: publicRequirementCode(filters),
    credits: filters.credits,
    days: filters.days,
    time: publicTime(filters.time),
    online: filters.online,
    status: publicStatus(filters.status),
    difficulty: filters.difficulty,
    level: publicLevel(filters.level),
    partOfTerm: filters.partOfTerm,
  };
}

function publicRequirementCode(filters: SearchFilters): string | undefined {
  const requirement = effectiveRequirementFilter(filters);
  if (!requirement) return undefined;
  if (requirement.mode === 'any' && isGenericAnyGenedFilter(requirement.codes)) {
    return undefined;
  }
  return requirement.codes[0];
}

function publicTerm(value: string | undefined): AdvancedSearchStateDto['term'] {
  return isSearchTermFilter(value) ? value : undefined;
}

function publicTime(value: string | undefined): AdvancedSearchStateDto['time'] {
  return isSearchTimeFilter(value) ? value : undefined;
}

function publicStatus(value: string | undefined): AdvancedSearchStateDto['status'] {
  return isSearchStatusFilter(value) ? value : undefined;
}

function publicLevel(value: number | undefined): AdvancedSearchStateDto['level'] {
  return isSearchLevelFilter(value) ? value : undefined;
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

function ambiguityFilter(type: string, value: string): SearchRequestFilterPatchDto {
  if (type === 'subject') {
    return { subject: value.toUpperCase() };
  }

  if (type === 'gened') {
    return { gened: value.toUpperCase() };
  }

  return {};
}

function queryForFilter(filter: SearchRequestFilterPatchDto): string {
  if (filter.subject) {
    return `subject:${filter.subject}`;
  }

  if (filter.gened) {
    return `gened:${filter.gened}`;
  }

  return '';
}

function formatHintLabel(hint: Hint, residual = ''): string {
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
      return `Instructor ${formatDisplayHintValue(hint, residual)}`;
    case 'days':
      return `Meets ${formatHintValue(hint.value)}`;
    case 'time':
      return `${capitalize(formatHintValue(hint.value))} classes`;
    case 'level':
      return `${formatHintValue(hint.value)} level`;
    case 'levelBoost':
      if (hint.value === 100) {
        return 'Introductory courses';
      }
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

function formatResolvedHintLabel(hint: Hint, plan: SearchPlan, residual = ''): string {
  if (isSubjectHintResolvedAsGened(hint, plan)) {
    return `GenEd ${formatHintValue(hint.value)}`;
  }

  return formatHintLabel(hint, residual);
}

function formatResolvedHintValue(hint: Hint, plan: SearchPlan, residual: string): string {
  if (isSubjectHintResolvedAsGened(hint, plan)) {
    return formatHintValue(hint.value).toUpperCase();
  }

  return formatDisplayHintValue(hint, residual);
}

function formatDisplayHintValue(hint: Hint, residual: string): string {
  const value = formatHintValue(hint.value);
  if (hint.type !== 'instructor') {
    return value;
  }

  return trimTrailingResidual(value, residual) ?? value;
}

function removeTextForHint(hint: Hint, residual: string): string {
  if (hint.type !== 'instructor') {
    return hint.metadata.raw;
  }

  return trimTrailingResidual(hint.metadata.raw, residual) ?? hint.metadata.raw;
}

function trimTrailingResidual(value: string, residual: string): string | null {
  const valueTokens = value.trim().split(/\s+/);
  const residualTokens = residual.trim().split(/\s+/).filter(Boolean);
  if (valueTokens.length <= 1 || residualTokens.length === 0) {
    return null;
  }

  for (let tokenCount = Math.min(residualTokens.length, valueTokens.length - 1); tokenCount >= 1; tokenCount--) {
    const suffix = residualTokens.slice(0, tokenCount).join(' ').toLowerCase();
    const candidate = valueTokens.slice(-tokenCount).join(' ').toLowerCase();
    if (candidate === suffix) {
      return valueTokens.slice(0, -tokenCount).join(' ');
    }
  }

  return null;
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

function filterFromHint(hint: Hint): SearchRequestFilterPatchDto {
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
      return {};
    case 'days':
      return { days: formatHintValue(hint.value) };
    case 'time': {
      const time = formatHintValue(hint.value);
      return isSearchTimeFilter(time) ? { time } : {};
    }
    case 'credits':
      return { credits: Number(hint.value) };
    case 'level': {
      const level = Number(hint.value);
      return isSearchLevelFilter(level) ? { level } : {};
    }
    case 'online':
      return { online: Boolean(hint.value) };
    case 'status': {
      const status = formatHintValue(hint.value);
      return isSearchStatusFilter(status) ? { status } : {};
    }
    case 'difficulty':
      return isSearchDifficultyFilter(hint.value)
        ? { difficulty: hint.value }
        : {};
    case 'gened':
      return { gened: formatHintValue(hint.value).toUpperCase() };
    case 'term': {
      const value = hint.value as TermValue;
      return {
        ...(isSearchTermFilter(value.term) ? { term: value.term } : {}),
        year: value.year,
      };
    }
    case 'partOfTerm':
      return { partOfTerm: formatHintValue(hint.value) };
    default:
      return {};
  }
}

function resolvedFilterFromHint(hint: Hint, plan: SearchPlan): SearchRequestFilterPatchDto {
  if (isSubjectHintResolvedAsGened(hint, plan)) {
    return { gened: formatHintValue(hint.value).toUpperCase() };
  }

  return filterFromHint(hint);
}

function isSubjectHintResolvedAsGened(hint: Hint, plan: SearchPlan): boolean {
  const requirement = effectiveRequirementFilter(plan.filters);
  return hint.type === 'subject'
    && !plan.filters.subject
    && requirement?.mode === 'single'
    && requirement.codes[0] === formatHintValue(hint.value).toUpperCase();
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
