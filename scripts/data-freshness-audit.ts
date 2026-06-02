import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

type Args = {
  input?: string;
  output?: string;
  minHistoricalTerms: number;
  requireRmp: boolean;
};

type JsonRecord = Record<string, unknown>;

export type FreshnessAuditCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type FreshnessAuditReport = {
  generated_at: string;
  source: string;
  checks: FreshnessAuditCheck[];
};

const DEFAULT_MIN_HISTORICAL_TERMS = 1;

function usage(): string {
  return [
    'Data freshness audit',
    '',
    'Usage:',
    '  npm run data:freshness:audit -- --input artifacts/sync-status.json [--output artifacts/data-freshness-audit.json]',
    '  STAGING_API_BASE_URL=... STAGING_ADMIN_TOKEN=... npm run data:freshness:audit',
    '',
    'Options:',
    `  --min-historical-terms <n>  Required historical term count. Default: ${DEFAULT_MIN_HISTORICAL_TERMS}`,
    '  --no-require-rmp            Do not fail when RMP sync state is absent or stale.',
  ].join('\n');
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    minHistoricalTerms: DEFAULT_MIN_HISTORICAL_TERMS,
    requireRmp: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--input' && next) {
      args.input = next;
      index += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      index += 1;
    } else if (arg === '--min-historical-terms' && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('--min-historical-terms must be a non-negative integer');
      }
      args.minHistoricalTerms = parsed;
      index += 1;
    } else if (arg === '--no-require-rmp') {
      args.requireRmp = false;
    }
  }

  return args;
}

function check(name: string, ok: boolean, detail: string): FreshnessAuditCheck {
  return { name, ok, detail };
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function syncStates(status: JsonRecord): JsonRecord[] {
  return Array.isArray(status.syncStates)
    ? status.syncStates.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function termStates(status: JsonRecord): JsonRecord[] {
  return Array.isArray(status.termStates)
    ? status.termStates.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

function syncStateById(status: JsonRecord, id: string): JsonRecord | null {
  return syncStates(status).find(state => state.id === id) ?? null;
}

function termStateById(status: JsonRecord, id: string): JsonRecord | null {
  return termStates(status).find(state => state.term_id === id) ?? null;
}

function positiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function auditFreshnessStatus(
  status: JsonRecord,
  options: { minHistoricalTerms?: number; requireRmp?: boolean } = {}
): FreshnessAuditCheck[] {
  const minHistoricalTerms = options.minHistoricalTerms ?? DEFAULT_MIN_HISTORICAL_TERMS;
  const requireRmp = options.requireRmp ?? true;
  const freshness = asRecord(status.freshness);
  const currentTermId = typeof freshness?.currentTermId === 'string' ? freshness.currentTermId : null;
  const activeTermIds = asStringArray(freshness?.activeTermIds);
  const upcomingTermIds = asStringArray(freshness?.upcomingTermIds);
  const staleTermIds = asStringArray(freshness?.staleTermIds);
  const staleSyncStateIds = asStringArray(freshness?.staleSyncStateIds);
  const historicalTermCount = typeof freshness?.historicalTermCount === 'number' ? freshness.historicalTermCount : null;
  const gpaState = syncStateById(status, 'gpa');
  const rmpState = syncStateById(status, 'rmp');
  const currentTermState = currentTermId ? termStateById(status, currentTermId) : null;

  const checks = [
    check('freshness object present', freshness !== null, freshness ? 'ok' : 'missing freshness summary'),
    check('current term present', freshness?.currentTermPresent === true, String(freshness?.currentTermId ?? 'missing currentTermId')),
    check('active term coverage', activeTermIds.length > 0, `${activeTermIds.length} active term(s)`),
    check('upcoming term field present', Array.isArray(freshness?.upcomingTermIds), `${upcomingTermIds.length} upcoming term(s)`),
    check(
      'historical term coverage',
      historicalTermCount !== null && historicalTermCount >= minHistoricalTerms,
      `${historicalTermCount ?? 'missing'} historical term(s), required ${minHistoricalTerms}`
    ),
    check('no stale terms', staleTermIds.length === 0, staleTermIds.length ? staleTermIds.join(', ') : 'ok'),
    check('no stale sync states', staleSyncStateIds.length === 0, staleSyncStateIds.length ? staleSyncStateIds.join(', ') : 'ok'),
    check('gpa sync state fresh', Boolean(gpaState) && !staleSyncStateIds.includes('gpa'), gpaState ? String(gpaState.last_status ?? 'unknown') : 'missing'),
  ];

  if (currentTermState) {
    checks.push(check(
      'current term has course and section counts',
      positiveNumber(currentTermState.courses_count) && positiveNumber(currentTermState.sections_count),
      `courses=${String(currentTermState.courses_count)} sections=${String(currentTermState.sections_count)}`
    ));
  }

  if (requireRmp) {
    checks.push(check('rmp sync state fresh', Boolean(rmpState) && !staleSyncStateIds.includes('rmp'), rmpState ? String(rmpState.last_status ?? 'unknown') : 'missing'));
  }

  return checks;
}

export function formatFreshnessAuditReport(report: FreshnessAuditReport): string {
  const failed = report.checks.filter(item => !item.ok);
  const lines = [
    '# Data Freshness Audit',
    '',
    `Generated at: ${report.generated_at}`,
    `Source: ${report.source}`,
    `Total checks: ${report.checks.length}`,
    `Passing checks: ${report.checks.length - failed.length}`,
    `Failed checks: ${failed.length}`,
    '',
    '## Checks',
    '',
  ];

  for (const result of report.checks) {
    lines.push(`- ${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`);
  }

  return `${lines.join('\n')}\n`;
}

async function loadStatus(args: Args): Promise<{ source: string; status: JsonRecord }> {
  if (args.input) {
    const body = await readFile(args.input, 'utf8');
    const parsed = JSON.parse(body) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      throw new Error('--input must contain a JSON object from /admin/sync/status');
    }
    return { source: args.input, status: record };
  }

  const baseUrl = process.env.STAGING_API_BASE_URL;
  const adminToken = process.env.STAGING_ADMIN_TOKEN;
  if (!baseUrl || !adminToken) {
    console.error(usage());
    throw new Error('Provide --input or STAGING_API_BASE_URL and STAGING_ADMIN_TOKEN');
  }

  const url = new URL('admin/sync/status', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`sync status request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as unknown;
  const record = asRecord(body);
  if (!record) {
    throw new Error('sync status response must be a JSON object');
  }
  return { source: url.toString(), status: record };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { source, status } = await loadStatus(args);
  const report: FreshnessAuditReport = {
    generated_at: new Date().toISOString(),
    source,
    checks: auditFreshnessStatus(status, {
      minHistoricalTerms: args.minHistoricalTerms,
      requireRmp: args.requireRmp,
    }),
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = formatFreshnessAuditReport(report);

  if (args.output) {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, body);
    writeFileSync(args.output.replace(/\.json$/i, '.md'), markdown);
  } else {
    process.stdout.write(markdown);
  }

  if (report.checks.some(result => !result.ok)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
