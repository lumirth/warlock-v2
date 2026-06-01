import { mkdirSync, writeFileSync } from 'node:fs';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { GOLDEN_QUERIES } from '../apps/api/src/eval/golden-queries.js';
import { checkExpectedObject, checkExpectedResidual } from '../apps/api/src/eval/checks.js';
import { createSearchPlan } from '../apps/api/src/services/search-pipeline.js';
import { VALID_SUBJECTS } from '../apps/api/src/services/data/valid-subjects.js';
import type { EvalResult } from '../apps/api/src/eval/types.js';

type D1Row = Record<string, unknown>;

const SUBJECT_NAMES: Record<string, string> = {
  CHEM: 'Chemistry',
  CS: 'Computer Science',
  ECE: 'Electrical and Computer Engineering',
  ECON: 'Economics',
  MATH: 'Mathematics',
  RHET: 'Rhetoric',
  STAT: 'Statistics',
};

class EvalD1Statement {
  private params: unknown[] = [];

  constructor(private readonly sql: string) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = D1Row>(): Promise<T | null> {
    if (this.sql.includes('SELECT id FROM subjects WHERE id = ?')) {
      const code = String(this.params[0] ?? '').toUpperCase();
      return VALID_SUBJECTS.has(code) ? { id: code } as T : null;
    }

    if (this.sql.includes('SELECT id FROM subjects WHERE LOWER(name) = ?')) {
      const name = String(this.params[0] ?? '').toLowerCase();
      const code = Object.entries(SUBJECT_NAMES)
        .find(([, subjectName]) => subjectName.toLowerCase() === name)?.[0];
      return code ? { id: code } as T : null;
    }

    if (this.sql.includes('SELECT subject_id FROM subject_aliases WHERE alias = ?')) {
      const alias = String(this.params[0] ?? '').toLowerCase();
      if (alias === 'comp sci') return { subject_id: 'CS' } as T;
      return null;
    }

    if (this.sql.includes('SELECT id FROM subjects') && this.sql.includes('WHERE name LIKE ?')) {
      const needle = String(this.params[0] ?? '').replace(/%/g, '').toLowerCase();
      const code = Object.entries(SUBJECT_NAMES)
        .find(([subjectCode, subjectName]) =>
          subjectName.toLowerCase().includes(needle)
          || subjectCode.toLowerCase().includes(needle)
        )?.[0];
      return code ? { id: code } as T : null;
    }

    if (this.sql.includes('SELECT DISTINCT subject FROM courses WHERE subject = ?')) {
      const code = String(this.params[0] ?? '').toUpperCase();
      return VALID_SUBJECTS.has(code) ? { subject: code } as T : null;
    }

    if (this.sql.includes('SELECT name FROM subjects WHERE id = ?')) {
      const code = String(this.params[0] ?? '').toUpperCase();
      return { name: SUBJECT_NAMES[code] ?? code } as T;
    }

    return null;
  }

  async all<T = D1Row>(): Promise<D1Result<T>> {
    if (this.sql.includes('FROM instructors')) {
      return {
        results: [{ id: 1 }] as T[],
        success: true,
        meta: {},
      } as unknown as D1Result<T>;
    }

    return {
      results: [],
      success: true,
      meta: {},
    } as unknown as D1Result<T>;
  }
}

function createEvalDb(): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      return new EvalD1Statement(sql) as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function formatReport(results: EvalResult[]): string {
  const failures = results.filter(result => result.violations.length > 0);
  const lines = [
    '# Eval Smoke Report',
    '',
    `Total queries: ${results.length}`,
    `Passing queries: ${results.length - failures.length}`,
    `Failed queries: ${failures.length}`,
    `Violation count: ${results.reduce((sum, result) => sum + result.violations.length, 0)}`,
    '',
    '## Query Results',
    '',
  ];

  for (const result of results) {
    const status = result.violations.length === 0 ? 'PASS' : 'FAIL';
    lines.push(`- ${status} ${result.query.id}: ${result.query.query}`);
    for (const violation of result.violations) {
      lines.push(`  - ${violation}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const db = createEvalDb();
  const results: EvalResult[] = [];

  for (const query of GOLDEN_QUERIES) {
    const { extraction, plan } = await createSearchPlan(db, query.query);
    const actualFilters = { ...plan.filters };
    const violations = [
      ...checkExpectedObject('filters', query.expected_filters, actualFilters),
      ...checkExpectedObject('softPreferences', query.expected_soft_preferences, plan.softPreferences),
      ...checkExpectedResidual(query, extraction.residual),
    ];

    results.push({
      query,
      actualFilters,
      actualResidual: extraction.residual,
      results: [],
      reciprocalRank: null,
      violations,
      tierReached: null,
    });
  }

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/eval-smoke-report.md', formatReport(results));
  writeFileSync('artifacts/eval-smoke-results.json', `${JSON.stringify(results, null, 2)}\n`);

  const failures = results.filter(result => result.violations.length > 0);
  console.log(formatReport(results));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
