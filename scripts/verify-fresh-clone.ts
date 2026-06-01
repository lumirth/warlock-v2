import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command: string, args: string[], cwd: string): void {
  console.log(`$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
}

function output(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  }).trim();
}

function assertAbsent(path: string): void {
  if (existsSync(path)) {
    throw new Error(`Fresh clone unexpectedly contains ${path}`);
  }
}

function main(): void {
  const source = output('git', ['rev-parse', '--show-toplevel'], process.cwd());
  const tempRoot = mkdtempSync(join(tmpdir(), 'uiuc-course-search-fresh-'));
  const cloneDir = join(tempRoot, 'repo');

  try {
    run('git', ['clone', '--local', '--no-hardlinks', source, cloneDir], tempRoot);

    assertAbsent(join(cloneDir, 'history_chunks'));
    assertAbsent(join(cloneDir, 'full_history.sql'));

    const trackedArtifacts = output('git', ['ls-files', 'history_chunks', 'full_history.sql'], cloneDir);
    if (trackedArtifacts.length > 0) {
      throw new Error(`Generated data artifacts are still tracked:\n${trackedArtifacts}`);
    }

    run('npm', ['ci'], cloneDir);
    run('npm', ['run', 'db:verify'], cloneDir);
    run('npm', ['run', 'typecheck'], cloneDir);

    console.log(`Fresh clone bootstrap verified from ${source}.`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
