import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanFile } from '../check-secrets.ts';

let tempRoot: string | undefined;

function fixture(contents: string): string {
  tempRoot ??= mkdtempSync(join(tmpdir(), 'check-secrets-test-'));
  const file = join(tempRoot, 'fixture.json');
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe('check secrets', () => {
  it('reports quoted JSON-style named secret assignments', async () => {
    const findings = await scanFile(fixture('{ "CLOUDFLARE_API_TOKEN": "abcdefghijklmnop123456" }'));

    expect(findings).toEqual([
      expect.objectContaining({
        line: 1,
        pattern: 'named secret assignment',
      }),
    ]);
  });

  it('ignores quoted placeholder secret assignments', async () => {
    const findings = await scanFile(fixture('{ "OPENAI_API_KEY": "redacted-placeholder-token" }'));

    expect(findings).toEqual([]);
  });
});
