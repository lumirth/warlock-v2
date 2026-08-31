import { evaluateScenario } from './checks.js';
import { EVAL_SCENARIOS } from './scenarios.js';

const REMOTE_DELAY_MS = 650;
const RATE_LIMIT_FALLBACK_MS = 65_000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Sleeper = (ms: number) => Promise<void>;

export type EvalFailure = {
  scenario: string;
  query: string;
  failures: string[];
};

const sleep: Sleeper = ms => new Promise(resolve => setTimeout(resolve, ms));

export function evalRequestUrl(baseUrl: string, query: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/search?q=${encodeURIComponent(query).replace(/'/g, '%27')}&limit=20`;
}

function retryDelay(response: Response): number {
  const value = response.headers.get('Retry-After');
  if (!value) return RATE_LIMIT_FALLBACK_MS;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? RATE_LIMIT_FALLBACK_MS : Math.max(0, date - Date.now());
}

export async function fetchWithRateLimitRetry(
  url: string,
  options: { fetcher?: Fetcher; sleeper?: Sleeper; retries?: number } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? sleep;
  const retries = options.retries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetcher(url);
    if (response.status !== 429 || attempt >= retries) return response;
    await sleeper(retryDelay(response));
  }
}

export async function runEvaluation(
  baseUrl: string,
  options: { fetcher?: Fetcher; sleeper?: Sleeper; delayMs?: number } = {},
): Promise<EvalFailure[]> {
  const failures: EvalFailure[] = [];
  const cases = EVAL_SCENARIOS.flatMap(scenario =>
    scenario.queries.map(query => ({ scenario, query }))
  );
  const remote = !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(baseUrl);

  for (const [index, item] of cases.entries()) {
    const failure = await evaluateCase(baseUrl, item, options);
    if (failure) failures.push(failure);
    if (remote && index < cases.length - 1) {
      await (options.sleeper ?? sleep)(options.delayMs ?? REMOTE_DELAY_MS);
    }
  }

  return failures;
}

async function evaluateCase(
  baseUrl: string,
  item: { scenario: typeof EVAL_SCENARIOS[number]; query: string },
  options: { fetcher?: Fetcher; sleeper?: Sleeper; delayMs?: number },
): Promise<EvalFailure | null> {
  let failures: string[];
  try {
    const response = await fetchWithRateLimitRetry(evalRequestUrl(baseUrl, item.query), options);
    const body = await response.json().catch(() => undefined);
    failures = response.ok ? evaluateScenario(item.scenario, body) : [`HTTP ${response.status}`];
  } catch (error) {
    failures = [error instanceof Error ? error.message : String(error)];
  }
  return failures.length ? { scenario: item.scenario.name, query: item.query, failures } : null;
}

declare const process: {
  argv: string[];
  exitCode?: number;
};

if (/(?:^|[/\\])runner\.(?:ts|js)$/.test(process.argv[1] ?? '')) {
  const baseUrl = process.argv[2] ?? 'http://localhost:8787';
  runEvaluation(baseUrl).then((failures) => {
    if (failures.length === 0) {
      console.log(`Public search eval passed against ${baseUrl}.`);
      return;
    }
    for (const failure of failures) {
      console.error(`FAIL ${failure.scenario} (${JSON.stringify(failure.query)}): ${failure.failures.join('; ')}`);
    }
    process.exitCode = 1;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
