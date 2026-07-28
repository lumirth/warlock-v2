import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import {
  SEARCH_TERM_VALUES,
  TERM_STATUS_VALUES,
} from '@uiuc-course-search/query-types';
import { runCli } from './lib/run-cli.ts';

const ADMIN_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_GPA_SYNC_CALLS = 1024;
const MAX_GPA_TRANSIENT_ATTEMPTS = 8;
const GPA_RETRY_MAX_DELAY_MS = 8_000;
const RELEASE_TERM_SYNC_PAGE_LIMIT = 5;
const MAX_RELEASE_TERM_SYNC_PAGES = 2_000;
const VALID_SEARCH_TERMS = new Set<string>(SEARCH_TERM_VALUES);
const VALID_TERM_STATUSES = new Set<string>(TERM_STATUS_VALUES);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(repoRoot, 'apps/api');

export type ReleaseTarget = 'staging' | 'production';

type ReleaseProfile = {
  target: ReleaseTarget;
  envPrefix: 'STAGING' | 'PRODUCTION';
  database?: string;
  apiHost: string;
  workerName: string;
  wranglerEnvironment?: 'staging';
};

const PRODUCTION_DATABASE_ALLOWLIST = new Set(['course-search-db-v2']);

const RELEASE_PROFILES: Record<ReleaseTarget, ReleaseProfile> = {
  staging: {
    target: 'staging',
    envPrefix: 'STAGING',
    database: 'course-search-db-staging',
    apiHost: 'uiuc-course-search-staging.lumirth.workers.dev',
    workerName: 'uiuc-course-search-staging',
    wranglerEnvironment: 'staging',
  },
  production: {
    target: 'production',
    envPrefix: 'PRODUCTION',
    apiHost: 'uiuc-course-search.lumirth.workers.dev',
    workerName: 'uiuc-course-search',
  },
};

export type ReleaseConfig = Omit<ReleaseProfile, 'database'> & {
  database: string;
  apiBaseUrl: string;
  adminToken: string;
  backupRef: string;
  backupEvidenceFile: string;
  approvedMigration: string;
  approvedMigrationSha256: string;
};

export type StagingReleaseConfig = ReleaseConfig;

export type ReleaseCommand = {
  command: string;
  args: string[];
  cwd: string;
  label: string;
};

export type GpaImportResult = {
  calls: number;
  rowsProcessed: number;
  completionKey: string;
};

export type ReleaseDiscoveredTerm = {
  termId: string;
  year: number;
  term: (typeof SEARCH_TERM_VALUES)[number];
  status: (typeof TERM_STATUS_VALUES)[number];
  sampleStatuses: string[];
};

export type ReleaseTermFinalization = {
  termId: string;
  subjectCount: number;
  coursesCount: number;
  sectionsCount: number;
  lastSynced: number;
};

function requiredEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  target: ReleaseTarget,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a ${target} API release.`);
  return value;
}

export function latestMigrationName(): string {
  const migrations = readdirSync(join(apiDir, 'migrations'))
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .sort();
  const latest = migrations.at(-1);
  if (!latest) throw new Error('No D1 migrations were found.');
  return latest.replace(/\.sql$/, '');
}

export function latestMigrationSha256(
  migrationName = latestMigrationName(),
): string {
  const migrationPath = join(
    apiDir,
    'migrations',
    `${migrationName}.sql`,
  );
  return createHash('sha256')
    .update(readFileSync(migrationPath))
    .digest('hex');
}

export function productionDatabaseFromWrangler(
  source = readFileSync(join(apiDir, 'wrangler.toml'), 'utf8'),
): string {
  const productionSource = source.split(/\n\[env\./, 1)[0] ?? '';
  const databaseBlocks = productionSource.match(
    /\[\[d1_databases\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
  ) ?? [];
  const dbBlock = databaseBlocks.find(block => (
    /\bbinding\s*=\s*["']DB["']/.test(block)
  ));
  const database = dbBlock?.match(
    /\bdatabase_name\s*=\s*["']([^"']+)["']/,
  )?.[1];
  if (!database) {
    throw new Error(
      'apps/api/wrangler.toml must define the production DB binding.',
    );
  }
  if (!PRODUCTION_DATABASE_ALLOWLIST.has(database)) {
    throw new Error(
      'Production releases require the replacement D1 database '
      + 'course-search-db-v2; legacy course-search-db is rollback-only.',
    );
  }
  return database;
}

function environmentVariable(profile: ReleaseProfile, suffix: string): string {
  return `${profile.envPrefix}_${suffix}`;
}

export function releaseConfig(
  target: ReleaseTarget,
  env: NodeJS.ProcessEnv = process.env,
  wranglerConfigSource?: string,
): ReleaseConfig {
  const baseProfile = RELEASE_PROFILES[target];
  const database = target === 'production'
    ? productionDatabaseFromWrangler(wranglerConfigSource)
    : baseProfile.database;
  if (!database) {
    throw new Error(`No D1 database is configured for ${target}.`);
  }
  const profile = { ...baseProfile, database };
  const apiBaseUrlVariable = environmentVariable(profile, 'API_BASE_URL');
  const apiBaseUrl = requiredEnv(env, apiBaseUrlVariable, target)
    .replace(/\/+$/, '');
  const parsedUrl = new URL(apiBaseUrl);
  if (
    parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname !== profile.apiHost
    || parsedUrl.port
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.pathname !== '/'
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new Error(
      `${apiBaseUrlVariable} must be exactly https://${profile.apiHost}.`,
    );
  }

  const migrationApprovalVariable = environmentVariable(
    profile,
    'MIGRATION_APPROVED',
  );
  const approvedMigration = requiredEnv(
    env,
    migrationApprovalVariable,
    target,
  );
  const latestMigration = latestMigrationName();
  if (approvedMigration !== latestMigration) {
    throw new Error(
      `${migrationApprovalVariable} must equal the current migration ${latestMigration}.`,
    );
  }
  const migrationShaApprovalVariable = environmentVariable(
    profile,
    'MIGRATION_SHA256_APPROVED',
  );
  const approvedMigrationSha256 = requiredEnv(
    env,
    migrationShaApprovalVariable,
    target,
  );
  const migrationSha256 = latestMigrationSha256(latestMigration);
  if (approvedMigrationSha256 !== migrationSha256) {
    throw new Error(
      `${migrationShaApprovalVariable} must equal the SHA-256 of `
      + `${latestMigration}.sql: ${migrationSha256}.`,
    );
  }

  return {
    ...profile,
    apiBaseUrl,
    adminToken: requiredEnv(
      env,
      environmentVariable(profile, 'ADMIN_TOKEN'),
      target,
    ),
    backupRef: requiredEnv(
      env,
      target === 'production' ? 'PRODUCTION_D1_BACKUP_REF' : 'D1_BACKUP_REF',
      target,
    ),
    backupEvidenceFile: resolve(
      repoRoot,
      requiredEnv(
        env,
        target === 'production'
          ? 'PRODUCTION_D1_BACKUP_EVIDENCE_FILE'
          : 'D1_BACKUP_EVIDENCE_FILE',
        target,
      ),
    ),
    approvedMigration,
    approvedMigrationSha256,
  };
}

export function stagingReleaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): StagingReleaseConfig {
  return releaseConfig('staging', env);
}

export function productionReleaseConfig(
  env: NodeJS.ProcessEnv = process.env,
  wranglerConfigSource?: string,
): ReleaseConfig {
  return releaseConfig('production', env, wranglerConfigSource);
}

export function releaseCommands(
  config: ReleaseConfig,
): ReleaseCommand[] {
  const environmentArgs = config.wranglerEnvironment
    ? ['--env', config.wranglerEnvironment]
    : [];
  return [
    {
      command: 'npm',
      args: ['run', 'check', '-w', '@uiuc-course-search/api'],
      cwd: repoRoot,
      label: 'API checks',
    },
    {
      command: 'npm',
      args: ['run', 'db:verify'],
      cwd: repoRoot,
      label: 'schema verification',
    },
    {
      command: 'npm',
      args: [
        'run',
        'd1:preflight',
        '--',
        '--database',
        config.database,
        '--backup-ref',
        config.backupRef,
        '--evidence-file',
        config.backupEvidenceFile,
        '--restore-verified',
      ],
      cwd: repoRoot,
      label: 'restore-tested D1 backup gate',
    },
    {
      command: 'npx',
      args: [
        'wrangler',
        'd1',
        'migrations',
        'apply',
        config.database,
        ...environmentArgs,
        '--remote',
      ],
      cwd: apiDir,
      label: `apply ${config.approvedMigration}`,
    },
    {
      command: 'npx',
      args: config.target === 'production'
        ? ['wrangler', 'deploy', '--name', config.workerName]
        : ['wrangler', 'deploy', ...environmentArgs],
      cwd: apiDir,
      label: `deploy ${config.target} Worker`,
    },
  ];
}

async function runCommand(step: ReleaseCommand): Promise<void> {
  console.log(`\n==> ${step.label}`);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(
        `${step.label} failed${signal ? ` from signal ${signal}` : ` with exit code ${code}`}.`,
      ));
    });
  });
}

async function requestJson(
  config: ReleaseConfig,
  path: string,
  options: { method?: 'GET' | 'POST'; admin?: boolean } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.admin
      ? { Authorization: `Bearer ${config.adminToken}` }
      : undefined,
    signal: AbortSignal.timeout(ADMIN_REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned invalid JSON.`);
  }
  return parsed as Record<string, unknown>;
}

function assertGpaSyncChunk(
  payload: Record<string, unknown>,
  call: number,
): {
  rowsProcessed: number;
  isComplete: boolean;
  completionKey: string | null;
} {
  if (payload.success !== true) {
    throw new Error(`GPA import chunk ${call} was unsuccessful.`);
  }
  if (
    !Number.isSafeInteger(payload.rowsProcessed)
    || (payload.rowsProcessed as number) < 0
    || typeof payload.isComplete !== 'boolean'
    || typeof payload.message !== 'string'
    || payload.message.trim().length === 0
  ) {
    throw new Error(`GPA import chunk ${call} returned an invalid payload.`);
  }

  const rowsProcessed = payload.rowsProcessed as number;
  if (payload.isComplete) {
    if (
      typeof payload.completionKey !== 'string'
      || payload.completionKey.trim().length === 0
    ) {
      throw new Error(
        `GPA import chunk ${call} completed without a completion key.`,
      );
    }
    return {
      rowsProcessed,
      isComplete: true,
      completionKey: payload.completionKey,
    };
  }

  if (payload.completionKey !== null) {
    throw new Error(
      `GPA import chunk ${call} returned a premature completion key.`,
    );
  }
  if (rowsProcessed === 0) {
    throw new Error(
      `GPA import chunk ${call} made no progress before completion.`,
    );
  }
  return {
    rowsProcessed,
    isComplete: false,
    completionKey: null,
  };
}

export async function syncGpaUntilComplete(
  requestChunk: () => Promise<Record<string, unknown>>,
  maxCalls = MAX_GPA_SYNC_CALLS,
): Promise<GpaImportResult> {
  if (!Number.isSafeInteger(maxCalls) || maxCalls <= 0) {
    throw new Error('GPA import call limit must be a positive integer.');
  }

  let rowsProcessed = 0;
  for (let call = 1; call <= maxCalls; call += 1) {
    const chunk = assertGpaSyncChunk(await requestChunk(), call);
    rowsProcessed += chunk.rowsProcessed;
    if (!Number.isSafeInteger(rowsProcessed)) {
      throw new Error('GPA import row count exceeded the safe integer range.');
    }
    if (chunk.isComplete && chunk.completionKey) {
      return {
        calls: call,
        rowsProcessed,
        completionKey: chunk.completionKey,
      };
    }
  }

  throw new Error(
    `GPA import did not complete within ${maxCalls} chunk requests.`,
  );
}

export async function requestGpaChunkWithRetry(
  requestChunk: () => Promise<Record<string, unknown>>,
  sleep: (delayMs: number) => Promise<void> = delay,
  maxAttempts = MAX_GPA_TRANSIENT_ATTEMPTS,
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('GPA retry attempt limit must be a positive integer.');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payload = await requestChunk();
      if (!isGpaMutationLeaseBusy(payload)) return payload;
      if (attempt === maxAttempts) {
        throw new Error(
          `GPA sync mutation lease remained busy for ${maxAttempts} attempts.`,
        );
      }
    } catch (error) {
      if (
        attempt === maxAttempts
        || !isRetryableGpaRequestError(error)
      ) {
        throw error;
      }
    }

    const retryDelayMs = Math.min(
      2 ** (attempt - 1) * 1_000,
      GPA_RETRY_MAX_DELAY_MS,
    );
    console.warn(
      `GPA chunk request was temporarily unavailable; retrying in `
      + `${retryDelayMs}ms (attempt ${attempt + 1}/${maxAttempts}).`,
    );
    await sleep(retryDelayMs);
  }

  throw new Error('GPA retry loop ended without a result.');
}

export function assertTermDiscoveryResult(
  payload: Record<string, unknown>,
): ReleaseDiscoveredTerm[] {
  if (
    !Number.isSafeInteger(payload.discovered)
    || (payload.discovered as number) < 0
  ) {
    throw new Error(
      'Term discovery returned a malformed discovered count; '
      + 'expected a positive integer.',
    );
  }
  const discovered = payload.discovered as number;
  if (discovered === 0) {
    throw new Error(
      'Term discovery returned zero terms; refusing to run a full sync.',
    );
  }
  if (
    !Array.isArray(payload.terms)
    || payload.terms.length !== discovered
  ) {
    throw new Error(
      'Term discovery returned a malformed terms array or count mismatch.',
    );
  }

  const terms: ReleaseDiscoveredTerm[] = [];
  for (const [index, rawTerm] of payload.terms.entries()) {
    if (!rawTerm || typeof rawTerm !== 'object' || Array.isArray(rawTerm)) {
      throw new Error(
        `Term discovery returned a malformed term at index ${index}.`,
      );
    }
    const term = rawTerm as Record<string, unknown>;
    const year = term.year;
    const termName = term.term;
    const expectedTermId = `${String(year)}-${String(termName)}`;
    if (
      !Number.isSafeInteger(year)
      || (year as number) < 2004
      || (year as number) > new Date().getFullYear() + 5
      || typeof termName !== 'string'
      || !VALID_SEARCH_TERMS.has(termName)
      || typeof term.termId !== 'string'
      || term.termId !== expectedTermId
      || typeof term.status !== 'string'
      || !VALID_TERM_STATUSES.has(term.status)
      || !Array.isArray(term.sampleStatuses)
      || term.sampleStatuses.some(status => typeof status !== 'string')
    ) {
      throw new Error(
        `Term discovery returned a malformed term at index ${index}.`,
      );
    }
    terms.push({
      termId: term.termId,
      year: year as number,
      term: termName as ReleaseDiscoveredTerm['term'],
      status: term.status as ReleaseDiscoveredTerm['status'],
      sampleStatuses: term.sampleStatuses as string[],
    });
  }

  if (new Set(terms.map(term => term.termId)).size !== terms.length) {
    throw new Error('Term discovery returned duplicate term IDs.');
  }
  return terms;
}

export function assertTermSyncPage(
  payload: Record<string, unknown>,
  expectedTerm: ReleaseDiscoveredTerm,
  expectedOffset: number,
  expectedTotal?: number,
): {
  total: number;
  subjects: string[];
  hasMore: boolean;
  nextOffset: number;
} {
  const pagination = payload.pagination;
  const subjectResults = payload.subjectResults;
  if (
    payload.termId !== expectedTerm.termId
    || payload.year !== expectedTerm.year
    || payload.term !== expectedTerm.term
    || payload.forceRunningLocks !== true
    || !Array.isArray(payload.warnings)
    || payload.warnings.some(warning => typeof warning !== 'string')
    || !isRecord(pagination)
    || !Array.isArray(subjectResults)
  ) {
    throw new Error(
      `Paged sync returned an invalid response for ${expectedTerm.termId} `
      + `at offset ${expectedOffset}.`,
    );
  }

  const total = pagination.total;
  const hasMore = pagination.hasMore;
  if (
    !isPositiveSafeInteger(total)
    || total > RELEASE_TERM_SYNC_PAGE_LIMIT * MAX_RELEASE_TERM_SYNC_PAGES
    || pagination.offset !== expectedOffset
    || pagination.limit !== RELEASE_TERM_SYNC_PAGE_LIMIT
    || typeof hasMore !== 'boolean'
    || expectedOffset >= total
    || (expectedTotal !== undefined && total !== expectedTotal)
  ) {
    throw new Error(
      `Paged sync returned invalid pagination for ${expectedTerm.termId} `
      + `at offset ${expectedOffset}.`,
    );
  }

  const expectedPageSize = Math.min(
    RELEASE_TERM_SYNC_PAGE_LIMIT,
    total - expectedOffset,
  );
  const expectedHasMore = (
    expectedOffset + RELEASE_TERM_SYNC_PAGE_LIMIT < total
  );
  if (
    subjectResults.length !== expectedPageSize
    || hasMore !== expectedHasMore
    || payload.successfulSubjects !== expectedPageSize
    || payload.failedSubjects !== 0
    || !isNonNegativeSafeInteger(payload.rateLimitHits)
    || !isNonNegativeFiniteNumber(payload.durationMs)
  ) {
    throw new Error(
      `Paged sync returned incomplete coverage for ${expectedTerm.termId} `
      + `at offset ${expectedOffset}.`,
    );
  }

  const subjects: string[] = [];
  let totalCourses = 0;
  let totalSections = 0;
  for (const rawSubject of subjectResults) {
    if (!isRecord(rawSubject)) {
      throw new Error(
        `Paged sync returned an invalid subject for ${expectedTerm.termId}.`,
      );
    }
    const subject = rawSubject.subject;
    if (
      typeof subject !== 'string'
      || !/^[A-Z]{2,4}$/.test(subject)
      || rawSubject.success !== true
      || rawSubject.skipped === true
      || rawSubject.error !== undefined
      || !isNonNegativeSafeInteger(rawSubject.coursesCount)
      || !isNonNegativeSafeInteger(rawSubject.sectionsCount)
      || !isNonNegativeFiniteNumber(rawSubject.durationMs)
    ) {
      throw new Error(
        `Paged sync returned a failed or skipped subject for `
        + `${expectedTerm.termId} at offset ${expectedOffset}.`,
      );
    }
    subjects.push(subject);
    totalCourses += rawSubject.coursesCount;
    totalSections += rawSubject.sectionsCount;
  }
  if (
    new Set(subjects).size !== subjects.length
    || payload.totalCourses !== totalCourses
    || payload.totalSections !== totalSections
  ) {
    throw new Error(
      `Paged sync returned inconsistent subject totals for `
      + `${expectedTerm.termId} at offset ${expectedOffset}.`,
    );
  }

  return {
    total,
    subjects,
    hasMore,
    nextOffset: expectedOffset + subjects.length,
  };
}

export function assertTermFinalizationResult(
  payload: Record<string, unknown>,
  expectedTerm: ReleaseDiscoveredTerm,
  expectedSubjectCount: number,
  minimumLastSync: number,
  manifestSha256: string,
): ReleaseTermFinalization {
  if (
    payload.success !== true
    || payload.termId !== expectedTerm.termId
    || payload.year !== expectedTerm.year
    || payload.term !== expectedTerm.term
    || payload.status !== expectedTerm.status
    || payload.subjectCount !== expectedSubjectCount
    || payload.completeSubjectCount !== expectedSubjectCount
    || !isNonNegativeSafeInteger(payload.removedSubjectCount)
    || !isNonNegativeSafeInteger(payload.deletedCourseCount)
    || !isNonNegativeSafeInteger(payload.coursesCount)
    || !isNonNegativeSafeInteger(payload.sectionsCount)
    || payload.minimumLastSync !== minimumLastSync
    || !isPositiveSafeInteger(payload.earliestSubjectSync)
    || payload.earliestSubjectSync < minimumLastSync
    || payload.manifestSha256 !== manifestSha256
    || !isPositiveSafeInteger(payload.lastSynced)
  ) {
    throw new Error(
      `Term finalization returned incomplete evidence for `
      + `${expectedTerm.termId}.`,
    );
  }
  return {
    termId: expectedTerm.termId,
    subjectCount: expectedSubjectCount,
    coursesCount: payload.coursesCount,
    sectionsCount: payload.sectionsCount,
    lastSynced: payload.lastSynced,
  };
}

export function subjectManifestSha256(subjects: Iterable<string>): string {
  return createHash('sha256')
    .update(JSON.stringify([...subjects].sort()))
    .digest('hex');
}

export async function syncReleaseTermsInPages(
  config: ReleaseConfig,
  discoveredTerms: ReleaseDiscoveredTerm[],
  request: typeof requestJson = requestJson,
): Promise<ReleaseTermFinalization[]> {
  const releaseTerms = discoveredTerms.filter(
    term => term.status === 'registrable' || term.status === 'active',
  );
  if (releaseTerms.length === 0) {
    throw new Error(
      'Term discovery returned no active or registrable terms to release.',
    );
  }

  const minimumLastSync = Math.floor(Date.now() / 1000);
  const finalizedTerms: ReleaseTermFinalization[] = [];
  for (const term of releaseTerms) {
    let offset = 0;
    let total: number | undefined;
    const seenSubjects = new Set<string>();
    let completedPaging = false;

    for (
      let page = 1;
      page <= MAX_RELEASE_TERM_SYNC_PAGES;
      page += 1
    ) {
      console.log(
        `\n==> sync ${term.termId} subjects at offset ${offset}`,
      );
      const payload = await request(
        config,
        `/admin/sync/${term.year}/${term.term}`
        + `?offset=${offset}`
        + `&limit=${RELEASE_TERM_SYNC_PAGE_LIMIT}`
        + `&force=true&status=${term.status}`,
        { method: 'POST', admin: true },
      );
      const pageResult = assertTermSyncPage(
        payload,
        term,
        offset,
        total,
      );
      total ??= pageResult.total;
      for (const subject of pageResult.subjects) {
        if (seenSubjects.has(subject)) {
          throw new Error(
            `Paged sync returned duplicate subject ${subject} `
            + `across ${term.termId} pages.`,
          );
        }
        seenSubjects.add(subject);
      }

      if (!pageResult.hasMore) {
        if (seenSubjects.size !== total) {
          throw new Error(
            `Paged sync ended with incomplete subject coverage for `
            + `${term.termId}.`,
          );
        }
        completedPaging = true;
        break;
      }
      offset = pageResult.nextOffset;
    }

    if (!completedPaging || total === undefined) {
      throw new Error(
        `Paged sync did not complete ${term.termId} within `
        + `${MAX_RELEASE_TERM_SYNC_PAGES} requests.`,
      );
    }

    console.log(`\n==> finalize ${term.termId} authoritative manifest`);
    const manifestSha256 = subjectManifestSha256(seenSubjects);
    const finalization = await request(
      config,
      `/admin/sync/${term.year}/${term.term}/finalize`
      + `?since=${minimumLastSync}`
      + `&manifestSha256=${manifestSha256}`,
      { method: 'POST', admin: true },
    );
    finalizedTerms.push(assertTermFinalizationResult(
      finalization,
      term,
      total,
      minimumLastSync,
      manifestSha256,
    ));
  }
  return finalizedTerms;
}

export function assertFullCourseSyncResult(
  payload: Record<string, unknown>,
): string[] {
  const results = Array.isArray(payload.results) ? payload.results : null;
  if (
    !Number.isInteger(payload.termCount)
    || (payload.termCount as number) <= 0
    || !results
    || results.length !== payload.termCount
    || payload.failedTermCount !== 0
  ) {
    throw new Error('Full active course rebuild did not complete every term.');
  }

  const termIds: string[] = [];
  for (const rawResult of results) {
    if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
      throw new Error('Full active course rebuild returned an invalid term result.');
    }
    const result = rawResult as Record<string, unknown>;
    if (
      typeof result.termId !== 'string'
      || result.termId.length === 0
      || result.success !== true
      || !Number.isInteger(result.subjectCount)
      || (result.subjectCount as number) <= 0
      || result.failedBatchCount !== 0
      || result.failedSubjectCount !== 0
      || result.skippedSubjectCount !== 0
    ) {
      throw new Error('Full active course rebuild had incomplete term coverage.');
    }
    termIds.push(result.termId);
  }

  if (new Set(termIds).size !== termIds.length) {
    throw new Error('Full active course rebuild returned duplicate terms.');
  }
  return termIds;
}

export function assertCourseSyncStatus(
  payload: Record<string, unknown>,
  expectedTermIds: string[],
): void {
  const termStates = Array.isArray(payload.termStates) ? payload.termStates : [];
  const subjectStates = Array.isArray(payload.subjectSyncStates)
    ? payload.subjectSyncStates
    : [];

  for (const termId of expectedTermIds) {
    const termState = termStates.find(rawState => (
      rawState
      && typeof rawState === 'object'
      && !Array.isArray(rawState)
      && (rawState as Record<string, unknown>).term_id === termId
    ));
    if (!termState || typeof termState !== 'object' || Array.isArray(termState)) {
      throw new Error(`Post-release sync status is missing ${termId}.`);
    }
    const term = termState as Record<string, unknown>;
    if (
      typeof term.last_synced !== 'number'
      || term.last_synced <= 0
      || typeof term.subjects_count !== 'number'
      || term.subjects_count <= 0
      || term.sync_errors !== null
    ) {
      throw new Error(`Post-release sync status is incomplete for ${termId}.`);
    }

    const termSubjectStates = subjectStates.filter(rawState => (
      rawState
      && typeof rawState === 'object'
      && !Array.isArray(rawState)
      && (rawState as Record<string, unknown>).term_id === termId
    ));
    if (
      termSubjectStates.length !== term.subjects_count
      || termSubjectStates.some(rawState => (
        (rawState as Record<string, unknown>).status !== 'complete'
      ))
    ) {
      throw new Error(`Post-release subject sync status is incomplete for ${termId}.`);
    }
  }
}

export async function rebuildRegenerableData(
  config: ReleaseConfig,
  request: typeof requestJson = requestJson,
): Promise<void> {
  console.log('\n==> verify deployed Worker health');
  await request(config, '/health');

  console.log('\n==> discover current term state');
  const discovery = await request(config, '/admin/discover-terms', {
    method: 'POST',
    admin: true,
  });
  const discoveredTerms = assertTermDiscoveryResult(discovery);

  console.log(
    '\n==> republish active and registrable course snapshots in bounded pages',
  );
  const finalizedTerms = await syncReleaseTermsInPages(
    config,
    discoveredTerms,
    request,
  );
  const syncedTermIds = finalizedTerms.map(term => term.termId);

  console.log('\n==> import complete GPA dataset');
  const gpaImport = await syncGpaUntilComplete(() => (
    requestGpaChunkWithRetry(() => request(
      config,
      '/admin/sync-gpa',
      { method: 'POST', admin: true },
    ))
  ));
  console.log(
    `Imported ${gpaImport.rowsProcessed} GPA rows across `
    + `${gpaImport.calls} chunk request(s).`,
  );

  console.log('\n==> rebuild GPA aggregates');
  await request(config, '/admin/enrich-gpa', {
    method: 'POST',
    admin: true,
  });

  console.log('\n==> repopulate RMP cache, links, and public scores');
  const rmp = await request(config, '/admin/sync-rmp', {
    method: 'POST',
    admin: true,
  });
  if (typeof rmp.count !== 'number' || rmp.count <= 0) {
    throw new Error('RMP rebuild completed without publishing any teachers.');
  }

  console.log('\n==> verify post-release sync status');
  const syncStatus = await request(
    config,
    '/admin/sync/status',
    { admin: true },
  );
  assertCourseSyncStatus(syncStatus, syncedTermIds);
}

export function releaseTargetFromArgv(argv: string[]): ReleaseTarget {
  if (argv.length === 0) return 'staging';
  if (argv.length === 2 && argv[0] === '--target') {
    if (argv[1] === 'staging' || argv[1] === 'production') return argv[1];
  }
  throw new Error('Usage: staging-api-release.ts [--target staging|production]');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isGpaMutationLeaseBusy(
  payload: Record<string, unknown>,
): boolean {
  return (
    payload.success === false
    && payload.rowsProcessed === 0
    && payload.isComplete === false
    && payload.completionKey === null
    && payload.message === 'GPA sync mutation lease is busy'
  );
}

function isRetryableGpaRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /\b(?:429|502|503|504)\b/.test(error.message)
    || /\bD1_ERROR:\s*Network connection lost\b/i.test(error.message)
    || /\bfetch failed\b/i.test(error.message)
    || /\b(?:request|operation)\s+(?:timed out|timeout)\b/i.test(error.message)
  );
}

function delay(delayMs: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, delayMs));
}

async function main(): Promise<void> {
  const target = releaseTargetFromArgv(process.argv.slice(2));
  const config = releaseConfig(target);
  for (const command of releaseCommands(config)) {
    await runCommand(command);
  }
  await rebuildRegenerableData(config);
  console.log(
    `\n${config.target === 'production' ? 'Production' : 'Staging'} API release completed through ${config.approvedMigration}.`,
  );
}

runCli(import.meta.url, main);
