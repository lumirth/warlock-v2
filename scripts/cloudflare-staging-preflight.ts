import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { STAGING_SMOKE_CHECK_NAMES } from './staging-smoke.js';

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

type Args = {
  reportPath: string;
  smokeResultsPath: string;
  wranglerConfigPath: string;
  apiDir: string;
};

const DEFAULT_REPORT = 'docs/reports/2026-06-01-stabilization-report.md';
const DEFAULT_SMOKE_RESULTS = 'artifacts/staging-smoke-results.json';
const DEFAULT_WRANGLER_CONFIG = 'apps/api/wrangler.toml';
const DEFAULT_API_DIR = 'apps/api';

const REQUIRED_STAGING_ENV = [
  'STAGING_API_BASE_URL',
  'STAGING_ADMIN_TOKEN',
  'STAGING_INTERNAL_TOKEN',
  'EVAL_BASE_URL',
];

const REQUIRED_SMOKE_CHECKS = STAGING_SMOKE_CHECK_NAMES;

function result(name: string, ok: boolean, detail: string): CheckResult {
  return { name, ok, detail };
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function blockFor(text: string, header: string): string {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}\\s*$`, 'm').exec(text);
  if (!match) return '';
  const start = match.index;
  const rest = text.slice(start + match[0].length);
  const nextHeader = /^\s*\[/.exec(rest);
  return nextHeader ? text.slice(start, start + match[0].length + nextHeader.index) : text.slice(start);
}

function stringValue(block: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}\\s*=\\s*"([^"]+)"`, 'm').exec(block)?.[1] ?? null;
}

function isPlaceholder(value: string | null): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return normalized.includes('placeholder')
    || normalized.includes('replace')
    || normalized.includes('example')
    || normalized.includes('changeme')
    || normalized.includes('<')
    || normalized.includes('>');
}

function hasRepeatedCharacterOnly(value: string): boolean {
  const stripped = value.replace(/-/g, '');
  return stripped.length > 0 && stripped.split('').every(char => char === stripped[0]);
}

function isRealUuid(value: string | null): boolean {
  return Boolean(value)
    && !isPlaceholder(value)
    && !hasRepeatedCharacterOnly(value!)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value!);
}

function isRealHexId(value: string | null): boolean {
  return Boolean(value)
    && !isPlaceholder(value)
    && !hasRepeatedCharacterOnly(value!)
    && /^[0-9a-f]{32}$/i.test(value!);
}

function labelValue(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? null;
}

function isRealHttpsUrl(value: string | null): boolean {
  if (!value || isPlaceholder(value)) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && hostname.length > 0
      && hostname !== 'example.com'
      && !hostname.endsWith('.example')
      && !hostname.includes('.example.')
      && !hostname.includes('localhost');
  } catch {
    return false;
  }
}

function isRealCloudflareRuleId(value: string | null): boolean {
  if (!value || isPlaceholder(value)) return false;

  return isRealHexId(value)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasRealRateLimitNamespaceIds(value: string | null): boolean {
  if (!value || isPlaceholder(value)) return false;
  const ids = value.match(/\b[1-9][0-9]{3,}\b/g) ?? [];
  return ids.length >= 2 && new Set(ids).size >= 2;
}

function isTimestampBackupRef(value: string | null): boolean {
  return Boolean(value) && /^[0-9]{8}T[0-9]{6}Z$/i.test(value!);
}

function isRealBackupLocation(value: string | null, backupRef: string | null): boolean {
  return Boolean(value)
    && !isPlaceholder(value)
    && Boolean(backupRef)
    && value!.includes(backupRef!);
}

function hasPublicReadRoutes(value: string | null): boolean {
  if (!value || isPlaceholder(value)) return false;
  const normalized = value.toLowerCase();
  return normalized.includes('/api/search') && normalized.includes('/api/course');
}

function hasEnforcingAction(value: string | null): boolean {
  if (!value || isPlaceholder(value)) return false;
  const normalized = value.toLowerCase();
  if (/\b(?:log|logging|monitor|count|observe|audit)\b/.test(normalized)) {
    return false;
  }
  return /\b429\b/.test(normalized)
    || /\bblock(?:ed|ing)?\b/.test(normalized)
    || /\bmanaged_challenge\b/.test(normalized)
    || /\bjs_challenge\b/.test(normalized)
    || /\bchallenge\b/.test(normalized);
}

function hasThresholdEvidence(value: string | null): boolean {
  if (!value || isPlaceholder(value) || !hasPublicReadRoutes(value)) return false;
  const normalized = value.toLowerCase();
  const thresholdMentions = normalized.match(/\d+\s*(?:(?:requests?)?\s*\/\s*)?(?:minute|min)/g) ?? [];
  return thresholdMentions.length >= 2 && normalized.includes('ip');
}

function stripAnsi(text: string): string {
  return text
    .split(String.fromCharCode(27))
    .map((part, index) => index === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))
    .join('');
}

function presentEnv(name: string, env: NodeJS.ProcessEnv): CheckResult {
  return result(
    `env ${name}`,
    Boolean(env[name]),
    env[name] ? 'set' : 'missing'
  );
}

export function checkRequiredEnv(env: NodeJS.ProcessEnv = process.env): CheckResult[] {
  return REQUIRED_STAGING_ENV.map(name => presentEnv(name, env));
}

export function checkWranglerAuth(apiDir: string = DEFAULT_API_DIR): CheckResult {
  const command = spawnSync('npx', ['wrangler', 'whoami'], {
    cwd: apiDir,
    encoding: 'utf8',
  });

  if (command.status === 0) {
    const firstLine = command.stdout.split('\n').find(line => line.trim().length > 0);
    return result('wrangler auth', true, firstLine ?? 'authenticated');
  }

  const output = stripAnsi(`${command.stdout}\n${command.stderr}`)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.includes('/.wrangler/logs/'))
    .slice(-3)
    .join(' ');
  return result('wrangler auth', false, output || 'wrangler whoami failed');
}

export function checkStagingConfigText(text: string): CheckResult[] {
  const stagingBlock = blockFor(text, '[env.staging]');
  const d1Block = blockFor(text, '[[env.staging.d1_databases]]');
  const kvBlock = blockFor(text, '[[env.staging.kv_namespaces]]');
  const vectorizeBlock = blockFor(text, '[[env.staging.vectorize]]');
  const serviceBlock = blockFor(text, '[[env.staging.services]]');
  const hasSearchRateLimit = has(text, /\[\[env\.staging\.ratelimits\]\][\s\S]*?name\s*=\s*"SEARCH_RATE_LIMITER"[\s\S]*?namespace_id\s*=\s*"[1-9][0-9]{3,}"[\s\S]*?\[env\.staging\.ratelimits\.simple\][\s\S]*?limit\s*=\s*120[\s\S]*?period\s*=\s*60/m);
  const hasCourseRateLimit = has(text, /\[\[env\.staging\.ratelimits\]\][\s\S]*?name\s*=\s*"COURSE_RATE_LIMITER"[\s\S]*?namespace_id\s*=\s*"[1-9][0-9]{3,}"[\s\S]*?\[env\.staging\.ratelimits\.simple\][\s\S]*?limit\s*=\s*240[\s\S]*?period\s*=\s*60/m);

  return [
    result('wrangler env.staging block', stagingBlock.length > 0, 'requires [env.staging]'),
    result('staging worker name', stringValue(stagingBlock, 'name') === 'uiuc-course-search-staging', 'requires uiuc-course-search-staging'),
    result('staging D1 binding', d1Block.length > 0, 'requires env.staging.d1_databases'),
    result('staging D1 database', stringValue(d1Block, 'database_name') === 'course-search-db-staging', 'requires course-search-db-staging'),
    result('staging D1 id', isRealUuid(stringValue(d1Block, 'database_id')), 'requires real non-secret D1 id'),
    result('staging KV binding', kvBlock.length > 0, 'requires env.staging.kv_namespaces'),
    result('staging KV id', isRealHexId(stringValue(kvBlock, 'id')), 'requires real non-secret KV namespace id'),
    result('staging Vectorize binding', vectorizeBlock.length > 0, 'requires env.staging.vectorize'),
    result('staging Vectorize index', stringValue(vectorizeBlock, 'index_name') === 'course-embeddings-staging', 'requires course-embeddings-staging'),
    result('staging AI binding', has(text, /^\[env\.staging\.ai\]/m), 'requires env.staging.ai'),
    result('staging SELF service binding', serviceBlock.length > 0, 'requires env.staging.services'),
    result('staging SELF service name', stringValue(serviceBlock, 'service') === 'uiuc-course-search-staging', 'requires staging SELF service target'),
    result('staging search rate-limit binding', hasSearchRateLimit, 'requires SEARCH_RATE_LIMITER 120/60s staging binding'),
    result('staging course rate-limit binding', hasCourseRateLimit, 'requires COURSE_RATE_LIMITER 240/60s staging binding'),
  ];
}

export function checkStagingConfig(path: string = DEFAULT_WRANGLER_CONFIG): CheckResult[] {
  if (!existsSync(path)) {
    return [result('wrangler staging config', false, `${path} does not exist`)];
  }
  return checkStagingConfigText(readFileSync(path, 'utf8'));
}

type SmokeResult = {
  name?: unknown;
  ok?: unknown;
};

export function checkSmokeResultsText(text: string): CheckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return result('staging smoke artifact', false, 'invalid JSON');
  }

  if (!Array.isArray(parsed)) {
    return result('staging smoke artifact', false, 'expected results array');
  }

  const results = parsed as SmokeResult[];
  const failed = results.filter(item => item.ok !== true).map(item => String(item.name ?? 'unnamed'));
  const names = new Set(results.map(item => String(item.name ?? '')));
  const missing = REQUIRED_SMOKE_CHECKS.filter(name => !names.has(name));

  if (failed.length > 0) {
    return result('staging smoke artifact', false, `failed checks: ${failed.join(', ')}`);
  }
  if (missing.length > 0) {
    return result('staging smoke artifact', false, `missing checks: ${missing.join(', ')}`);
  }
  return result('staging smoke artifact', true, `${results.length} checks passed`);
}

export function checkSmokeResults(path: string = DEFAULT_SMOKE_RESULTS): CheckResult {
  if (!existsSync(path)) {
    return result('staging smoke artifact', false, `${path} does not exist`);
  }
  return checkSmokeResultsText(readFileSync(path, 'utf8'));
}

export function checkEvidenceReportText(text: string): CheckResult[] {
  const stagingUrl = labelValue(text, 'Staging API URL');
  const stagingWebUrl = labelValue(text, 'Staging Web URL');
  const pagesProject = labelValue(text, 'Pages Project');
  const pagesBranch = labelValue(text, 'Pages Branch');
  const wafRuleId = labelValue(text, 'WAF Rule ID');
  const rateLimitRuleId = labelValue(text, 'Rate-Limit Rule ID');
  const rateLimitNamespaceIds = labelValue(text, 'Rate-Limit Namespace IDs')
    ?? labelValue(text, 'Worker Rate-Limit Binding IDs');
  const abuseRoutes = labelValue(text, 'Abuse Control Routes')
    ?? labelValue(text, 'WAF Protected Routes')
    ?? labelValue(text, 'Rate-Limit Protected Routes');
  const abuseAction = labelValue(text, 'Abuse Control Action')
    ?? labelValue(text, 'WAF Action')
    ?? labelValue(text, 'Rate-Limit Action');
  const abuseThresholds = labelValue(text, 'Abuse Control Thresholds')
    ?? labelValue(text, 'Rate-Limit Thresholds');
  const backupRef = labelValue(text, 'D1 Backup Ref');
  const backupMechanism = labelValue(text, 'D1 Backup Mechanism');
  const backupLocation = labelValue(text, 'D1 Backup Location') ?? labelValue(text, 'D1 Backup Path');
  const restoreDatabase = labelValue(text, 'D1 Restore Database');
  const restoreVerified = labelValue(text, 'D1 Restore Verified');
  const usesTimeTravel = backupMechanism?.toLowerCase().includes('time travel') ?? false;

  return [
    result(
      'staging URL evidence',
      isRealHttpsUrl(stagingUrl),
      'requires real non-placeholder HTTPS Staging API URL'
    ),
    result(
      'staging web URL evidence',
      isRealHttpsUrl(stagingWebUrl),
      'requires real non-placeholder HTTPS Staging Web URL'
    ),
    result(
      'Pages project evidence',
      pagesProject === 'uiuc-course-search-web',
      'requires Pages Project: uiuc-course-search-web'
    ),
    result(
      'Pages branch evidence',
      pagesBranch === 'staging',
      'requires Pages Branch: staging'
    ),
    result(
      'WAF or rate-limit rule evidence',
      isRealCloudflareRuleId(wafRuleId) || isRealCloudflareRuleId(rateLimitRuleId) || hasRealRateLimitNamespaceIds(rateLimitNamespaceIds),
      'requires real-looking WAF Rule ID, Rate-Limit Rule ID, or Workers rate-limit namespace IDs'
    ),
    result(
      'WAF or rate-limit route coverage evidence',
      hasPublicReadRoutes(abuseRoutes),
      'requires Abuse Control Routes covering /api/search and /api/course'
    ),
    result(
      'WAF or rate-limit action evidence',
      hasEnforcingAction(abuseAction),
      'requires enforcing block or challenge action'
    ),
    result(
      'WAF or rate-limit threshold evidence',
      hasThresholdEvidence(abuseThresholds),
      'requires per-IP minute thresholds for /api/search and /api/course'
    ),
    result(
      'D1 backup ref evidence',
      isTimestampBackupRef(backupRef),
      'requires timestamped D1 Backup Ref'
    ),
    result(
      'D1 backup location evidence',
      isRealBackupLocation(backupLocation, backupRef),
      'requires D1 Backup Location or D1 Backup Path containing the backup ref'
    ),
    result(
      'D1 restore target evidence',
      usesTimeTravel
        ? restoreDatabase === 'course-search-db-staging'
        : /^course-search-db-staging-restore-[0-9]{8}T[0-9]{6}Z$/i.test(restoreDatabase ?? ''),
      usesTimeTravel
        ? 'requires Time Travel restore target database name'
        : 'requires restore-test D1 database name'
    ),
    result(
      'D1 restore verification evidence',
      restoreVerified?.toLowerCase() === 'yes',
      'requires D1 Restore Verified: yes'
    ),
  ];
}

export function checkEvidenceReport(path: string = DEFAULT_REPORT): CheckResult[] {
  if (!existsSync(path)) {
    return [result('staging evidence report', false, `${path} does not exist`)];
  }
  return checkEvidenceReportText(readFileSync(path, 'utf8'));
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    reportPath: DEFAULT_REPORT,
    smokeResultsPath: DEFAULT_SMOKE_RESULTS,
    wranglerConfigPath: DEFAULT_WRANGLER_CONFIG,
    apiDir: DEFAULT_API_DIR,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (!next) continue;
    if (current === '--report') {
      args.reportPath = next;
      i += 1;
    } else if (current === '--smoke-results') {
      args.smokeResultsPath = next;
      i += 1;
    } else if (current === '--wrangler-config') {
      args.wranglerConfigPath = next;
      i += 1;
    } else if (current === '--api-dir') {
      args.apiDir = next;
      i += 1;
    }
  }

  return args;
}

function formatResults(results: CheckResult[]): string {
  const failed = results.filter(item => !item.ok);
  const lines = [
    '# Cloudflare Staging Preflight',
    '',
    `Total checks: ${results.length}`,
    `Passing checks: ${results.length - failed.length}`,
    `Failed checks: ${failed.length}`,
    '',
    '## Checks',
    '',
  ];

  for (const item of results) {
    lines.push(`- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const results = [
    checkWranglerAuth(args.apiDir),
    ...checkStagingConfig(args.wranglerConfigPath),
    ...checkRequiredEnv(),
    checkSmokeResults(args.smokeResultsPath),
    ...checkEvidenceReport(args.reportPath),
  ];

  console.log(formatResults(results));

  if (results.some(item => !item.ok)) {
    throw new Error(`Cloudflare staging preflight failed from ${cwd}.`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
