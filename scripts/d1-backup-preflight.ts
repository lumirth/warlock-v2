import { runCli } from './lib/run-cli.ts';

import { hasTimestampBackupRef, validateD1BackupEvidence } from './lib/d1-backup-evidence.ts';

type Args = {
  database?: string;
  backupRef?: string;
  evidenceFile?: string;
  restoreVerified: boolean;
};

function usage(): string {
  return [
    'D1 destructive-operation preflight',
    '',
    'Required:',
    '  --database <database-name>',
    '  --backup-ref <YYYYMMDDTHHMMSSZ>',
    '  --evidence-file <path-containing-concrete-backup-and-restore-evidence>',
    '  --restore-verified',
    '',
    'Example:',
    '  npm run d1:preflight -- --database course-search-db-staging --backup-ref 20260601T170000Z --evidence-file docs/reports/d1-restore-20260601.md --restore-verified',
  ].join('\n');
}

function parseArgs(argv: string[]): Args {
  const args: Args = { restoreVerified: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--restore-verified') {
      args.restoreVerified = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next) continue;
    if (arg === '--database') {
      args.database = next;
      i += 1;
    } else if (arg === '--backup-ref') {
      args.backupRef = next;
      i += 1;
    } else if (arg === '--evidence-file') {
      args.evidenceFile = next;
      i += 1;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const missing = [
    !args.database && '--database',
    !args.backupRef && '--backup-ref',
    !args.evidenceFile && '--evidence-file',
    !args.restoreVerified && '--restore-verified',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.error(usage());
    throw new Error(`Missing D1 backup preflight requirements: ${missing.join(', ')}`);
  }

  if (!hasTimestampBackupRef(args.backupRef)) {
    throw new Error(`Backup ref must use YYYYMMDDTHHMMSSZ format: ${args.backupRef}`);
  }

  await validateD1BackupEvidence(args);
  console.log(`D1 backup preflight passed for ${args.database} using backup ${args.backupRef}.`);
}

runCli(import.meta.url, main);
