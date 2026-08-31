import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'apps/web/dist';
const LIMITS = { js: 140 * 1024, css: 40 * 1024, image: 160 * 1024 };
type Totals = Record<keyof typeof LIMITS, number>;

async function main(): Promise<void> {
  const names = await readdir(DIST, { recursive: true });
  const totals = { js: 0, css: 0, image: 0 };
  for (const name of names) {
    const path = join(DIST, name);
    if (!(await stat(path)).isFile()) continue;
    await addAsset(totals, name, path);
  }
  if (!totals.js || !totals.css) throw new Error(`No JS/CSS assets in ${DIST}; build first.`);
  const failures = Object.entries(LIMITS).filter(([kind, limit]) =>
    totals[kind as keyof typeof totals] > limit);
  for (const [kind, limit] of Object.entries(LIMITS)) {
    const bytes = totals[kind as keyof typeof totals];
    console.log(`${failures.some(([failed]) => failed === kind) ? 'FAIL' : 'PASS'} ${kind}: ${Math.ceil(bytes / 1024)} / ${limit / 1024} KiB`);
  }
  if (failures.length) throw new Error(`Bundle budget exceeded: ${failures.map(([kind]) => kind).join(', ')}`);
}

async function addAsset(totals: Totals, name: string, path: string): Promise<void> {
  if (name.endsWith('.js')) totals.js += gzipSync(await readFile(path)).byteLength;
  else if (name.endsWith('.css')) totals.css += gzipSync(await readFile(path)).byteLength;
  else if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(name)) {
    totals.image = Math.max(totals.image, (await stat(path)).size);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
