import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './lib/run-cli.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED_ADVISORY_ID = 'GHSA-qwww-vcr4-c8h2';
const ALLOWED_ADVISORY_URL =
  `https://github.com/advisories/${ALLOWED_ADVISORY_ID}`;
const EXPECTED_PACKAGES = ['react-router', 'react-router-dom'] as const;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : undefined;
}

function hasExactStrings(value: unknown, expected: readonly string[]): boolean {
  const actual = stringArray(value);
  return (
    actual !== undefined &&
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

function hasExpectedFix(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.name === 'react-router-dom' &&
    value.version === '7.11.0' &&
    value.isSemVerMajor === true
  );
}

function validateRouterFinding(
  name: (typeof EXPECTED_PACKAGES)[number],
  value: unknown,
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${name} finding is not an object`];

  const isRouter = name === 'react-router';
  if (value.severity !== 'high') {
    errors.push(`${name} severity changed from high`);
  }
  if (value.isDirect !== !isRouter) {
    errors.push(`${name} direct-dependency classification changed`);
  }

  const expectedNode = `node_modules/${name}`;
  const nodes = stringArray(value.nodes);
  if (
    !nodes ||
    nodes.length === 0 ||
    nodes.some(node => node !== expectedNode)
  ) {
    errors.push(`${name} finding contains unexpected dependency nodes`);
  }

  const expectedEffects = isRouter ? ['react-router-dom'] : [];
  if (!hasExactStrings(value.effects, expectedEffects)) {
    errors.push(`${name} dependency effects changed`);
  }

  if (!hasExpectedFix(value.fixAvailable)) {
    errors.push(
      `${name} now has a different remediation; update dependencies instead of allowing it`,
    );
  }

  if (isRouter) {
    if (!Array.isArray(value.via) || value.via.length !== 1) {
      errors.push('react-router must contain exactly one advisory');
    } else {
      const advisory = value.via[0];
      if (
        !isRecord(advisory) ||
        advisory.name !== 'react-router' ||
        advisory.severity !== 'high' ||
        advisory.url !== ALLOWED_ADVISORY_URL
      ) {
        errors.push(
          `react-router contains an advisory other than ${ALLOWED_ADVISORY_ID}`,
        );
      }
    }
  } else if (!hasExactStrings(value.via, ['react-router'])) {
    errors.push('react-router-dom must be affected only through react-router');
  }

  return errors;
}

export function auditPolicyErrors(report: unknown): string[] {
  if (!isRecord(report)) return ['npm audit output is not an object'];
  if (report.auditReportVersion !== 2) {
    return ['npm audit report version is missing or unsupported'];
  }
  if (!isRecord(report.vulnerabilities)) {
    return ['npm audit vulnerabilities are missing or malformed'];
  }
  const vulnerabilities = report.vulnerabilities;

  const packageNames = Object.keys(vulnerabilities).sort();
  const counts = isRecord(report.metadata)
    ? report.metadata.vulnerabilities
    : undefined;
  const expectedHigh = packageNames.length === 0 ? 0 : 2;
  const expectedTotal = packageNames.length === 0 ? 0 : 2;
  const countErrors: string[] = [];
  if (
    !isRecord(counts) ||
    counts.info !== 0 ||
    counts.low !== 0 ||
    counts.moderate !== 0 ||
    counts.high !== expectedHigh ||
    counts.critical !== 0 ||
    counts.total !== expectedTotal
  ) {
    countErrors.push('npm audit vulnerability totals are missing or unexpected');
  }

  if (packageNames.length === 0) return countErrors;
  if (!hasExactStrings(packageNames, EXPECTED_PACKAGES)) {
    return [
      `unexpected vulnerable packages: ${packageNames.join(', ') || '(none)'}`,
      ...countErrors,
    ];
  }

  const errors = [
    ...EXPECTED_PACKAGES.flatMap(name =>
      validateRouterFinding(name, vulnerabilities[name]),
    ),
    ...countErrors,
  ];

  return errors;
}

async function packageManifestPaths(root: string): Promise<string[]> {
  const paths = [join(root, 'package.json')];
  for (const workspaceDirectory of ['apps', 'packages']) {
    const directory = join(root, workspaceDirectory);
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        paths.push(join(directory, entry.name, 'package.json'));
      }
    }
  }
  return paths;
}

async function sourcePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await sourcePaths(path)));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      paths.push(path);
    }
  }
  return paths;
}

function forbiddenDependency(name: string): boolean {
  return (
    name === 'react-router' ||
    name.startsWith('@react-router/') ||
    name.startsWith('react-server-dom-') ||
    name === '@vitejs/plugin-rsc' ||
    name === 'vite-plugin-rsc'
  );
}

export async function clientOnlySpaPolicyErrors(
  root = repoRoot,
): Promise<string[]> {
  const errors: string[] = [];
  const manifests = await packageManifestPaths(root);

  for (const path of manifests) {
    const contents = await readFile(path, 'utf8').catch(() => undefined);
    if (contents === undefined) {
      errors.push(`required package manifest is missing: ${path}`);
      continue;
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(contents);
    } catch {
      errors.push(`package manifest is not valid JSON: ${path}`);
      continue;
    }
    if (!isRecord(manifest)) {
      errors.push(`package manifest is not an object: ${path}`);
      continue;
    }

    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = manifest[section];
      if (!isRecord(dependencies)) continue;
      for (const name of Object.keys(dependencies)) {
        if (forbiddenDependency(name)) {
          errors.push(`server/framework dependency ${name} is present in ${path}`);
        }
      }
    }
  }

  const webManifestPath = join(root, 'apps/web/package.json');
  const webManifest = JSON.parse(await readFile(webManifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  if (!webManifest.dependencies?.['react-router-dom']) {
    errors.push('apps/web must declare react-router-dom directly');
  }

  const lockPath = join(root, 'package-lock.json');
  const lockContents = await readFile(lockPath, 'utf8').catch(() => '');
  let lock: unknown;
  try {
    lock = JSON.parse(lockContents);
  } catch {
    errors.push('package-lock.json is missing or malformed');
  }
  if (isRecord(lock) && isRecord(lock.packages)) {
    const serverPackagePattern =
      /(?:^|\/)node_modules\/(?:@react-router\/[^/]+|react-server-dom-[^/]+|@vitejs\/plugin-rsc|vite-plugin-rsc)(?:$|\/node_modules\/)/;
    for (const installedPath of Object.keys(lock.packages)) {
      if (serverPackagePattern.test(installedPath)) {
        errors.push(
          `package-lock.json contains an RSC/server package: ${installedPath}`,
        );
      }
    }
  } else if (lock !== undefined) {
    errors.push('package-lock.json does not contain a packages inventory');
  }

  const mainPath = join(root, 'apps/web/src/main.tsx');
  const main = await readFile(mainPath, 'utf8').catch(() => '');
  if (
    !/import\s*\{[^}]*\bBrowserRouter\b[^}]*\}\s*from\s*['"]react-router-dom['"]/.test(
      main,
    ) ||
    !/<BrowserRouter(?:\s|>)/.test(main)
  ) {
    errors.push('apps/web/src/main.tsx must mount the app with BrowserRouter');
  }

  const forbiddenSourcePatterns = [
    {
      label: 'a server-action directive',
      pattern: /^\s*['"]use server['"];?/m,
    },
    {
      label: 'a React Server Components import',
      pattern: /from\s*['"]react-server-dom-/,
    },
    {
      label: 'a React Router server/framework import',
      pattern:
        /from\s*['"](?:react-router['"]|@react-router\/|react-router(?:-dom)?\/(?:server|rsc))/,
    },
    {
      label: 'a React Router RSC/server API',
      pattern:
        /\b(?:createRequestHandler|matchRSCServerRequest|routeRSCServerRequest|RSCStaticRouter|RSCHydratedRouter|getRSCStream)\b/,
    },
  ];

  const webSources = [
    ...(await sourcePaths(join(root, 'apps/web/src'))),
    join(root, 'apps/web/vite.config.ts'),
  ];
  for (const path of webSources) {
    const contents = await readFile(path, 'utf8').catch(() => '');
    for (const { label, pattern } of forbiddenSourcePatterns) {
      if (pattern.test(contents)) {
        errors.push(`${path} contains ${label}`);
      }
    }
  }

  return errors;
}

function parseAuditReport(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('npm audit did not return valid JSON; refusing to pass');
  }
}

async function main(): Promise<void> {
  const audit = spawnSync('npm', ['audit', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (audit.error) {
    throw new Error(`npm audit could not start: ${audit.error.message}`);
  }
  if (audit.status !== 0 && audit.status !== 1) {
    throw new Error(
      `npm audit exited unexpectedly with status ${audit.status ?? 'unknown'}`,
    );
  }

  const report = parseAuditReport(audit.stdout);
  const errors = [
    ...auditPolicyErrors(report),
    ...(await clientOnlySpaPolicyErrors()),
  ];
  if (errors.length > 0) {
    console.error('# Dependency Audit Policy Failures');
    for (const error of errors) console.error(`- ${error}`);
    throw new Error('Dependency audit failed closed.');
  }

  const vulnerabilities =
    isRecord(report) && isRecord(report.vulnerabilities)
      ? Object.keys(report.vulnerabilities)
      : [];
  if (vulnerabilities.length === 0) {
    console.log('Dependency audit passed: npm reported no vulnerabilities.');
  } else {
    console.log(
      `Dependency audit passed with the scoped ${ALLOWED_ADVISORY_ID} ` +
        'client-only SPA exception; no other advisories were reported.',
    );
  }
}

runCli(import.meta.url, main);
