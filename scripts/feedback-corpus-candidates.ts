import { readFile, writeFile } from 'node:fs/promises';
import { runCli } from './lib/run-cli.ts';
import {
  buildFeedbackCandidateReport,
  parseFeedbackExport,
  parseFeedbackResolutionLedger,
} from './lib/feedback-corpus/report.js';

export {
  buildFeedbackCandidateReport,
  parseFeedbackExport,
  parseFeedbackResolutionLedger,
} from './lib/feedback-corpus/report.js';
export type {
  FeedbackCandidateReport,
  FeedbackCandidateResolution,
  FeedbackCorpusCandidate,
  FeedbackExportRow,
} from './lib/feedback-corpus/report.js';

type Args = {
  input?: string;
  output?: string;
  resolutions?: string;
};

function usage(): string {
  return [
    'Feedback corpus candidate generator',
    '',
    'Usage:',
    '  npm run feedback:triage -- --input <feedback-export.json|feedback-export.ndjson|-> [--output <path>] [--resolutions <path>]',
    '',
    'Input may be:',
    '  - a JSON array of feedback_events rows',
    '  - Wrangler D1 JSON, e.g. [{ "results": [...] }]',
    '  - newline-delimited JSON rows',
    '',
    'Example:',
    '  wrangler d1 execute course-search-db-staging --remote --json --command "SELECT * FROM feedback_events ORDER BY created_at DESC LIMIT 200" > artifacts/feedback.json',
    '  npm run feedback:triage -- --input artifacts/feedback.json --output artifacts/feedback-candidates.json',
  ].join('\n');
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--input' && next) {
      args.input = next;
      i += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      i += 1;
    } else if (arg === '--resolutions' && next) {
      args.resolutions = next;
      i += 1;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error(usage());
    throw new Error('Missing --input');
  }

  const source = args.input;
  const input = args.input === '-' ? await readStdin() : await readFile(args.input, 'utf8');
  const rows = parseFeedbackExport(input);
  const resolutions = args.resolutions
    ? parseFeedbackResolutionLedger(await readFile(args.resolutions, 'utf8'))
    : [];
  const report = buildFeedbackCandidateReport(rows, source, new Date(), resolutions);
  const body = `${JSON.stringify(report, null, 2)}\n`;

  if (args.output) {
    await writeFile(args.output, body);
  } else {
    process.stdout.write(body);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

runCli(import.meta.url, main);
