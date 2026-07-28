import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditPolicyErrors,
  clientOnlySpaPolicyErrors,
} from '../security-audit.ts';

let tempRoot: string | undefined;

function exactAllowedReport(): Record<string, unknown> {
  const fixAvailable = {
    name: 'react-router-dom',
    version: '7.11.0',
    isSemVerMajor: true,
  };
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'react-router': {
        name: 'react-router',
        severity: 'high',
        isDirect: false,
        via: [
          {
            name: 'react-router',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
          },
        ],
        effects: ['react-router-dom'],
        nodes: ['node_modules/react-router'],
        fixAvailable,
      },
      'react-router-dom': {
        name: 'react-router-dom',
        severity: 'high',
        isDirect: true,
        via: ['react-router'],
        effects: [],
        nodes: ['node_modules/react-router-dom'],
        fixAvailable,
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 2,
        critical: 0,
        total: 2,
      },
    },
  };
}

function spaFixture(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'security-audit-test-'));
  mkdirSync(join(tempRoot, 'apps/web/src'), { recursive: true });
  mkdirSync(join(tempRoot, 'packages/query-types'), { recursive: true });
  writeFileSync(
    join(tempRoot, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'] }),
  );
  writeFileSync(
    join(tempRoot, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/react-router': {},
        'node_modules/react-router-dom': {},
      },
    }),
  );
  writeFileSync(
    join(tempRoot, 'apps/web/package.json'),
    JSON.stringify({
      dependencies: { 'react-router-dom': '^7.18.1' },
    }),
  );
  writeFileSync(
    join(tempRoot, 'packages/query-types/package.json'),
    JSON.stringify({ name: '@example/query-types' }),
  );
  writeFileSync(
    join(tempRoot, 'apps/web/src/main.tsx'),
    [
      "import { BrowserRouter } from 'react-router-dom'",
      'root.render(<BrowserRouter><App /></BrowserRouter>)',
    ].join('\n'),
  );
  writeFileSync(join(tempRoot, 'apps/web/vite.config.ts'), 'export default {}');
  return tempRoot;
}

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('dependency audit policy', () => {
  it('passes a clean npm audit report', () => {
    expect(
      auditPolicyErrors({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 0,
            total: 0,
          },
        },
      }),
    ).toEqual([]);
  });

  it('fails closed when a clean-looking report omits audit totals', () => {
    expect(
      auditPolicyErrors({
        auditReportVersion: 2,
        vulnerabilities: {},
      }),
    ).toContain('npm audit vulnerability totals are missing or unexpected');
  });

  it('permits only the exact unpatched React Router advisory shape', () => {
    expect(auditPolicyErrors(exactAllowedReport())).toEqual([]);
  });

  it('fails when any additional vulnerable package appears', () => {
    const report = exactAllowedReport();
    const vulnerabilities = report.vulnerabilities as Record<string, unknown>;
    vulnerabilities.undici = { severity: 'high' };

    expect(auditPolicyErrors(report)).toContain(
      'unexpected vulnerable packages: react-router, react-router-dom, undici',
    );
  });

  it('fails when React Router contains a second advisory', () => {
    const report = exactAllowedReport();
    const router = (
      report.vulnerabilities as Record<string, Record<string, unknown>>
    )['react-router'];
    (router.via as unknown[]).push({
      name: 'react-router',
      severity: 'moderate',
      url: 'https://github.com/advisories/GHSA-new-advisory',
    });

    expect(auditPolicyErrors(report)).toContain(
      'react-router must contain exactly one advisory',
    );
  });

  it('fails when npm exposes a different remediation', () => {
    const report = exactAllowedReport();
    const router = (
      report.vulnerabilities as Record<string, Record<string, unknown>>
    )['react-router'];
    router.fixAvailable = {
      name: 'react-router-dom',
      version: '8.3.0',
      isSemVerMajor: true,
    };

    expect(auditPolicyErrors(report)).toContain(
      'react-router now has a different remediation; update dependencies instead of allowing it',
    );
  });
});

describe('client-only SPA evidence', () => {
  it('accepts a BrowserRouter SPA with no server dependencies', async () => {
    expect(await clientOnlySpaPolicyErrors(spaFixture())).toEqual([]);
  });

  it('rejects React Router framework dependencies', async () => {
    const root = spaFixture();
    writeFileSync(
      join(root, 'apps/web/package.json'),
      JSON.stringify({
        dependencies: {
          'react-router-dom': '^7.18.1',
          '@react-router/node': '^7.18.1',
        },
      }),
    );

    expect(await clientOnlySpaPolicyErrors(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'server/framework dependency @react-router/node',
        ),
      ]),
    );
  });

  it('rejects transitive RSC packages in the lockfile', async () => {
    const root = spaFixture();
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/react-router': {},
          'node_modules/react-router-dom': {},
          'node_modules/react-server-dom-webpack': {},
        },
      }),
    );

    expect(await clientOnlySpaPolicyErrors(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'package-lock.json contains an RSC/server package',
        ),
      ]),
    );
  });

  it('rejects server-action directives in web source', async () => {
    const root = spaFixture();
    writeFileSync(
      join(root, 'apps/web/src/server-action.ts'),
      "'use server';\nexport const mutate = () => undefined",
    );

    expect(await clientOnlySpaPolicyErrors(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('contains a server-action directive'),
      ]),
    );
  });

  it('rejects an entrypoint that no longer mounts BrowserRouter', async () => {
    const root = spaFixture();
    writeFileSync(
      join(root, 'apps/web/src/main.tsx'),
      "import { RouterProvider } from 'react-router-dom'\nroot.render(<RouterProvider router={router} />)",
    );

    expect(await clientOnlySpaPolicyErrors(root)).toContain(
      'apps/web/src/main.tsx must mount the app with BrowserRouter',
    );
  });
});
