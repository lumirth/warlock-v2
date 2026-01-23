import type { GoldQuery, EvalResult } from './types.js';
import { GOLDEN_QUERIES } from './golden-queries.js';
import { calculateMetrics } from './metrics.js';
import { generateReport } from './report.js';

interface ApiSearchResult {
  id: string;
  title: string;
  subject: string;
  number: string;
  avg_gpa?: number;
  gened?: string;
  _score: number;
}

interface SearchResponse {
  results: ApiSearchResult[];
  meta: {
    plan: {
      filters: Record<string, unknown>;
    };
    extraction: {
      hints: unknown[];
    };
    query: {
      residual: string;
    };
  };
}

function checkInvariants(query: GoldQuery, results: ApiSearchResult[]): string[] {
  const violations: string[] = [];
  if (!query.invariants) return violations;

  for (const result of results) {
    if (query.invariants.subject && result.subject !== query.invariants.subject) {
      violations.push(`Result ${result.id} has subject=${result.subject}, expected ${query.invariants.subject}`);
    }

    if (query.invariants.level_gte) {
      const level = parseInt(result.number.charAt(0)) * 100;
      if (level < query.invariants.level_gte) {
        violations.push(`Result ${result.id} is level ${level}, expected >= ${query.invariants.level_gte}`);
      }
    }

    if (query.invariants.level_lte) {
      const level = parseInt(result.number.charAt(0)) * 100;
      if (level > query.invariants.level_lte) {
        violations.push(`Result ${result.id} is level ${level}, expected <= ${query.invariants.level_lte}`);
      }
    }

    if (query.invariants.no_subject && result.subject === query.invariants.no_subject) {
      violations.push(`Result ${result.id} has forbidden subject=${result.subject}`);
    }
  }

  return violations;
}

function calculateReciprocalRank(query: GoldQuery, results: ApiSearchResult[]): number | null {
  if (!query.expected_top1 && !query.expected_top1_title) {
    return null;
  }

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const result = results[i];

    if (query.expected_top1) {
      // Match by ID pattern (e.g., "CS-225-*")
      const pattern = query.expected_top1.replace('*', '.*');
      if (new RegExp(`^${pattern}$`).test(result.id)) {
        return 1 / (i + 1);
      }
    }

    if (query.expected_top1_title) {
      if (result.title.toLowerCase().includes(query.expected_top1_title.toLowerCase())) {
        return 1 / (i + 1);
      }
    }
  }

  return 0;  // Not found in top 10
}

export async function runEvaluation(baseUrl: string): Promise<void> {
  console.log(`Running evaluation against ${baseUrl}...`);
  console.log(`Total queries: ${GOLDEN_QUERIES.length}\n`);

  const evalResults: EvalResult[] = [];

  for (const query of GOLDEN_QUERIES) {
    try {
      const url = `${baseUrl}/api/search?q=${encodeURIComponent(query.query)}&limit=20`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as SearchResponse;
      const results = data.results;

      const violations = checkInvariants(query, results);
      const reciprocalRank = calculateReciprocalRank(query, results);

      evalResults.push({
        query,
        actualFilters: data.meta.plan.filters,
        actualResidual: data.meta.query.residual,
        results,
        reciprocalRank,
        violations,
        tierReached: 0  // TODO: extract from meta
      });

      // Progress indicator
      const status = violations.length > 0 ? '✗' : '✓';
      const rankStatus = (query.expected_top1 || query.expected_top1_title) ? ` (RR: ${reciprocalRank?.toFixed(2)})` : '';
      console.log(`${status} [${query.id}] "${query.query}" - ${results.length} results, ${violations.length} violations${rankStatus}`);

    } catch (error) {
      console.error(`✗ [${query.id}] "${query.query}" - ERROR: ${error}`);
      evalResults.push({
        query,
        actualFilters: {},
        actualResidual: '',
        results: [],
        reciprocalRank: 0,
        violations: [`Fetch error: ${error}`],
        tierReached: 0
      });
    }
  }

  const metrics = calculateMetrics(evalResults);
  console.log(generateReport(metrics));
}

// CLI entry point
declare const process: any;
const baseUrl = process.argv[2] || 'http://localhost:8787';
runEvaluation(baseUrl).catch(console.error);
