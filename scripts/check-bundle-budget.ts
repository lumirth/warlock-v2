import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

type AssetKind = 'js' | 'css' | 'image' | 'font' | 'other';

type AssetMeasurement = {
  file: string;
  kind: AssetKind;
  bytes: number;
  gzipBytes: number;
};

const DIST_DIR = 'apps/web/dist';

const BUDGETS = {
  // Raw size is a bundle hygiene guard. Keep enough headroom for the shadcn/Radix surface while
  // holding gzip budgets as the user-facing delivery guardrails.
  jsBytes: 445 * 1024,
  jsGzipBytes: 140 * 1024,
  cssBytes: 240 * 1024,
  cssGzipBytes: 40 * 1024,
  largestImageBytes: 160 * 1024,
  totalFontBytes: 120 * 1024,
  totalStaticBytes: 300 * 1024,
  totalJsCssGzipBytes: 190 * 1024,
  totalDistGzipBytes: 420 * 1024,
};

function formatBytes(value: number): string {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function kindFor(file: string): AssetKind | null {
  if (file.endsWith('.js')) return 'js';
  if (file.endsWith('.css')) return 'css';
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file)) return 'image';
  if (/\.(?:eot|otf|ttf|woff2?)$/i.test(file)) return 'font';
  return 'other';
}

async function measureAssets(): Promise<AssetMeasurement[]> {
  const files = await distributableFiles(DIST_DIR);
  const measurements: AssetMeasurement[] = [];

  for (const { file, path } of files) {
    const kind = kindFor(file);
    if (!kind) continue;

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

async function distributableFiles(root: string): Promise<Array<{
  file: string;
  path: string;
}>> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return distributableFiles(path);
    }
    return [{
      file: relative(DIST_DIR, path),
      path,
    }];
  }));
  return files.flat();
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
  if (
    measurements.length === 0
    || !measurements.some((item) => item.kind === 'js')
    || !measurements.some((item) => item.kind === 'css')
  ) {
    throw new Error(`No JS/CSS build assets found in ${DIST_DIR}; run npm run build first.`);
  }

  const largestJs = largest(measurements, 'js');
  const largestCss = largest(measurements, 'css');
  const largestImage = largest(measurements, 'image');
  const totalFont = sumByKind(measurements, 'font', 'bytes');
  const totalStatic = measurements
    .filter((item) => item.kind === 'image' || item.kind === 'font')
    .reduce((sum, item) => sum + item.bytes, 0);
  const totalJsCssGzip = measurements
    .filter((item) => item.kind === 'js' || item.kind === 'css')
    .reduce((sum, item) => sum + item.gzipBytes, 0);
  const totalDistGzip = measurements.reduce(
    (sum, item) => sum + item.gzipBytes,
    0,
  );
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
  if (largestImage) {
    console.log(`Largest image asset: ${largestImage.file}`);
    assertBudget(
      'largest image raw',
      largestImage.bytes,
      BUDGETS.largestImageBytes,
      failures,
    );
  }
  assertBudget('total font raw', totalFont, BUDGETS.totalFontBytes, failures);
  assertBudget(
    'total image/font raw',
    totalStatic,
    BUDGETS.totalStaticBytes,
    failures,
  );
  assertBudget(
    'total JS/CSS gzip',
    totalJsCssGzip,
    BUDGETS.totalJsCssGzipBytes,
    failures,
  );
  assertBudget(
    'total dist gzip',
    totalDistGzip,
    BUDGETS.totalDistGzipBytes,
    failures,
  );

  if (failures.length > 0) {
    throw new Error(`Bundle budget failed:\n${failures.map(item => `- ${item}`).join('\n')}`);
  }
}

function sumByKind(
  measurements: AssetMeasurement[],
  kind: AssetKind,
  field: 'bytes' | 'gzipBytes',
): number {
  return measurements
    .filter((item) => item.kind === kind)
    .reduce((sum, item) => sum + item[field], 0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
