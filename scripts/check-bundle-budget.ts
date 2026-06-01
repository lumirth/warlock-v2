import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

type AssetKind = 'js' | 'css';

type AssetMeasurement = {
  file: string;
  kind: AssetKind;
  bytes: number;
  gzipBytes: number;
};

const DIST_DIR = 'apps/web/dist';
const ASSETS_DIR = join(DIST_DIR, 'assets');

const BUDGETS = {
  jsBytes: 420 * 1024,
  jsGzipBytes: 140 * 1024,
  cssBytes: 240 * 1024,
  cssGzipBytes: 40 * 1024,
  totalGzipBytes: 190 * 1024,
};

function formatBytes(value: number): string {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function kindFor(file: string): AssetKind | null {
  if (file.endsWith('.js')) return 'js';
  if (file.endsWith('.css')) return 'css';
  return null;
}

async function measureAssets(): Promise<AssetMeasurement[]> {
  const files = await readdir(ASSETS_DIR);
  const measurements: AssetMeasurement[] = [];

  for (const file of files) {
    const kind = kindFor(file);
    if (!kind) continue;

    const path = join(ASSETS_DIR, file);
    const [fileStat, contents] = await Promise.all([stat(path), readFile(path)]);
    measurements.push({
      file,
      kind,
      bytes: fileStat.size,
      gzipBytes: gzipSync(contents).byteLength,
    });
  }

  return measurements;
}

function largest(measurements: AssetMeasurement[], kind: AssetKind): AssetMeasurement | undefined {
  return measurements
    .filter(item => item.kind === kind)
    .sort((a, b) => b.bytes - a.bytes)[0];
}

function assertBudget(label: string, actual: number, limit: number, failures: string[]): void {
  const status = actual <= limit ? 'PASS' : 'FAIL';
  console.log(`${status} ${label}: ${formatBytes(actual)} / ${formatBytes(limit)}`);
  if (actual > limit) {
    failures.push(`${label} is ${formatBytes(actual)}, above ${formatBytes(limit)}`);
  }
}

async function main(): Promise<void> {
  const measurements = await measureAssets();
  if (measurements.length === 0) {
    throw new Error(`No JS/CSS assets found in ${ASSETS_DIR}; run npm run build first.`);
  }

  const largestJs = largest(measurements, 'js');
  const largestCss = largest(measurements, 'css');
  const totalGzip = measurements.reduce((sum, item) => sum + item.gzipBytes, 0);
  const failures: string[] = [];

  console.log('# Web Bundle Budget');
  if (largestJs) {
    console.log(`Largest JS asset: ${largestJs.file}`);
    assertBudget('largest JS raw', largestJs.bytes, BUDGETS.jsBytes, failures);
    assertBudget('largest JS gzip', largestJs.gzipBytes, BUDGETS.jsGzipBytes, failures);
  }
  if (largestCss) {
    console.log(`Largest CSS asset: ${largestCss.file}`);
    assertBudget('largest CSS raw', largestCss.bytes, BUDGETS.cssBytes, failures);
    assertBudget('largest CSS gzip', largestCss.gzipBytes, BUDGETS.cssGzipBytes, failures);
  }
  assertBudget('total JS/CSS gzip', totalGzip, BUDGETS.totalGzipBytes, failures);

  if (failures.length > 0) {
    throw new Error(`Bundle budget failed:\n${failures.map(item => `- ${item}`).join('\n')}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
