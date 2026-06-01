import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

type Finding = {
  file: string;
  line: number;
  pattern: string;
};

type SecretPattern = {
  name: string;
  regex: RegExp;
};

const EXCLUDED_PATHS = [
  /^package-lock\.json$/,
  /^apps\/web\/dist\//,
  /^artifacts\//,
  /^history_chunks\//,
];

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'named secret assignment',
    regex: /\b(?:ADMIN_TOKEN|INTERNAL_TOKEN|RMP_AUTH_TOKEN|CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CF_ACCOUNT_ID|OPENAI_API_KEY)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{16,})["']?/g,
  },
  { name: 'OpenAI-style API key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter(file => !EXCLUDED_PATHS.some(pattern => pattern.test(file)));
}

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes('example')
    || normalized.includes('redacted')
    || normalized.includes('changeme')
    || normalized.includes('placeholder')
    || normalized.includes('token');
}

function lineNumberFor(contents: string, index: number): number {
  return contents.slice(0, index).split('\n').length;
}

async function scanFile(file: string): Promise<Finding[]> {
  const contents = await readFile(file, 'utf8').catch(() => '');
  const findings: Finding[] = [];

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of contents.matchAll(pattern.regex)) {
      const value = match[1] ?? match[0];
      if (isPlaceholder(value)) continue;
      findings.push({
        file,
        line: lineNumberFor(contents, match.index ?? 0),
        pattern: pattern.name,
      });
    }
  }

  return findings;
}

async function main(): Promise<void> {
  const findings = (await Promise.all(trackedFiles().map(scanFile))).flat();
  if (findings.length > 0) {
    console.error('# Secret Scan Findings');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} matched ${finding.pattern}`);
    }
    throw new Error('Committed secret scan failed.');
  }
  console.log('Secret scan passed: no committed secret-looking values found.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
