import { readFile } from 'node:fs/promises';

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
    '  --database <name-or-id>',
    '  --backup-ref <timestamp-or-backup-id>',
    '  --evidence-file <path-containing-database-and-backup-ref>',
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

  const evidence = await readFile(args.evidenceFile!, 'utf8');
  const missingEvidence = [
    !evidence.includes(args.database!) && args.database,
    !evidence.includes(args.backupRef!) && args.backupRef,
  ].filter(Boolean);

  if (missingEvidence.length > 0) {
    throw new Error(`Evidence file does not mention required backup markers: ${missingEvidence.join(', ')}`);
  }

  console.log(`D1 backup preflight passed for ${args.database} using backup ${args.backupRef}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
