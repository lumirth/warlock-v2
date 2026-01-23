import type { GoldQuery, EvalResult } from './types.js';
import { GOLDEN_QUERIES } from './golden-queries.js';
import { calculateMetrics } from './metrics.js';
import { generateReport } from './report.js';

interface SearchResult {
  course: {
    id: string;
    title: string;
    subject: string;
    number: string;
    avg_gpa?: number;
  };
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
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

function checkInvariants(query: GoldQuery, results: SearchResult[]): string[] {
  const violations: string[] = [];
  if (!query.invariants) return violations;

  for (const result of results) {
    const course = result.course;

    if (query.invariants.subject && course.subject !== query.invariants.subject) {
      violations.push(`Result ${course.id} has subject=${course.subject}, expected ${query.invariants.subject}`);
    }

    if (query.invariants.level_gte) {
      const level = parseInt(course.number.charAt(0)) * 100;
      if (level < query.invariants.level_gte) {
        violations.push(`Result ${course.id} is level ${level}, expected >= ${query.invariants.level_gte}`);
      }
    }

    if (query.invariants.level_lte) {
      const level = parseInt(course.number.charAt(0)) * 100;
      if (level > query.invariants.level_lte) {
        violations.push(`Result ${course.id} is level ${level}, expected <= ${query.invariants.level_lte}`);
      }
    }

    if (query.invariants.no_subject && course.subject === query.invariants.no_subject) {
      violations.push(`Result ${course.id} has forbidden subject=${course.subject}`);
    }
  }

  return violations;
}

function calculateReciprocalRank(query: GoldQuery, results: SearchResult[]): number | null {
  if (!query.expected_top1 && !query.expected_top1_title) {
    return null;
  }

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const course = results[i].course;

    if (query.expected_top1) {
      // Match by ID pattern (e.g., "CS-225-*")
      const pattern = query.expected_top1.replace('*', '.*');
      if (new RegExp(`^${pattern}$`).test(course.id)) {
        return 1 / (i + 1);
      }
    }

    if (query.expected_top1_title) {
      if (course.title.toLowerCase().includes(query.expected_top1_title.toLowerCase())) {
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
      const data = await response.json() as SearchResponse;

      const results = data.results.map(r => ({
        id: r.course.id,
        title: r.course.title,
        subject: r.course.subject,
        number: r.course.number,
        avg_gpa: r.course.avg_gpa
      }));

      const violations = checkInvariants(query, data.results);
      const reciprocalRank = calculateReciprocalRank(query, data.results);

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
      console.log(`${status} [${query.id}] "${query.query}" - ${results.length} results, ${violations.length} violations`);

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
