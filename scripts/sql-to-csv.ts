#!/usr/bin/env npx tsx
/**
 * Convert INSERT statements to CSV files for fast SQLite import
 * Usage: npx tsx sql-to-csv.ts input.sql output_dir/
 */

import { createReadStream, createWriteStream, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

const inputFile = process.argv[2] || 'history_chunks/clean_history.sql';
const outputDir = process.argv[3] || 'history_chunks/csv';

mkdirSync(outputDir, { recursive: true });

// Track file handles per table
const writers: Map<string, ReturnType<typeof createWriteStream>> = new Map();
const counts: Map<string, number> = new Map();
const headers: Map<string, string> = new Map(); // Track headers per table

// Parse INSERT statement and extract table name, columns, and values
function parseInsert(line: string): { table: string; columns: string; values: string } | null {
  // Match: INSERT OR REPLACE INTO tablename (cols) VALUES (...);
  // or: INSERT OR IGNORE INTO tablename (cols) VALUES (...);
  const match = line.match(/^INSERT OR (?:REPLACE|IGNORE) INTO (\w+) \(([^)]+)\) VALUES \((.+)\);$/);
  if (!match) return null;
  return { table: match[1], columns: match[2], values: match[3] };
}

// Convert SQL values to CSV row
// SQL uses single quotes, CSV uses double quotes
function sqlValuesToCsv(values: string): string {
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
        // Escaped single quote
        current += "'";
        i++;
      } else if (char === "'") {
        // End of string
        current += '"';
        inString = false;
      } else if (char === '"') {
        // Escape double quote for CSV
        current += '""';
      } else if (char === '\n') {
        current += '\\n';
      } else {
        current += char;
      }
    }
    i++;
  }
  result.push(current.trim());

  return result.join(',');
}

async function main() {
  console.log(`Converting ${inputFile} to CSV files in ${outputDir}/`);

  const rl = createInterface({
    input: createReadStream(inputFile),
    crlfDelay: Infinity
  });

  let lineNum = 0;
  let skipped = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum % 100000 === 0) {
      console.log(`  Processed ${lineNum.toLocaleString()} lines...`);
    }

    // Skip SELECT subqueries (meeting_instructors uses them)
    if (line.includes('SELECT')) {
      skipped++;
      continue;
    }

    const parsed = parseInsert(line);
    if (!parsed) {
      skipped++;
      continue;
    }

    const { table, columns, values } = parsed;

    // Get or create writer for this table
    if (!writers.has(table)) {
      const filePath = join(outputDir, `${table}.csv`);
      const writer = createWriteStream(filePath);
      writers.set(table, writer);
      counts.set(table, 0);
      // Write header row (strip spaces from column names)
      headers.set(table, columns);
      writer.write(columns.split(',').map(c => c.trim()).join(',') + '\n');
    }

    const csvRow = sqlValuesToCsv(values);
    writers.get(table)!.write(csvRow + '\n');
    counts.set(table, (counts.get(table) || 0) + 1);
  }

  // Close all writers
  for (const writer of writers.values()) {
    writer.end();
  }

  console.log(`\nDone! Created CSV files:`);
  for (const [table, count] of counts) {
    console.log(`  ${table}: ${count.toLocaleString()} rows`);
  }
  console.log(`\nSkipped ${skipped.toLocaleString()} lines (SELECT subqueries, etc.)`);
}

main().catch(console.error);
