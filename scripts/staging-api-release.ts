import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { runCli } from './lib/run-cli.ts';

const ADMIN_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_GPA_SYNC_CALLS = 1024;
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
  await request(config, '/admin/discover-terms', {
    method: 'POST',
    admin: true,
  });

  console.log('\n==> republish active and registrable course snapshots');
  const fullSync = await request(config, '/admin/sync-active/full', {
    method: 'POST',
    admin: true,
  });
  const syncedTermIds = assertFullCourseSyncResult(fullSync);

  console.log('\n==> import complete GPA dataset');
  const gpaImport = await syncGpaUntilComplete(() => request(
    config,
    '/admin/sync-gpa',
    { method: 'POST', admin: true },
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
