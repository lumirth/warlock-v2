import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { extractQuery } from './extractor.js';
import { resolveQuery } from './query-resolver.js';
import { hybridSearchWithTermRanking, sanitizeFtsQuery, type SearchResult } from './search.js';
import { expandTopics } from './topic-registry.js';
import { parseQuery } from './query-parser.js';
import { logSearch } from './query-logger.js';
import type { SearchPlan, ExtractedQuery, QueryHint, QueryHintType, SearchFilters, Hint } from '@uiuc-course-search/query-types';

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
  };
  return (mapping[type] || type) as QueryHintType;
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
    overrides?: Partial<SearchFilters>
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
      hints: extraction.hints.map(hint => {
        const queryHint: QueryHint = {
          type: mapHintType(hint.type),
          value: typeof hint.value === 'object' && hint.value !== null && 'subject' in hint.value
            ? `${(hint.value as any).subject} ${(hint.value as any).number}`
            : String(hint.value),
          confidence: hint.metadata.confidence,
          isExplicit: hint.metadata.source === 'regex',
          metadata: hint.type === 'courseCode' && typeof hint.value === 'object' && hint.value !== null && 'subject' in hint.value
            ? { subject: (hint.value as any).subject, number: (hint.value as any).number }
            : undefined as any,
        };
        return queryHint;
      }),
      residual: extraction.residual,
    };

    // 4. Resolve hints against database (validates subjects, instructors, geneds)
    const plan = await resolveQuery(this.db, extracted);

    // 5. Apply parsed filters from power-user syntax (takes precedence)
    const clause = parsed.clauses[0];
    for (const filter of clause.filters) {
      if (filter.field === 'subject') plan.filters.subject = filter.value.toUpperCase();
      if (filter.field === 'gened') plan.filters.gened_code = filter.value.toUpperCase();
      if (filter.field === 'credits') plan.filters.credits = parseInt(filter.value);
      if (filter.field === 'level') plan.filters.level = parseInt(filter.value);
      if (filter.field === 'crn') plan.filters.crn = filter.value;
    }

    // 6. Apply gened:any/all from parsed query
    if (clause.genedMode) {
      if (clause.genedMode.any) plan.filters.gened_any = clause.genedMode.any;
      if (clause.genedMode.all) plan.filters.gened_all = clause.genedMode.all;
    }

    // 7. Apply manual overrides from API call
    if (overrides) {
      Object.assign(plan.filters, overrides);
    }

    // 8. Sanitize search queries to prevent FTS crashes
    plan.keywordQuery = sanitizeFtsQuery(plan.keywordQuery);
    plan.semanticQuery = sanitizeFtsQuery(plan.semanticQuery);

    const searchStartTime = performance.now();
    let results: SearchResult[] = [];
    let tierReached = 1;
    const constraintsRelaxed: string[] = [];

    // Tier 1: Navigational (Exact course code or CRN)
    const isNavigational = !!((plan.filters.subject && plan.filters.number) || plan.filters.crn);
    if (isNavigational) {
      tierReached = 1;
      console.log('Tier 1: Navigational search');
      results = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, plan, limit);
    } else {
      // Tier 2: Structured (Search with extracted filters)
      tierReached = 2;
      console.log('Tier 2: Structured search');
      results = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, plan, limit);

      // If we have few results, try expansion
      if (results.length < 3) {
        // Tier 3: Topic Hybrid (Topic expansion)
        const expandedKeywords = expandTopics(extracted.residual);
        if (expandedKeywords.length > 0) {
          tierReached = 3;
          console.log('Tier 3: Topic expansion', expandedKeywords);
          const expandedPlan: SearchPlan = {
            ...plan,
            keywordQuery: sanitizeFtsQuery(`${plan.keywordQuery} ${expandedKeywords.join(' ')}`),
            semanticQuery: sanitizeFtsQuery(`${plan.semanticQuery} ${expandedKeywords.join(' ')}`),
          };

          const expandedResults = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, expandedPlan, limit);
          results = this.mergeResults(results, expandedResults, limit);
        }
      }

      // Tier 4: Fallback (Broaden)
      if (results.length < 3) {
        tierReached = 4;
        console.log(`Tier 4: Broadening search (current results: ${results.length})`);
        // 1. If we have a level filter, try removing it
        if (plan.filters.level) {
          constraintsRelaxed.push('level');
          console.log('Tier 4.1: Removing level filter');
          const broadPlan = { ...plan, filters: { ...plan.filters } };
          delete broadPlan.filters.level;
          const broadResults = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, broadPlan, limit);
          results = this.mergeResults(results, broadResults, limit);
        }

        // 2. If we still have few results, broaden while KEEPING subject
        if (results.length < 3 && (plan.filters.subject || plan.filters.gened_code)) {
          console.log('Tier 4.2: Broadening filters while keeping subject');
          const veryBroadPlan: SearchPlan = {
            ...plan,
            filters: { ...plan.filters },
            semanticQuery: sanitizeFtsQuery(query),
            keywordQuery: sanitizeFtsQuery(query)
          };
          // NEVER drop the Subject filter
          if (veryBroadPlan.filters.gened_code) constraintsRelaxed.push('gened_code');
          if (veryBroadPlan.filters.instructor_ids) constraintsRelaxed.push('instructor_ids');
          if (veryBroadPlan.filters.level && !constraintsRelaxed.includes('level')) constraintsRelaxed.push('level');

          delete veryBroadPlan.filters.gened_code;
          delete veryBroadPlan.filters.instructor_ids;
          delete veryBroadPlan.filters.level;
          delete veryBroadPlan.filters.difficulty;
          // Note: we explicitly keep veryBroadPlan.filters.subject if it exists

          const veryBroadResults = await hybridSearchWithTermRanking(this.db, this.vectorize, this.ai, veryBroadPlan, limit);
          results = this.mergeResults(results, veryBroadResults, limit);
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
        }
      }
    };

    // Fire and forget logging
    logSearch(
      this.db,
      query,
      result,
      isNavigational,
      tierReached,
      constraintsRelaxed
    ).catch(err => console.error('Error in logSearch:', err));

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
