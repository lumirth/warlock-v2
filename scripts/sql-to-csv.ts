#!/usr/bin/env npx tsx
/**
 * Convert INSERT statements to CSV files for fast SQLite import.
 * Usage: npx tsx scripts/sql-to-csv.ts input.sql output_dir/
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

type InsertValues = {
  table: string;
  columns: string;
  values: string;
};

type ConversionSummary = {
  counts: Map<string, number>;
  skipped: number;
  postImportStatements: number;
};

type Writer = ReturnType<typeof createWriteStream>;

export function parseInsert(line: string): InsertValues | null {
  const match = line.match(/^INSERT OR (?:REPLACE|IGNORE) INTO (\w+) \(([^)]+)\) VALUES \((.+)\);$/);
  if (!match) return null;
  return { table: match[1], columns: match[2], values: match[3] };
}

function isPostImportInsert(line: string): boolean {
  return /^INSERT OR (?:REPLACE|IGNORE) INTO \w+ \([^)]+\) SELECT\b/i.test(line);
}

function closeWriter(writer: Writer): Promise<void> {
  return new Promise((resolve, reject) => {
    writer.once('error', reject);
    writer.end(resolve);
  });
}

export function sqlValuesToCsv(values: string): string {
  const result: string[] = [];
  let current = '';
  let inString = false;
  let i = 0;

  while (i < values.length) {
    const char = values[i];

    if (!inString) {
      if (char === "'") {
        inString = true;
        current = '"';
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else if (char === 'N' && values.slice(i, i + 4) === 'NULL') {
        current = '';
        i += 3;
      } else if (char !== ' ') {
        current += char;
      }
    } else {
      if (char === "'" && values[i + 1] === "'") {
        current += "'";
        i += 1;
      } else if (char === "'") {
        current += '"';
        inString = false;
      } else if (char === '"') {
        current += '""';
      } else if (char === '\n') {
        current += '\\n';
      } else {
        current += char;
      }
    }
    i += 1;
  }
  result.push(current.trim());

  return result.join(',');
}

export async function convertSqlToCsv(inputFile: string, outputDir: string): Promise<ConversionSummary> {
  await mkdir(outputDir, { recursive: true });

  const writers = new Map<string, Writer>();
  const counts = new Map<string, number>();
  let postImportWriter: Writer | null = null;
  let lineNum = 0;
  let skipped = 0;
  let postImportStatements = 0;

  function writerForTable(table: string, columns: string): Writer {
    const existing = writers.get(table);
    if (existing) return existing;

    const writer = createWriteStream(join(outputDir, `${table}.csv`));
    writers.set(table, writer);
    counts.set(table, 0);
    writer.write(`${columns.split(',').map(column => column.trim()).join(',')}\n`);
    return writer;
  }

  function writePostImport(line: string): void {
    postImportWriter ??= createWriteStream(join(outputDir, 'post-import.sql'));
    postImportWriter.write(`${line}\n`);
    postImportStatements += 1;
  }

  const rl = createInterface({
    input: createReadStream(inputFile),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNum += 1;
    if (lineNum % 100000 === 0) {
      console.log(`  Processed ${lineNum.toLocaleString()} lines...`);
    }

    if (isPostImportInsert(line)) {
      writePostImport(line);
      continue;
    }

    const parsed = parseInsert(line);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const writer = writerForTable(parsed.table, parsed.columns);
    writer.write(`${sqlValuesToCsv(parsed.values)}\n`);
    counts.set(parsed.table, (counts.get(parsed.table) ?? 0) + 1);
  }

  await Promise.all([
    ...Array.from(writers.values()).map(closeWriter),
    postImportWriter ? closeWriter(postImportWriter) : Promise.resolve(),
  ]);

  return { counts, skipped, postImportStatements };
}

async function main(): Promise<void> {
  const inputFile = process.argv[2] || 'history_chunks/clean_history.sql';
  const outputDir = process.argv[3] || 'history_chunks/csv';

  console.log(`Converting ${inputFile} to CSV files in ${outputDir}/`);
  const summary = await convertSqlToCsv(inputFile, outputDir);

  console.log('\nDone! Created CSV files:');
  for (const [table, count] of summary.counts) {
    console.log(`  ${table}: ${count.toLocaleString()} rows`);
  }
  if (summary.postImportStatements > 0) {
    console.log(`  post-import.sql: ${summary.postImportStatements.toLocaleString()} preserved INSERT ... SELECT statement(s)`);
  }
  console.log(`\nSkipped ${summary.skipped.toLocaleString()} non-insert line(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
