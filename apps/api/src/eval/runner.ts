import type { EvalResult } from './types.js';
import { GOLDEN_QUERIES } from './golden-queries.js';
import { calculateMetrics } from './metrics.js';
import { generateReport } from './report.js';
import {
  evaluatePublicSearchResponse,
  evaluateSearchResponse,
  type SearchResponseForEval,
} from './checks.js';

const REMOTE_EVAL_REQUEST_DELAY_MS = 650;
const RATE_LIMIT_RETRY_FALLBACK_MS = 65_000;
const MAX_RATE_LIMIT_RETRIES = 2;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Sleeper = (ms: number) => Promise<void>;
type EvalMode = 'debug' | 'public';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeQueryParam(value: string): string {
  return encodeURIComponent(value).replace(/'/g, '%27');
}

function retryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isNaN(dateMs)) return null;

  return Math.max(0, dateMs - Date.now());
}

export function requestDelayForBaseUrl(baseUrl: string): number {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::|\/|$)/i.test(baseUrl)
    ? 0
    : REMOTE_EVAL_REQUEST_DELAY_MS;
}

export function evalModeForEnvironment(env: Record<string, string | undefined>): EvalMode {
  if (env.EVAL_MODE === 'debug' || env.EVAL_MODE === 'public') {
    return env.EVAL_MODE;
  }

  return env.EVAL_ADMIN_TOKEN || env.STAGING_ADMIN_TOKEN ? 'debug' : 'public';
}

export function evalRequestUrl(
  baseUrl: string,
  query: string,
  mode: EvalMode,
): string {
  const encodedQuery = encodeQueryParam(query);
  return mode === 'debug'
    ? `${baseUrl}/admin/debug/search-plan?q=${encodedQuery}&limit=20`
    : `${baseUrl}/api/search?q=${encodedQuery}&limit=20`;
}

export async function fetchWithRateLimitRetry(
  url: string,
  options: {
    fetcher?: Fetcher;
    init?: RequestInit;
    sleeper?: Sleeper;
    maxRetries?: number;
  } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? sleep;
  const maxRetries = options.maxRetries ?? MAX_RATE_LIMIT_RETRIES;

  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, options.init);
    if (response.status !== 429 || attempt >= maxRetries) {
      return response;
    }

    const waitMs = retryAfterMs(response) ?? RATE_LIMIT_RETRY_FALLBACK_MS;
    console.warn(
      `HTTP 429 from eval target; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${maxRetries}.`
    );
    await sleeper(waitMs);
  }
}

export async function runEvaluation(baseUrl: string): Promise<EvalResult[]> {
  console.log(`Running evaluation against ${baseUrl}...`);
  console.log(`Total queries: ${GOLDEN_QUERIES.length}\n`);

  const evalResults: EvalResult[] = [];
  const requestDelayMs = requestDelayForBaseUrl(baseUrl);
  const adminToken = process.env.EVAL_ADMIN_TOKEN ?? process.env.STAGING_ADMIN_TOKEN;
  const evalMode = evalModeForEnvironment(process.env);
  const requestInit = adminToken
    ? { headers: { Authorization: `Bearer ${adminToken}` } }
    : undefined;
  console.log(
    evalMode === 'debug'
      ? 'Eval mode: debug parse + public result coherence'
      : 'Eval mode: public result coherence only'
  );

  for (const [index, query] of GOLDEN_QUERIES.entries()) {
    try {
      const url = evalRequestUrl(baseUrl, query.query, evalMode);
      const response = await fetchWithRateLimitRetry(url, { init: requestInit });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as SearchResponseForEval;
      const result = evalMode === 'debug'
        ? evaluateSearchResponse(query, data)
        : evaluatePublicSearchResponse(query, data);
      evalResults.push(result);

      // Progress indicator
      const status = result.violations.length > 0 ? 'FAIL' : 'PASS';
      const rankStatus = (query.expected_top1 || query.expected_top1_title) ? ` (RR: ${result.reciprocalRank?.toFixed(2)})` : '';
      console.log(`${status} [${query.id}] "${query.query}" - ${result.results.length} results, ${result.parseViolations.length} parse violations, ${result.resultViolations.length} result violations${rankStatus}`);
      for (const violation of result.violations) {
        console.log(`  - ${violation}`);
      }

    } catch (error) {
      console.error(`FAIL [${query.id}] "${query.query}" - ERROR: ${error}`);
      evalResults.push({
        query,
        actualFilters: {},
        actualResidual: '',
        results: [],
        reciprocalRank: 0,
        violations: [`Fetch error: ${error}`],
        parseViolations: [`Fetch error: ${error}`],
        resultViolations: [],
        tierReached: null
      });
    }

    if (requestDelayMs > 0 && index < GOLDEN_QUERIES.length - 1) {
      await sleep(requestDelayMs);
    }
  }

  const metrics = calculateMetrics(evalResults);
  console.log(generateReport(metrics));
  return evalResults;
}

// CLI entry point
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

function isCliEntryPoint(argv: string[]): boolean {
  const entry = argv[1] ?? '';
  return /(?:^|[/\\])runner\.(?:ts|js)$/.test(entry);
}

if (isCliEntryPoint(process.argv)) {
  const baseUrl = process.argv[2] || 'http://localhost:8787';
  runEvaluation(baseUrl)
    .then((results) => {
      const metrics = calculateMetrics(results);

      if (metrics.violationCount > 0 || metrics.missingExpectedTopCount > 0) {
        console.error(
          `Evaluation failed: ${metrics.violationCount} violations, ${metrics.missingExpectedTopCount} missing expected top results.`
        );
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
