import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { runCli } from './lib/run-cli.ts';

const STAGING_DATABASE = 'course-search-db-staging';
const STAGING_API_HOST = 'uiuc-course-search-staging.lumirth.workers.dev';
const ADMIN_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(repoRoot, 'apps/api');

export type StagingReleaseConfig = {
  apiBaseUrl: string;
  adminToken: string;
  backupRef: string;
  backupEvidenceFile: string;
  approvedMigration: string;
  approvedMigrationSha256: string;
};

export type ReleaseCommand = {
  command: string;
  args: string[];
  cwd: string;
  label: string;
};

function requiredEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a staging API release.`);
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

export function stagingReleaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): StagingReleaseConfig {
  const apiBaseUrl = requiredEnv(env, 'STAGING_API_BASE_URL').replace(/\/+$/, '');
  const parsedUrl = new URL(apiBaseUrl);
  if (
    parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname !== STAGING_API_HOST
    || parsedUrl.port
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.pathname !== '/'
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new Error(
      `STAGING_API_BASE_URL must be exactly https://${STAGING_API_HOST}.`,
    );
  }

  const approvedMigration = requiredEnv(env, 'STAGING_MIGRATION_APPROVED');
  const latestMigration = latestMigrationName();
  if (approvedMigration !== latestMigration) {
    throw new Error(
      `STAGING_MIGRATION_APPROVED must equal the current migration ${latestMigration}.`,
    );
  }
  const approvedMigrationSha256 = requiredEnv(
    env,
    'STAGING_MIGRATION_SHA256_APPROVED',
  );
  const migrationSha256 = latestMigrationSha256(latestMigration);
  if (approvedMigrationSha256 !== migrationSha256) {
    throw new Error(
      'STAGING_MIGRATION_SHA256_APPROVED must equal the SHA-256 of '
      + `${latestMigration}.sql: ${migrationSha256}.`,
    );
  }

  return {
    apiBaseUrl,
    adminToken: requiredEnv(env, 'STAGING_ADMIN_TOKEN'),
    backupRef: requiredEnv(env, 'D1_BACKUP_REF'),
    backupEvidenceFile: resolve(
      repoRoot,
      requiredEnv(env, 'D1_BACKUP_EVIDENCE_FILE'),
    ),
    approvedMigration,
    approvedMigrationSha256,
  };
}

export function releaseCommands(
  config: StagingReleaseConfig,
): ReleaseCommand[] {
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
        STAGING_DATABASE,
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
        STAGING_DATABASE,
        '--env',
        'staging',
        '--remote',
      ],
      cwd: apiDir,
      label: `apply ${config.approvedMigration}`,
    },
    {
      command: 'npx',
      args: ['wrangler', 'deploy', '--env', 'staging'],
      cwd: apiDir,
      label: 'deploy staging Worker',
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
  config: StagingReleaseConfig,
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

async function rebuildRegenerableData(config: StagingReleaseConfig): Promise<void> {
  console.log('\n==> verify deployed Worker health');
  await requestJson(config, '/health');

  console.log('\n==> discover current term state');
  await requestJson(config, '/admin/discover-terms', {
    method: 'POST',
    admin: true,
  });

  console.log('\n==> republish active and registrable course snapshots');
  const fullSync = await requestJson(config, '/admin/sync-active/full', {
    method: 'POST',
    admin: true,
  });
  const syncedTermIds = assertFullCourseSyncResult(fullSync);

  console.log('\n==> rebuild GPA aggregates');
  await requestJson(config, '/admin/enrich-gpa', {
    method: 'POST',
    admin: true,
  });

  console.log('\n==> repopulate RMP cache, links, and public scores');
  const rmp = await requestJson(config, '/admin/sync-rmp', {
    method: 'POST',
    admin: true,
  });
  if (typeof rmp.count !== 'number' || rmp.count <= 0) {
    throw new Error('RMP rebuild completed without publishing any teachers.');
  }

  console.log('\n==> verify post-release sync status');
  const syncStatus = await requestJson(
    config,
    '/admin/sync/status',
    { admin: true },
  );
  assertCourseSyncStatus(syncStatus, syncedTermIds);
}

async function main(): Promise<void> {
  const config = stagingReleaseConfig();
  for (const command of releaseCommands(config)) {
    await runCommand(command);
  }
  await rebuildRegenerableData(config);
  console.log(
    `\nStaging API release completed through ${config.approvedMigration}; run staging smoke and eval gates next.`,
  );
}

runCli(import.meta.url, main);
