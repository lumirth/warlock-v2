import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { extractQuery } from './extractor.js';
import { parseTermValue, resolveQuery } from './query-resolver.js';
import { hybridSearchWithTermRanking, sanitizeFtsQuery, type SearchResult } from './search.js';
import { expandTopics } from './topic-registry.js';
import { parseQuery } from './query-parser.js';
import type { SearchPlan, ExtractedQuery, QueryHint, QueryHintType, SearchFilters, Hint, FieldFilter } from '@uiuc-course-search/query-types';

export interface SearchPipelineResult {
  results: SearchResult[];
  meta: {
    query: {
      raw: string;
      residual: string;
    };
    extraction: {
      hints: Hint[];
    };
    plan: SearchPlan;
    timing: {
      extraction_ms: number;
      search_ms: number;
      total_ms: number;
    };
    fallback: {
      tierReached: number;
      constraintsRelaxed: string[];
      originalResultCount: number;
    };
  };
}

function mapHintType(type: string): QueryHintType {
  const mapping: Record<string, QueryHintType> = {
    'courseCode': 'course_code',
    'crn': 'crn',
    'subject': 'subject',
    'instructor': 'instructor',
    'days': 'days',
    'time': 'time',
    'level': 'level',
    'credits': 'credits',
    'online': 'online',
    'status': 'status',
    'difficulty': 'difficulty',
    'gened': 'gened',
    'term': 'term',
    'partOfTerm': 'partOfTerm',
    'negation': 'negation',
  };
  return (mapping[type] || type) as QueryHintType;
}

function toQueryHint(hint: Hint): QueryHint {
  const queryHint: QueryHint = {
    type: mapHintType(hint.type),
    value: typeof hint.value === 'object' && hint.value !== null && 'subject' in hint.value
      ? `${hint.value.subject} ${hint.value.number}`
      : hint.value,
    confidence: hint.metadata.confidence,
    isExplicit: hint.metadata.source === 'regex',
  };

  if (hint.type === 'courseCode' && typeof hint.value === 'object' && hint.value !== null && 'subject' in hint.value) {
    queryHint.metadata = { subject: hint.value.subject, number: hint.value.number };
  }

  return queryHint;
}

function appendQueryText(current: string, addition: string): string {
  return [current, addition].filter(Boolean).join(' ').trim();
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.toLowerCase();
  if (['true', 'yes', '1', 'online', 'remote'].includes(normalized)) return true;
  if (['false', 'no', '0', 'in-person', 'in_person', 'inperson'].includes(normalized)) return false;
  return undefined;
}

function applyFieldFilter(filter: FieldFilter, plan: SearchPlan): void {
  switch (filter.field) {
    case 'subject':
      plan.filters.subject = filter.value.toUpperCase();
      break;
    case 'gened':
      plan.filters.gened_code = filter.value.toUpperCase();
      break;
    case 'credits': {
      const credits = parseInt(filter.value, 10);
      if (!Number.isNaN(credits)) plan.filters.credits = credits;
      break;
    }
    case 'level': {
      const level = parseInt(filter.value, 10);
      if (!Number.isNaN(level)) plan.filters.level = level;
      break;
    }
    case 'crn':
      plan.filters.crn = filter.value;
      break;
    case 'status':
      plan.filters.status = filter.value.toLowerCase();
      break;
    case 'online': {
      const online = parseBoolean(filter.value);
      if (online !== undefined) plan.filters.online = online;
      break;
    }
    case 'days':
      plan.filters.days = filter.value.toUpperCase();
      break;
    case 'time':
      plan.filters.time = filter.value.toLowerCase();
      break;
    case 'term': {
      const parsed = parseTermValue(filter.value);
      if (parsed) {
        plan.filters.term = parsed.term;
        plan.filters.year = parsed.year;
      }
      break;
    }
    case 'partofterm':
    case 'part_of_term':
    case 'pot':
      plan.filters.partOfTerm = filter.value.toUpperCase();
      break;
    case 'difficulty':
      if (filter.value === 'easy' || filter.value === 'hard') {
        plan.filters.difficulty = filter.value;
      }
      break;
  }
}

function applyNegationToken(token: string, plan: SearchPlan): void {
  const normalized = token.toLowerCase();
  const timeWords = new Set(['early', 'morning', 'midday', 'afternoon', 'evening', 'night']);
  const dayWords = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'mwf', 'tr', 'mw', 'wf', 'm', 't', 'w', 'r', 'f']);

  if (timeWords.has(normalized)) {
    plan.filters.not = plan.filters.not || {};
    plan.filters.not.time = plan.filters.not.time || [];
    plan.filters.not.time.push(normalized === 'night' ? 'evening' : normalized);
    return;
  }

  if (dayWords.has(normalized)) {
    plan.filters.not = plan.filters.not || {};
    plan.filters.not.days = plan.filters.not.days || [];
    plan.filters.not.days.push(normalized);
    return;
  }

  if (['online', 'remote', 'virtual'].includes(normalized)) {
    plan.filters.online = false;
  }
}

export class SearchPipeline {
  constructor(
    private db: D1Database,
    private vectorize: VectorizeIndex,
    private ai: Ai
  ) {}

  /**
   * Main search entry point using a tiered approach.
   */
  async search(
    query: string,
    limit: number = 20,
    overrides?: Partial<SearchFilters>,
    _waitUntil?: (promise: Promise<unknown>) => void
  ): Promise<SearchPipelineResult> {
    const startTime = performance.now();

    // 1. Parse power-user syntax (field:value, gened:any/all, negations, phrases)
    const parsed = parseQuery(query);

    // 2. Extract hints from residual using multi-pass extraction
    const extraction = extractQuery(parsed.clauses[0].residual);
    const extractionEndTime = performance.now();

    // 3. Bridge to old ExtractedQuery format for resolver
    const extracted: ExtractedQuery = {
      rawQuery: query,
      hints: extraction.hints.map(toQueryHint),
      residual: extraction.residual,
    };

    // 4. Resolve hints against database (validates subjects, instructors, geneds)
    const plan = await resolveQuery(this.db, extracted);

    // 5. Apply parsed filters from power-user syntax (takes precedence)
    const clause = parsed.clauses[0];
    for (const filter of clause.filters) {
      applyFieldFilter(filter, plan);
    }

    // 6. Apply gened:any/all from parsed query
    if (clause.genedMode) {
      if (clause.genedMode.any) plan.filters.gened_any = clause.genedMode.any;
      if (clause.genedMode.all) plan.filters.gened_all = clause.genedMode.all;
    }

    for (const negation of clause.negations) {
      applyNegationToken(negation, plan);
    }

    if (clause.phrases.length > 0) {
      const keywordPhrases = clause.phrases.map(phrase => `"${phrase.replace(/"/g, '""')}"`).join(' ');
      const semanticPhrases = clause.phrases.join(' ');
      plan.keywordQuery = appendQueryText(plan.keywordQuery, keywordPhrases);
      plan.semanticQuery = appendQueryText(plan.semanticQuery, semanticPhrases);
    }

    // 7. Apply manual overrides from API call
    if (overrides) {
      Object.assign(plan.filters, overrides);
    }

    // 8. Sanitize search queries to prevent FTS crashes
    plan.keywordQuery = sanitizeFtsQuery(plan.keywordQuery);
    plan.semanticQuery = sanitizeFtsQuery(plan.semanticQuery);

    const searchStartTime = performance.now();
    let results: SearchResult[];
    let tierReached: number;
    const constraintsRelaxed: string[] = [];
    let originalResultCount: number;

    // Tier 1: Navigational (Exact course code or CRN)
    const isNavigational = !!((plan.filters.subject && plan.filters.number) || plan.filters.crn);
    if (isNavigational) {
      tierReached = 1;
      results = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, plan, limit);
      originalResultCount = results.length;
    } else {
      // Tier 2: Structured (Search with extracted filters)
      tierReached = 2;
      results = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, plan, limit);
      originalResultCount = results.length;

      // If we have few results, try expansion
      if (results.length < 3) {
        // Tier 3: Topic Hybrid (Topic expansion)
        const expandedKeywords = expandTopics(extracted.residual);
        if (expandedKeywords.length > 0) {
          tierReached = 3;
          const expandedPlan: SearchPlan = {
            ...plan,
            keywordQuery: sanitizeFtsQuery(`${plan.keywordQuery} ${expandedKeywords.join(' ')}`),
            semanticQuery: sanitizeFtsQuery(`${plan.semanticQuery} ${expandedKeywords.join(' ')}`),
          };

          const expandedResults = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, expandedPlan, limit);
          results = this.mergeResults(results, expandedResults, limit);
        }
      }
    }
    const searchEndTime = performance.now();
    const totalEndTime = performance.now();

    const result: SearchPipelineResult = {
      results,
      meta: {
        query: {
          raw: query,
          residual: extraction.residual,
        },
        extraction: {
          hints: extraction.hints, // Return the rich Hint objects
        },
        plan,
        timing: {
          extraction_ms: Math.round(extractionEndTime - startTime),
          search_ms: Math.round(searchEndTime - searchStartTime),
          total_ms: Math.round(totalEndTime - startTime),
        },
        fallback: {
          tierReached,
          constraintsRelaxed,
          originalResultCount
        }
      }
    };

    return result;
  }

  /**
   * Merges two sets of search results, removing duplicates and maintaining sort order.
   */
  private mergeResults(a: SearchResult[], b: SearchResult[], limit: number): SearchResult[] {
    const map = new Map<string, SearchResult>();
    
    for (const r of a) {
      map.set(r.course.id, r);
    }
    
    for (const r of b) {
      const existing = map.get(r.course.id);
      // Prefer results with better score if already present
      if (!existing || r.score > existing.score) {
        map.set(r.course.id, r);
      }
    }
    
    const merged = Array.from(map.values());
    
    merged.sort((x, y) => {
      if (x.termPriority !== y.termPriority) {
        return (x.termPriority ?? 100) - (y.termPriority ?? 100);
      }
      return y.score - x.score;
    });
    
    return merged.slice(0, limit);
  }
}
