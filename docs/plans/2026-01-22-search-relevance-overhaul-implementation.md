# Search Relevance Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Comprehensive search relevance overhaul addressing 8 identified issues plus measurement infrastructure.

**Architecture:** Multi-phase approach starting with evaluation harness (measure first), then infrastructure (caching, logging), then fixes (extraction, enforcement, ranking), then validation. TDD throughout.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), Vitest, FTS5

---

## Phase 1: Foundation

### Task 1: Create Evaluation Harness Directory Structure

**Files:**
- Create: `apps/api/src/eval/index.ts`
- Create: `apps/api/src/eval/types.ts`
- Create: `apps/api/src/eval/runner.ts`
- Create: `apps/api/src/eval/metrics.ts`
- Create: `apps/api/src/eval/report.ts`

**Step 1: Create types file**

```typescript
// apps/api/src/eval/types.ts
export interface GoldQuery {
  id: number;
  query: string;
  expected_filters: Record<string, unknown>;
  expected_residual: string;
  expected_top1?: string;
  expected_top1_title?: string;
  invariants?: {
    subject?: string;
    level_gte?: number;
    level_lte?: number;
    gened_code?: string;
    no_subject?: string;
  };
  category: 'navigational' | 'structured' | 'semantic' | 'power_syntax' | 'edge_case_punctuation' | 'edge_case_range' | 'disambiguation';
  notes?: string;
}

export interface EvalResult {
  query: GoldQuery;
  actualFilters: Record<string, unknown>;
  actualResidual: string;
  results: Array<{ id: string; title: string; subject: string; number: string; gened?: string; avg_gpa?: number }>;
  reciprocalRank: number | null;  // null if no expected_top1
  violations: string[];  // list of violated invariants
  tierReached: number;
}

export interface EvalMetrics {
  totalQueries: number;
  mrr10: number;
  top1Accuracy: number;
  constraintViolationRate: number;
  zeroResultRate: number;
  byCategory: Record<string, { count: number; mrr: number; violations: number }>;
}
```

**Step 2: Create metrics calculation**

```typescript
// apps/api/src/eval/metrics.ts
import type { EvalResult, EvalMetrics } from './types.js';

export function calculateMetrics(results: EvalResult[]): EvalMetrics {
  const totalQueries = results.length;

  // MRR@10 - only for queries with expected_top1
  const queriesWithExpected = results.filter(r => r.query.expected_top1 || r.query.expected_top1_title);
  const sumReciprocalRank = queriesWithExpected.reduce((sum, r) => {
    if (r.reciprocalRank !== null && r.reciprocalRank > 0) {
      return sum + r.reciprocalRank;
    }
    return sum;
  }, 0);
  const mrr10 = queriesWithExpected.length > 0
    ? sumReciprocalRank / queriesWithExpected.length
    : 0;

  // Top-1 accuracy
  const top1Correct = queriesWithExpected.filter(r => r.reciprocalRank === 1).length;
  const top1Accuracy = queriesWithExpected.length > 0
    ? top1Correct / queriesWithExpected.length
    : 0;

  // Constraint violation rate
  const queriesWithInvariants = results.filter(r => r.query.invariants && Object.keys(r.query.invariants).length > 0);
  const queriesWithViolations = queriesWithInvariants.filter(r => r.violations.length > 0);
  const constraintViolationRate = queriesWithInvariants.length > 0
    ? queriesWithViolations.length / queriesWithInvariants.length
    : 0;

  // Zero result rate
  const zeroResults = results.filter(r => r.results.length === 0);
  const zeroResultRate = totalQueries > 0 ? zeroResults.length / totalQueries : 0;

  // By category
  const byCategory: Record<string, { count: number; mrr: number; violations: number }> = {};
  for (const result of results) {
    const cat = result.query.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { count: 0, mrr: 0, violations: 0 };
    }
    byCategory[cat].count++;
    if (result.reciprocalRank !== null) {
      byCategory[cat].mrr += result.reciprocalRank;
    }
    if (result.violations.length > 0) {
      byCategory[cat].violations++;
    }
  }
  // Normalize MRR per category
  for (const cat of Object.keys(byCategory)) {
    const catResults = results.filter(r => r.query.category === cat && r.reciprocalRank !== null);
    if (catResults.length > 0) {
      byCategory[cat].mrr = byCategory[cat].mrr / catResults.length;
    }
  }

  return {
    totalQueries,
    mrr10,
    top1Accuracy,
    constraintViolationRate,
    zeroResultRate,
    byCategory
  };
}
```

**Step 3: Create report generator**

```typescript
// apps/api/src/eval/report.ts
import type { EvalMetrics } from './types.js';

export function generateReport(metrics: EvalMetrics, label: string = 'Current'): string {
  const lines: string[] = [];

  lines.push(`\n=== Search Evaluation Report: ${label} ===\n`);
  lines.push(`Total Queries: ${metrics.totalQueries}`);
  lines.push(`MRR@10: ${(metrics.mrr10 * 100).toFixed(1)}%`);
  lines.push(`Top-1 Accuracy: ${(metrics.top1Accuracy * 100).toFixed(1)}%`);
  lines.push(`Constraint Violation Rate: ${(metrics.constraintViolationRate * 100).toFixed(1)}%`);
  lines.push(`Zero Result Rate: ${(metrics.zeroResultRate * 100).toFixed(1)}%`);

  lines.push(`\n--- By Category ---`);
  for (const [cat, data] of Object.entries(metrics.byCategory)) {
    lines.push(`${cat}: ${data.count} queries, MRR=${(data.mrr * 100).toFixed(1)}%, Violations=${data.violations}`);
  }

  return lines.join('\n');
}

export function compareReports(before: EvalMetrics, after: EvalMetrics): string {
  const lines: string[] = [];

  const delta = (a: number, b: number) => {
    const diff = b - a;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${(diff * 100).toFixed(1)}%`;
  };

  lines.push(`\n=== Before/After Comparison ===\n`);
  lines.push(`MRR@10: ${(before.mrr10 * 100).toFixed(1)}% → ${(after.mrr10 * 100).toFixed(1)}% (${delta(before.mrr10, after.mrr10)})`);
  lines.push(`Top-1 Accuracy: ${(before.top1Accuracy * 100).toFixed(1)}% → ${(after.top1Accuracy * 100).toFixed(1)}% (${delta(before.top1Accuracy, after.top1Accuracy)})`);
  lines.push(`Violations: ${(before.constraintViolationRate * 100).toFixed(1)}% → ${(after.constraintViolationRate * 100).toFixed(1)}% (${delta(before.constraintViolationRate, after.constraintViolationRate)})`);
  lines.push(`Zero Results: ${(before.zeroResultRate * 100).toFixed(1)}% → ${(after.zeroResultRate * 100).toFixed(1)}% (${delta(before.zeroResultRate, after.zeroResultRate)})`);

  return lines.join('\n');
}
```

**Step 4: Create index export**

```typescript
// apps/api/src/eval/index.ts
export * from './types.js';
export * from './metrics.js';
export * from './report.js';
```

**Step 5: Commit**

```bash
git add apps/api/src/eval/
git commit -m "feat(eval): add evaluation harness types and metrics"
```

---

### Task 2: Create Golden Queries Test Data

**Files:**
- Create: `apps/api/src/eval/golden-queries.ts`

**Step 1: Create golden queries file with first 50 queries**

```typescript
// apps/api/src/eval/golden-queries.ts
import type { GoldQuery } from './types.js';

export const GOLDEN_QUERIES: GoldQuery[] = [
  // === NAVIGATIONAL (Course Codes) ===
  {
    id: 1,
    query: "CS 225",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 2,
    query: "cs 225",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 3,
    query: "CS225",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 4,
    query: "STAT 400",
    expected_filters: { subject: "STAT", number: "400" },
    expected_residual: "",
    invariants: { subject: "STAT" },
    category: "navigational"
  },
  {
    id: 5,
    query: "ECE 110",
    expected_filters: { subject: "ECE", number: "110" },
    expected_residual: "",
    invariants: { subject: "ECE" },
    category: "navigational"
  },
  {
    id: 6,
    query: "MATH 241",
    expected_filters: { subject: "MATH", number: "241" },
    expected_residual: "",
    invariants: { subject: "MATH" },
    category: "navigational"
  },
  {
    id: 7,
    query: "RHET 105",
    expected_filters: { subject: "RHET", number: "105" },
    expected_residual: "",
    invariants: { subject: "RHET" },
    category: "navigational"
  },
  {
    id: 8,
    query: "CRN 12345",
    expected_filters: { crn: "12345" },
    expected_residual: "",
    category: "navigational"
  },
  {
    id: 9,
    query: "12345",
    expected_filters: { crn: "12345" },
    expected_residual: "",
    category: "navigational"
  },
  {
    id: 10,
    query: "econ",
    expected_filters: { subject: "ECON" },
    expected_residual: "",
    invariants: { subject: "ECON" },
    category: "navigational"
  },

  // === STRUCTURED (Single Filter) ===
  {
    id: 11,
    query: "easy humanities gen ed",
    expected_filters: { difficulty: "easy", gened_code: "HUM" },
    expected_residual: "",
    invariants: { gened_code: "HUM" },
    category: "structured",
    notes: "Residual should NOT contain 'gen ed'"
  },
  {
    id: 12,
    query: "3 credits",
    expected_filters: { credits: 3 },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 13,
    query: "MWF morning",
    expected_filters: { days: "MWF", time: "morning" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 14,
    query: "TR afternoon",
    expected_filters: { days: "TR", time: "afternoon" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 15,
    query: "400 level CS",
    expected_filters: { level: 400, subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS", level_gte: 400, level_lte: 499 },
    category: "structured"
  },
  {
    id: 16,
    query: "online courses",
    expected_filters: { online: true },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'courses'"
  },
  {
    id: 17,
    query: "in person classes",
    expected_filters: { online: false },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'classes'"
  },
  {
    id: 18,
    query: "quantitative reasoning",
    expected_filters: { gened_code: "QR" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 19,
    query: "natural sciences gen ed",
    expected_filters: { gened_code: "NAT" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 20,
    query: "open sections",
    expected_filters: { status: "open" },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'sections'"
  },

  // === STRUCTURED (Multi Filter) ===
  {
    id: 21,
    query: "400 level CS MWF morning 3 credits",
    expected_filters: { level: 400, subject: "CS", days: "MWF", time: "morning", credits: 3 },
    expected_residual: "",
    invariants: { subject: "CS", level_gte: 400, level_lte: 499 },
    category: "structured"
  },
  {
    id: 22,
    query: "easy humanities MWF afternoon",
    expected_filters: { difficulty: "easy", gened_code: "HUM", days: "MWF", time: "afternoon" },
    expected_residual: "",
    invariants: { gened_code: "HUM" },
    category: "structured"
  },
  {
    id: 23,
    query: "open 3 credit online",
    expected_filters: { status: "open", credits: 3, online: true },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 24,
    query: "graduate algorithms",
    expected_filters: { level: 500 },
    expected_residual: "algorithms",
    invariants: { level_gte: 500 },
    category: "structured"
  },
  {
    id: 25,
    query: "beginner spanish",
    expected_filters: { level: 100 },
    expected_residual: "spanish",
    category: "structured"
  },

  // === SEMANTIC ===
  {
    id: 26,
    query: "data structures",
    expected_filters: {},
    expected_residual: "data structures",
    expected_top1_title: "Data Structures",
    category: "semantic"
  },
  {
    id: 27,
    query: "machine learning",
    expected_filters: {},
    expected_residual: "machine learning",
    category: "semantic"
  },
  {
    id: 28,
    query: "artificial intelligence",
    expected_filters: {},
    expected_residual: "artificial intelligence",
    category: "semantic"
  },
  {
    id: 29,
    query: "organic chemistry",
    expected_filters: {},
    expected_residual: "organic chemistry",
    category: "semantic"
  },
  {
    id: 30,
    query: "linear algebra",
    expected_filters: {},
    expected_residual: "linear algebra",
    category: "semantic"
  },

  // === POWER SYNTAX ===
  {
    id: 31,
    query: "gened:HUM",
    expected_filters: { gened_code: "HUM" },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 32,
    query: "gened:HUM easy",
    expected_filters: { gened_code: "HUM", difficulty: "easy" },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 33,
    query: "gened:any(HUM,US)",
    expected_filters: { gened_any: ["HUM", "US"] },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 34,
    query: "gened:any(HUM, US) morning",
    expected_filters: { gened_any: ["HUM", "US"], time: "morning" },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 35,
    query: "subject:CS 400 level",
    expected_filters: { subject: "CS", level: 400 },
    expected_residual: "",
    category: "power_syntax"
  },

  // === NEGATION ===
  {
    id: 36,
    query: "no morning classes",
    expected_filters: { not: { time: ["morning"] } },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'classes'"
  },
  {
    id: 37,
    query: "avoid friday",
    expected_filters: { not: { days: ["friday"] } },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 38,
    query: "not online",
    expected_filters: { online: false },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 39,
    query: "CS -online",
    expected_filters: { subject: "CS" },
    expected_residual: "",
    category: "power_syntax"
  },

  // === INSTRUCTOR ===
  {
    id: 40,
    query: "CS 225 with Fagen",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 41,
    query: "Professor Smith CHEM",
    expected_filters: { subject: "CHEM" },
    expected_residual: "",
    category: "structured"
  },

  // === DISAMBIGUATION ===
  {
    id: 42,
    query: "CS courses",
    expected_filters: { subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "disambiguation",
    notes: "CS = Computer Science subject, not Cultural Studies gened"
  },
  {
    id: 43,
    query: "cultural studies gened",
    expected_filters: { gened_code: "CS" },
    expected_residual: "",
    category: "disambiguation"
  },
  {
    id: 44,
    query: "humanities gen ed",
    expected_filters: { gened_code: "HUM" },
    expected_residual: "",
    category: "disambiguation"
  },

  // === TERM EXTRACTION ===
  {
    id: 45,
    query: "CS spring 2026",
    expected_filters: { subject: "CS", term: "spring", year: 2026 },
    expected_residual: "",
    category: "structured",
    notes: "Term extraction"
  },
  {
    id: 46,
    query: "fall 2025 MATH",
    expected_filters: { subject: "MATH", term: "fall", year: 2025 },
    expected_residual: "",
    category: "structured"
  },

  // === STOP PHRASE TESTS ===
  {
    id: 47,
    query: "easy online gen ed",
    expected_filters: { difficulty: "easy", online: true },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'gen ed'"
  },
  {
    id: 48,
    query: "gpa booster",
    expected_filters: { difficulty: "easy" },
    expected_residual: "",
    category: "structured",
    notes: "Should not leave 'booster' in residual"
  },
  {
    id: 49,
    query: "writing intensive courses",
    expected_filters: { gened_code: "ACP" },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'courses'"
  },

  // === INTRO AS BOOST ===
  {
    id: 50,
    query: "intro to compilers",
    expected_filters: {},
    expected_residual: "intro to compilers",
    category: "semantic",
    notes: "intro should NOT force level=100 for compilers"
  },
];
```

**Step 2: Commit**

```bash
git add apps/api/src/eval/golden-queries.ts
git commit -m "feat(eval): add 50 golden queries for evaluation"
```

---

### Task 3: Create Evaluation Runner

**Files:**
- Create: `apps/api/src/eval/runner.ts`
- Modify: `apps/api/package.json` (add eval script)

**Step 1: Create runner**

```typescript
// apps/api/src/eval/runner.ts
import type { GoldQuery, EvalResult } from './types.js';
import { GOLDEN_QUERIES } from './golden-queries.js';
import { calculateMetrics } from './metrics.js';
import { generateReport } from './report.js';

interface SearchResult {
  course: {
    id: string;
    title: string;
    subject: string;
    number: string;
    avg_gpa?: number;
  };
  score: number;
}

interface SearchResponse {
  results: SearchResult[];
  meta: {
    plan: {
      filters: Record<string, unknown>;
    };
    extraction: {
      hints: unknown[];
    };
    query: {
      residual: string;
    };
  };
}

function checkInvariants(query: GoldQuery, results: SearchResult[]): string[] {
  const violations: string[] = [];
  if (!query.invariants) return violations;

  for (const result of results) {
    const course = result.course;

    if (query.invariants.subject && course.subject !== query.invariants.subject) {
      violations.push(`Result ${course.id} has subject=${course.subject}, expected ${query.invariants.subject}`);
    }

    if (query.invariants.level_gte) {
      const level = parseInt(course.number.charAt(0)) * 100;
      if (level < query.invariants.level_gte) {
        violations.push(`Result ${course.id} is level ${level}, expected >= ${query.invariants.level_gte}`);
      }
    }

    if (query.invariants.level_lte) {
      const level = parseInt(course.number.charAt(0)) * 100;
      if (level > query.invariants.level_lte) {
        violations.push(`Result ${course.id} is level ${level}, expected <= ${query.invariants.level_lte}`);
      }
    }

    if (query.invariants.no_subject && course.subject === query.invariants.no_subject) {
      violations.push(`Result ${course.id} has forbidden subject=${course.subject}`);
    }
  }

  return violations;
}

function calculateReciprocalRank(query: GoldQuery, results: SearchResult[]): number | null {
  if (!query.expected_top1 && !query.expected_top1_title) {
    return null;
  }

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const course = results[i].course;

    if (query.expected_top1) {
      // Match by ID pattern (e.g., "CS-225-*")
      const pattern = query.expected_top1.replace('*', '.*');
      if (new RegExp(`^${pattern}$`).test(course.id)) {
        return 1 / (i + 1);
      }
    }

    if (query.expected_top1_title) {
      if (course.title.toLowerCase().includes(query.expected_top1_title.toLowerCase())) {
        return 1 / (i + 1);
      }
    }
  }

  return 0;  // Not found in top 10
}

export async function runEvaluation(baseUrl: string): Promise<void> {
  console.log(`Running evaluation against ${baseUrl}...`);
  console.log(`Total queries: ${GOLDEN_QUERIES.length}\n`);

  const evalResults: EvalResult[] = [];

  for (const query of GOLDEN_QUERIES) {
    try {
      const url = `${baseUrl}/api/search?q=${encodeURIComponent(query.query)}&limit=20`;
      const response = await fetch(url);
      const data = await response.json() as SearchResponse;

      const results = data.results.map(r => ({
        id: r.course.id,
        title: r.course.title,
        subject: r.course.subject,
        number: r.course.number,
        avg_gpa: r.course.avg_gpa
      }));

      const violations = checkInvariants(query, data.results);
      const reciprocalRank = calculateReciprocalRank(query, data.results);

      evalResults.push({
        query,
        actualFilters: data.meta.plan.filters,
        actualResidual: data.meta.query.residual,
        results,
        reciprocalRank,
        violations,
        tierReached: 0  // TODO: extract from meta
      });

      // Progress indicator
      const status = violations.length > 0 ? '✗' : '✓';
      console.log(`${status} [${query.id}] "${query.query}" - ${results.length} results, ${violations.length} violations`);

    } catch (error) {
      console.error(`✗ [${query.id}] "${query.query}" - ERROR: ${error}`);
      evalResults.push({
        query,
        actualFilters: {},
        actualResidual: '',
        results: [],
        reciprocalRank: 0,
        violations: [`Fetch error: ${error}`],
        tierReached: 0
      });
    }
  }

  const metrics = calculateMetrics(evalResults);
  console.log(generateReport(metrics));
}

// CLI entry point
const baseUrl = process.argv[2] || 'http://localhost:8787';
runEvaluation(baseUrl).catch(console.error);
```

**Step 2: Add npm script to package.json**

Modify `apps/api/package.json` to add:

```json
{
  "scripts": {
    "eval": "npx tsx src/eval/runner.ts"
  }
}
```

**Step 3: Commit**

```bash
git add apps/api/src/eval/runner.ts apps/api/package.json
git commit -m "feat(eval): add evaluation runner with CLI"
```

---

### Task 4: Create Database Migrations for Aliases

**Files:**
- Create: `migrations/003-gened-aliases.sql`
- Create: `migrations/004-topic-aliases.sql`
- Create: `migrations/005-search-logs.sql`

**Step 1: Create gened_aliases migration**

```sql
-- migrations/003-gened-aliases.sql
-- Gen-Ed alias table for natural language recognition

CREATE TABLE IF NOT EXISTS gened_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gened_code TEXT NOT NULL,
    alias TEXT NOT NULL,
    UNIQUE(gened_code, alias)
);

CREATE INDEX IF NOT EXISTS idx_gened_aliases_alias ON gened_aliases(alias);

-- Insert default aliases
INSERT OR IGNORE INTO gened_aliases (gened_code, alias) VALUES
  -- Composition
  ('CMP', 'composition'),
  ('CMP', 'writing'),
  ('CMP', 'freshman comp'),
  ('ACP', 'advanced composition'),
  ('ACP', 'adv comp'),
  ('ACP', 'writing intensive'),

  -- Humanities & Arts
  ('HUM', 'humanities'),
  ('HUM', 'humanities and the arts'),
  ('HUM', 'arts'),
  ('HP', 'historical'),
  ('HP', 'philosophical'),
  ('HP', 'history'),
  ('HP', 'philosophy'),
  ('LA', 'literature'),
  ('LA', 'lit'),

  -- Natural Sciences
  ('NAT', 'natural sciences'),
  ('NAT', 'nat sci'),
  ('NAT', 'science'),
  ('PS', 'physical sciences'),
  ('PS', 'physical'),
  ('LS', 'life sciences'),
  ('LS', 'life sci'),
  ('LS', 'biology'),

  -- Social & Behavioral Sciences
  ('SBS', 'social science'),
  ('SBS', 'social sciences'),
  ('SBS', 'behavioral science'),
  ('SBS', 'behavioral sciences'),
  ('SBS', 'social and behavioral'),

  -- Cultural Studies
  ('CS', 'cultural studies'),
  ('NW', 'non-western'),
  ('NW', 'non western'),
  ('NW', 'nonwestern'),
  ('US', 'us minority'),
  ('US', 'minority cultures'),
  ('WCC', 'western'),
  ('WCC', 'western comparative'),

  -- Quantitative Reasoning
  ('QR', 'quantitative'),
  ('QR', 'quant'),
  ('QR', 'quantitative reasoning'),
  ('QR1', 'qr1'),
  ('QR1', 'qr 1'),
  ('QR1', 'quantitative reasoning 1'),
  ('QR2', 'qr2'),
  ('QR2', 'qr 2'),
  ('QR2', 'quantitative reasoning 2');
```

**Step 2: Create topic_aliases migration**

```sql
-- migrations/004-topic-aliases.sql
-- Topic expansion aliases for search

CREATE TABLE IF NOT EXISTS topic_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    abbreviation TEXT NOT NULL UNIQUE,
    expansion TEXT NOT NULL
);

-- Insert default topic expansions
INSERT OR IGNORE INTO topic_aliases (abbreviation, expansion) VALUES
  ('ai', 'artificial intelligence'),
  ('ml', 'machine learning'),
  ('os', 'operating systems'),
  ('ui', 'user interface'),
  ('vr', 'virtual reality'),
  ('ar', 'augmented reality'),
  ('db', 'database'),
  ('hci', 'human computer interaction'),
  ('nlp', 'natural language processing'),
  ('crypto', 'cryptography'),
  ('sec', 'security'),
  ('swe', 'software engineering'),
  ('dist', 'distributed systems'),
  ('graphics', 'computer graphics'),
  ('viz', 'visualization'),
  ('ds', 'data science'),
  ('stats', 'statistics');
```

**Step 3: Create search_logs migration**

```sql
-- migrations/005-search-logs.sql
-- Query logging for analysis

CREATE TABLE IF NOT EXISTS search_logs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  raw_query TEXT NOT NULL,

  -- Extraction results (JSON)
  hints_json TEXT,
  filters_json TEXT,
  residual TEXT,

  -- Execution info
  is_navigational INTEGER,
  tier_reached REAL,
  constraints_relaxed TEXT,

  -- Results summary
  result_count INTEGER,
  top5_ids TEXT,

  -- Performance
  total_ms INTEGER,

  -- For sampling
  sample_bucket INTEGER
);

CREATE INDEX IF NOT EXISTS idx_search_logs_timestamp ON search_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_search_logs_zero ON search_logs(result_count) WHERE result_count = 0;
CREATE INDEX IF NOT EXISTS idx_search_logs_tier ON search_logs(tier_reached);
```

**Step 4: Commit**

```bash
git add migrations/
git commit -m "feat(db): add migrations for gened_aliases, topic_aliases, search_logs"
```

---

## Phase 2: Infrastructure

### Task 5: Create Taxonomy Cache

**Files:**
- Create: `apps/api/src/services/taxonomy-cache.ts`
- Create: `apps/api/src/services/__tests__/taxonomy-cache.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/src/services/__tests__/taxonomy-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaxonomyCache, loadTaxonomyCache } from '../taxonomy-cache.js';

const mockDb = {
  prepare: vi.fn(() => ({
    all: vi.fn()
  }))
};

describe('TaxonomyCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadTaxonomyCache', () => {
    it('loads subjects from database', async () => {
      const mockSubjects = { results: [
        { id: 'CS', name: 'Computer Science' },
        { id: 'MATH', name: 'Mathematics' }
      ]};
      const mockSubjectAliases = { results: [
        { subject_id: 'CS', alias: 'computer science' },
        { subject_id: 'CS', alias: 'comp sci' }
      ]};
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.subjects.byCode.get('CS')).toEqual({ id: 'CS', name: 'Computer Science' });
      expect(cache.subjects.byAlias.get('computer science')).toBe('CS');
      expect(cache.subjects.byAlias.get('comp sci')).toBe('CS');
    });

    it('normalizes aliases to lowercase', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [{ subject_id: 'CS', alias: 'COMP SCI' }] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.subjects.byAlias.get('comp sci')).toBe('CS');
    });
  });

  describe('TaxonomyCache.resolveSubject', () => {
    it('resolves subject code directly', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.resolveSubject('CS')).toBe('CS');
      expect(cache.resolveSubject('cs')).toBe('CS');
    });

    it('resolves subject from alias', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [{ subject_id: 'CS', alias: 'computer science' }] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.resolveSubject('computer science')).toBe('CS');
    });

    it('returns null for unknown subject', async () => {
      const mockSubjects = { results: [{ id: 'CS', name: 'Computer Science' }] };
      const mockSubjectAliases = { results: [] };
      const mockGenedAliases = { results: [] };
      const mockTopicAliases = { results: [] };

      mockDb.prepare.mockReturnValue({
        all: vi.fn()
          .mockResolvedValueOnce(mockSubjects)
          .mockResolvedValueOnce(mockSubjectAliases)
          .mockResolvedValueOnce(mockGenedAliases)
          .mockResolvedValueOnce(mockTopicAliases)
      });

      const cache = await loadTaxonomyCache(mockDb as any);

      expect(cache.resolveSubject('xyz')).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run src/services/__tests__/taxonomy-cache.test.ts
```

Expected: FAIL with "Cannot find module '../taxonomy-cache.js'"

**Step 3: Write implementation**

```typescript
// apps/api/src/services/taxonomy-cache.ts
import type { D1Database } from '@cloudflare/workers-types';

export interface SubjectInfo {
  id: string;
  name: string;
}

export interface GenedInfo {
  code: string;
  name?: string;
}

export interface TaxonomyCache {
  subjects: {
    byCode: Map<string, SubjectInfo>;
    byAlias: Map<string, string>;  // lowercase alias → code
  };
  geneds: {
    byCode: Map<string, GenedInfo>;
    byAlias: Map<string, string>;  // lowercase alias → code
  };
  topics: Map<string, string>;  // abbreviation → expansion
  loadedAt: number;

  // Helper methods
  resolveSubject(input: string): string | null;
  resolveGened(input: string): string | null;
  expandTopic(input: string): string | null;
  findSubjectInText(text: string): { code: string; match: string; index: number } | null;
}

export async function loadTaxonomyCache(db: D1Database): Promise<TaxonomyCache> {
  // Load subjects
  const subjectsResult = await db.prepare('SELECT id, name FROM subjects').all<{ id: string; name: string }>();
  const subjectAliasesResult = await db.prepare('SELECT subject_id, alias FROM subject_aliases').all<{ subject_id: string; alias: string }>();

  // Load geneds
  const genedAliasesResult = await db.prepare('SELECT gened_code, alias FROM gened_aliases').all<{ gened_code: string; alias: string }>();

  // Load topics
  const topicAliasesResult = await db.prepare('SELECT abbreviation, expansion FROM topic_aliases').all<{ abbreviation: string; expansion: string }>();

  // Build subject maps
  const subjectsByCode = new Map<string, SubjectInfo>();
  const subjectsByAlias = new Map<string, string>();

  for (const subject of subjectsResult.results) {
    subjectsByCode.set(subject.id, subject);
    // Also add the code itself as an alias (lowercase)
    subjectsByAlias.set(subject.id.toLowerCase(), subject.id);
    // And the full name
    subjectsByAlias.set(subject.name.toLowerCase(), subject.id);
  }

  for (const alias of subjectAliasesResult.results) {
    subjectsByAlias.set(alias.alias.toLowerCase(), alias.subject_id);
  }

  // Build gened maps
  const genedsByCode = new Map<string, GenedInfo>();
  const genedsByAlias = new Map<string, string>();

  for (const alias of genedAliasesResult.results) {
    if (!genedsByCode.has(alias.gened_code)) {
      genedsByCode.set(alias.gened_code, { code: alias.gened_code });
    }
    genedsByAlias.set(alias.alias.toLowerCase(), alias.gened_code);
    // Also add the code itself
    genedsByAlias.set(alias.gened_code.toLowerCase(), alias.gened_code);
  }

  // Build topic map
  const topics = new Map<string, string>();
  for (const topic of topicAliasesResult.results) {
    topics.set(topic.abbreviation.toLowerCase(), topic.expansion);
  }

  const cache: TaxonomyCache = {
    subjects: { byCode: subjectsByCode, byAlias: subjectsByAlias },
    geneds: { byCode: genedsByCode, byAlias: genedsByAlias },
    topics,
    loadedAt: Date.now(),

    resolveSubject(input: string): string | null {
      const normalized = input.toLowerCase().trim();
      return this.subjects.byAlias.get(normalized) || null;
    },

    resolveGened(input: string): string | null {
      const normalized = input.toLowerCase().trim();
      return this.geneds.byAlias.get(normalized) || null;
    },

    expandTopic(input: string): string | null {
      const normalized = input.toLowerCase().trim();
      return this.topics.get(normalized) || null;
    },

    findSubjectInText(text: string): { code: string; match: string; index: number } | null {
      const normalized = text.toLowerCase();

      // Sort aliases by length (longest first) to match "computer science" before "cs"
      const sortedAliases = [...this.subjects.byAlias.entries()]
        .sort((a, b) => b[0].length - a[0].length);

      for (const [alias, code] of sortedAliases) {
        // Match as whole word
        const regex = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
        const match = regex.exec(normalized);
        if (match) {
          return { code, match: match[0], index: match.index };
        }
      }

      return null;
    }
  };

  return cache;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Global cache instance
let globalCache: TaxonomyCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours

export async function getTaxonomyCache(db: D1Database): Promise<TaxonomyCache> {
  if (globalCache && (Date.now() - globalCache.loadedAt) < CACHE_TTL_MS) {
    return globalCache;
  }

  globalCache = await loadTaxonomyCache(db);
  return globalCache;
}

export function clearTaxonomyCache(): void {
  globalCache = null;
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run src/services/__tests__/taxonomy-cache.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/taxonomy-cache.ts apps/api/src/services/__tests__/taxonomy-cache.test.ts
git commit -m "feat: add taxonomy cache for subjects, geneds, topics"
```

---

### Task 6: Add Query Logging

**Files:**
- Create: `apps/api/src/services/query-logger.ts`
- Modify: `apps/api/src/services/search-pipeline.ts`

**Step 1: Create query logger**

```typescript
// apps/api/src/services/query-logger.ts
import type { D1Database } from '@cloudflare/workers-types';
import type { SearchPipelineResult } from './search-pipeline.js';

const SAMPLE_RATE = 0.10;  // 10%

function shouldLog(): boolean {
  return Math.random() < SAMPLE_RATE;
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function logSearch(
  db: D1Database,
  rawQuery: string,
  result: SearchPipelineResult,
  isNavigational: boolean,
  tierReached: number,
  constraintsRelaxed: string[]
): Promise<void> {
  if (!shouldLog()) {
    return;
  }

  const id = generateId();
  const timestamp = Date.now();

  const hintsJson = JSON.stringify(result.meta.extraction.hints);
  const filtersJson = JSON.stringify(result.meta.plan.filters);
  const residual = result.meta.query.residual;

  const resultCount = result.results.length;
  const top5Ids = JSON.stringify(result.results.slice(0, 5).map(r => r.course.id));

  const totalMs = result.meta.timing.total_ms;
  const sampleBucket = Math.floor(Math.random() * 100);

  try {
    await db.prepare(`
      INSERT INTO search_logs (
        id, timestamp, raw_query,
        hints_json, filters_json, residual,
        is_navigational, tier_reached, constraints_relaxed,
        result_count, top5_ids, total_ms, sample_bucket
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, timestamp, rawQuery,
      hintsJson, filtersJson, residual,
      isNavigational ? 1 : 0, tierReached, JSON.stringify(constraintsRelaxed),
      resultCount, top5Ids, totalMs, sampleBucket
    ).run();
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Failed to log search:', error);
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/services/query-logger.ts
git commit -m "feat: add query logging with 10% sampling"
```

---

## Phase 3: Extraction Fixes

### Task 7: Add Stop-Phrase Removal

**Files:**
- Modify: `apps/api/src/services/extractor.ts`
- Modify: `apps/api/src/services/__tests__/extractor.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/extractor.test.ts`:

```typescript
describe('stop-phrase removal', () => {
  it('removes "gen ed" from residual', () => {
    const result = extract('easy humanities gen ed');
    expect(result.residual).not.toContain('gen ed');
    expect(result.residual.trim()).toBe('');
  });

  it('removes "sections" from residual', () => {
    const result = extract('open sections');
    expect(result.residual).not.toContain('sections');
  });

  it('removes "courses" from residual', () => {
    const result = extract('online courses');
    expect(result.residual).not.toContain('courses');
  });

  it('removes "classes" from residual', () => {
    const result = extract('morning classes');
    expect(result.residual).not.toContain('classes');
  });

  it('removes "booster" from residual', () => {
    const result = extract('gpa booster');
    expect(result.residual).not.toContain('booster');
  });

  it('removes "only" from residual', () => {
    const result = extract('online only');
    expect(result.residual).not.toContain('only');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts -t "stop-phrase"
```

Expected: FAIL

**Step 3: Add stop-phrase removal to extractor.ts**

Add after line 49 in `apps/api/src/services/extractor.ts`:

```typescript
// Stop-phrase removal - high-frequency generic tokens
const STOP_PHRASES = [
  'gen ed', 'gened', 'gen-ed',
  'section', 'sections',
  'class', 'classes',
  'course', 'courses',
  'only', 'booster'
];

function removeStopPhrases(text: string): string {
  let result = text;
  for (const phrase of STOP_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
    result = result.replace(regex, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}
```

And modify the end of the `extract` function to call it:

```typescript
// Clean up residual
residual = residual.replace(/\s+/g, ' ').trim();

// Remove stop-phrases
residual = removeStopPhrases(residual);

return { hints, residual };
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts -t "stop-phrase"
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/extractor.ts apps/api/src/services/__tests__/extractor.test.ts
git commit -m "feat(extractor): remove stop-phrases from residual"
```

---

### Task 8: Add Term Extraction

**Files:**
- Modify: `apps/api/src/services/extractor.ts`
- Modify: `apps/api/src/services/__tests__/extractor.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/extractor.test.ts`:

```typescript
describe('term extraction', () => {
  it('extracts "spring 2026"', () => {
    const result = extract('CS spring 2026');
    expect(result.hints).toContainEqual(
      expect.objectContaining({
        type: 'term',
        value: { term: 'spring', year: 2026 }
      })
    );
  });

  it('extracts "fall 2025"', () => {
    const result = extract('fall 2025 MATH');
    expect(result.hints).toContainEqual(
      expect.objectContaining({
        type: 'term',
        value: { term: 'fall', year: 2025 }
      })
    );
  });

  it('extracts "summer 2026"', () => {
    const result = extract('summer 2026 online');
    expect(result.hints).toContainEqual(
      expect.objectContaining({
        type: 'term',
        value: { term: 'summer', year: 2026 }
      })
    );
  });

  it('removes term from residual', () => {
    const result = extract('CS spring 2026');
    expect(result.residual).not.toContain('spring');
    expect(result.residual).not.toContain('2026');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts -t "term extraction"
```

Expected: FAIL

**Step 3: Add term extraction**

Add to `apps/api/src/services/extractor.ts` in the `extract` function, after extracting course codes:

```typescript
function extractTerms(text: string, hints: Hint[]): string {
  let residual = text;
  const termRegex = /\b(spring|fall|summer|winter)\s*(20\d{2})\b/gi;

  let match;
  const matches: { index: number; length: number }[] = [];

  while ((match = termRegex.exec(text)) !== null) {
    hints.push({
      type: 'term',
      value: { term: match[1].toLowerCase(), year: parseInt(match[2]) },
      metadata: createMetadata('regex', match[0], 0.95),
    });
    matches.push({ index: match.index, length: match[0].length });
  }

  // Mask matches in reverse order
  for (let i = matches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, matches[i].index, matches[i].length);
  }

  return residual;
}
```

Call it in the extract function after extracting course codes:

```typescript
// Pass 1.5: Term extraction
residual = extractTerms(residual, hints);
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts -t "term extraction"
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/extractor.ts apps/api/src/services/__tests__/extractor.test.ts
git commit -m "feat(extractor): add term extraction (spring 2026, fall 2025, etc.)"
```

---

### Task 9: Make "intro" a Boost Instead of Filter

**Files:**
- Modify: `apps/api/src/services/extractor.ts`
- Modify: `apps/api/src/services/__tests__/extractor.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/extractor.test.ts`:

```typescript
describe('intro as boost', () => {
  it('extracts "intro" as levelBoost, not level', () => {
    const result = extract('intro to compilers');

    // Should NOT have a level hint
    const levelHints = result.hints.filter(h => h.type === 'level');
    expect(levelHints).toHaveLength(0);

    // Should have a levelBoost hint
    const boostHints = result.hints.filter(h => h.type === 'levelBoost');
    expect(boostHints).toHaveLength(1);
    expect(boostHints[0].value).toBe(100);
  });

  it('explicit level overrides intro boost', () => {
    const result = extract('intro to compilers 400 level');

    // Should have level=400 from explicit "400 level"
    const levelHints = result.hints.filter(h => h.type === 'level');
    expect(levelHints).toHaveLength(1);
    expect(levelHints[0].value).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts -t "intro as boost"
```

Expected: FAIL

**Step 3: Modify level keyword handling**

In `apps/api/src/services/extractor.ts`, change the LEVEL_KEYWORDS handling:

```typescript
const LEVEL_KEYWORDS_HARD: Record<string, number> = {
  'advanced': 400,
  'upper': 400,
  'graduate': 500,
  'grad': 500,
};

const LEVEL_KEYWORDS_SOFT: Record<string, number> = {
  'intro': 100,
  'introductory': 100,
  'beginner': 100,
};
```

And update the extraction logic:

```typescript
// 3. Hard level keywords (filter)
for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS_HARD)) {
  const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
  let kMatch;
  const kMatches: { index: number; length: number }[] = [];
  while ((kMatch = keywordRegex.exec(residual)) !== null) {
    hints.push({
      type: 'level',
      value: level,
      metadata: createMetadata('regex', kMatch[0], 0.7),
    });
    kMatches.push({ index: kMatch.index, length: kMatch[0].length });
  }
  for (let i = kMatches.length - 1; i >= 0; i--) {
    residual = maskRange(residual, kMatches[i].index, kMatches[i].length);
  }
}

// 4. Soft level keywords (boost only)
for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS_SOFT)) {
  const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
  let kMatch;
  const kMatches: { index: number; length: number }[] = [];
  while ((kMatch = keywordRegex.exec(residual)) !== null) {
    hints.push({
      type: 'levelBoost',
      value: level,
      metadata: createMetadata('regex', kMatch[0], 0.5),
    });
    kMatches.push({ index: kMatch.index, length: kMatch[0].length });
  }
  // Don't mask - leave in residual for semantic matching
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts -t "intro as boost"
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/extractor.ts apps/api/src/services/__tests__/extractor.test.ts
git commit -m "feat(extractor): make intro/beginner a boost instead of hard filter"
```

---

## Phase 4: Enforcement + Ranking

### Task 10: Add Semantic Post-Filter

**Files:**
- Modify: `apps/api/src/services/search.ts`
- Modify: `apps/api/src/services/__tests__/hybrid-search.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/hybrid-search.test.ts`:

```typescript
describe('semantic post-filtering', () => {
  it('filters semantic results by gened_code', async () => {
    // This test verifies that semantic results are post-filtered
    // to enforce constraints the semantic channel cannot handle

    // Mock setup would go here - testing that results violating
    // gened_code constraint are removed before RRF fusion
  });
});
```

**Step 2: Add post-filter logic to search.ts**

In `apps/api/src/services/search.ts`, add after the semantic search call in `hybridSearch`:

```typescript
// Post-filter semantic results for constraints Vectorize can't handle
async function postFilterSemanticResults(
  db: D1Database,
  semanticResults: { id: string; score: number }[],
  filters: SearchFilters
): Promise<{ id: string; score: number }[]> {
  if (semanticResults.length === 0) return [];

  const needsFilter = filters.gened_code || filters.credits !== undefined ||
                      filters.difficulty || filters.days || filters.time ||
                      filters.online !== undefined || filters.status;

  if (!needsFilter) return semanticResults;

  // Fetch course data for filtering
  const courseIds = semanticResults.map(r => r.id);
  const placeholders = courseIds.map(() => '?').join(',');

  const coursesResult = await db.prepare(`
    SELECT c.id, c.credit_hours, c.avg_gpa,
           GROUP_CONCAT(DISTINCT cg.category_id) as geneds
    FROM courses c
    LEFT JOIN course_gened cg ON cg.course_id = c.id
    WHERE c.id IN (${placeholders})
    GROUP BY c.id
  `).bind(...courseIds).all<{
    id: string;
    credit_hours: number | null;
    avg_gpa: number | null;
    geneds: string | null;
  }>();

  const courseMap = new Map(coursesResult.results.map(c => [c.id, c]));

  return semanticResults.filter(r => {
    const course = courseMap.get(r.id);
    if (!course) return false;

    // GenEd filter
    if (filters.gened_code) {
      const geneds = course.geneds?.split(',') || [];
      if (!geneds.includes(filters.gened_code)) return false;
    }

    // Credits filter
    if (filters.credits !== undefined && course.credit_hours !== filters.credits) {
      return false;
    }

    // Difficulty filter
    if (filters.difficulty === 'easy' && (course.avg_gpa || 0) < 3.5) {
      return false;
    }
    if (filters.difficulty === 'hard' && (course.avg_gpa || 0) > 3.0) {
      return false;
    }

    return true;
  });
}
```

Then call it in `hybridSearch` after the semantic search:

```typescript
let filteredSemanticResults = semanticResults;
if (semanticResults.length > 0 && Object.keys(plan.filters).length > 0) {
  filteredSemanticResults = await postFilterSemanticResults(db, semanticResults, plan.filters);
}
```

And use `filteredSemanticResults` instead of `semanticResults` for the RRF fusion.

**Step 3: Commit**

```bash
git add apps/api/src/services/search.ts apps/api/src/services/__tests__/hybrid-search.test.ts
git commit -m "feat(search): add semantic post-filter for constraint enforcement"
```

---

### Task 11: Add Exact-Title Boost

**Files:**
- Modify: `apps/api/src/services/search.ts`
- Add test to: `apps/api/src/services/__tests__/search-ranking.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/search-ranking.test.ts`:

```typescript
describe('exact-title boost', () => {
  it('boosts exact title matches', () => {
    const scores = [
      { id: 'CS-225', score: 0.5, title: 'Data Structures' },
      { id: 'CS-374', score: 0.6, title: 'Introduction to Algorithms' },
    ];

    const boosted = applyTitleBoost(scores, 'data structures');

    // CS-225 should now be ranked higher due to title match
    expect(boosted[0].id).toBe('CS-225');
    expect(boosted[0].score).toBeGreaterThan(0.5);
  });
});
```

**Step 2: Add title boost function**

In `apps/api/src/services/search.ts`:

```typescript
function applyTitleBoost(
  scores: { id: string; score: number; title?: string }[],
  query: string
): { id: string; score: number; title?: string }[] {
  const queryLower = query.toLowerCase().trim();
  if (!queryLower) return scores;

  return scores.map(item => {
    if (!item.title) return item;

    const titleLower = item.title.toLowerCase();
    let boost = 0;

    if (titleLower === queryLower) {
      boost = 0.5;  // Exact match
    } else if (titleLower.includes(queryLower)) {
      boost = 0.2;  // Query contained in title
    } else if (queryLower.includes(titleLower)) {
      boost = 0.15;  // Title contained in query
    }

    return { ...item, score: item.score + boost };
  }).sort((a, b) => b.score - a.score);
}
```

Apply it in `hybridSearch` after RRF scoring:

```typescript
// Apply title boost
const withTitleBoost = applyTitleBoost(
  scores.map(s => ({ ...s, title: courseMap.get(s.id)?.title })),
  plan.keywordQuery || ''
);
```

**Step 3: Commit**

```bash
git add apps/api/src/services/search.ts apps/api/src/services/__tests__/search-ranking.test.ts
git commit -m "feat(search): add exact-title boost for ranking"
```

---

### Task 12: Fix FTS Special Tokens

**Files:**
- Modify: `apps/api/src/services/search.ts`
- Modify: `apps/api/src/services/__tests__/fts-sanitizer.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/fts-sanitizer.test.ts`:

```typescript
describe('special token handling', () => {
  it('preserves C++ as cplusplus', () => {
    expect(sanitizeFtsQuery('C++ programming')).toContain('cplusplus');
  });

  it('preserves C# as csharp', () => {
    expect(sanitizeFtsQuery('C# development')).toContain('csharp');
  });

  it('preserves .NET as dotnet', () => {
    expect(sanitizeFtsQuery('.NET framework')).toContain('dotnet');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run src/services/__tests__/fts-sanitizer.test.ts -t "special token"
```

Expected: FAIL

**Step 3: Add special token handling**

In `apps/api/src/services/search.ts`, modify `sanitizeFtsQuery`:

```typescript
const SPECIAL_TOKENS: Record<string, string> = {
  'c++': 'cplusplus',
  'c#': 'csharp',
  '.net': 'dotnet',
  'f#': 'fsharp',
  'c/c++': 'c cplusplus',
};

export function sanitizeFtsQuery(query: string): string {
  if (!query) return '';

  let sanitized = query;

  // Handle special tokens BEFORE stripping punctuation
  for (const [token, replacement] of Object.entries(SPECIAL_TOKENS)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(escaped, 'gi'), replacement);
  }

  // Replace & with " and "
  sanitized = sanitized.replace(/&/g, ' and ');

  // ... rest of existing sanitization
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run src/services/__tests__/fts-sanitizer.test.ts -t "special token"
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/search.ts apps/api/src/services/__tests__/fts-sanitizer.test.ts
git commit -m "feat(search): handle C++, C#, .NET special tokens in FTS"
```

---

## Phase 5: Transparency

### Task 13: Add Fallback Transparency

**Files:**
- Modify: `apps/api/src/services/search-pipeline.ts`
- Modify: `apps/api/src/services/__tests__/search-pipeline.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/src/services/__tests__/search-pipeline.test.ts`:

```typescript
describe('fallback transparency', () => {
  it('tracks constraints relaxed in Tier 4', async () => {
    // Mock that returns few results to trigger fallback
    // ...

    const result = await pipeline.search('500 level CS easy', 20);

    // Should indicate what was relaxed
    expect(result.meta.fallback).toBeDefined();
    expect(result.meta.fallback.tierReached).toBeGreaterThanOrEqual(4);
    expect(result.meta.fallback.constraintsRelaxed).toContain('level');
  });
});
```

**Step 2: Modify SearchPipelineResult interface**

In `apps/api/src/services/search-pipeline.ts`:

```typescript
export interface SearchPipelineResult {
  results: SearchResult[];
  meta: {
    query: {
      raw: string;
      residual: string;
    };
    extraction: {
      hints: Hint[];
    };
    plan: SearchPlan;
    timing: {
      extraction_ms: number;
      search_ms: number;
      total_ms: number;
    };
    fallback: {
      tierReached: number;
      constraintsRelaxed: string[];
      originalResultCount: number;
    };
  };
}
```

**Step 3: Track constraints in search method**

Modify the `search` method to track relaxed constraints:

```typescript
let tierReached = 1;
const constraintsRelaxed: string[] = [];
let originalResultCount = 0;

// ... in Tier 4 logic:
if (results.length < 3) {
  originalResultCount = results.length;

  if (plan.filters.level) {
    tierReached = 4.1;
    constraintsRelaxed.push('level');
    // ...
  }

  if (results.length < 3 && (plan.filters.subject || plan.filters.gened_code)) {
    tierReached = 4.2;
    if (plan.filters.gened_code) constraintsRelaxed.push('gened_code');
    if (plan.filters.instructor_ids) constraintsRelaxed.push('instructor');
    if (plan.filters.difficulty) constraintsRelaxed.push('difficulty');
    // ...
  }
}

// Include in return
return {
  results,
  meta: {
    // ...existing
    fallback: {
      tierReached,
      constraintsRelaxed,
      originalResultCount
    }
  }
};
```

**Step 4: Commit**

```bash
git add apps/api/src/services/search-pipeline.ts apps/api/src/services/__tests__/search-pipeline.test.ts
git commit -m "feat(pipeline): add fallback transparency (track relaxed constraints)"
```

---

## Phase 6: Validation

### Task 14: Update Golden Tests

**Files:**
- Modify: `apps/api/src/services/__tests__/golden-queries.json`

**Step 1: Update golden queries to expect clean residuals**

Update the existing golden-queries.json to expect empty residuals where stop-phrases were removed:

```json
{
  "input": "easy humanities gen ed",
  "expected": {
    "hints": [
      { "type": "difficulty", "value": "easy" },
      { "type": "gened", "value": "HUM" }
    ],
    "filters": { "difficulty": "easy", "gened_code": "HUM" },
    "residual": ""
  }
}
```

**Step 2: Run all tests**

```bash
cd apps/api && npm test
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/api/src/services/__tests__/golden-queries.json
git commit -m "test: update golden queries to expect clean residuals"
```

---

### Task 15: Run Evaluation and Document Results

**Step 1: Start dev server**

```bash
cd apps/api && npm run dev
```

**Step 2: Run evaluation**

```bash
cd apps/api && npm run eval http://localhost:8787
```

**Step 3: Document results**

Save output to `docs/analysis/2026-01-22-eval-results.md`

**Step 4: Commit**

```bash
git add docs/analysis/
git commit -m "docs: add evaluation results showing improvement"
```

---

## Summary

**Total Tasks:** 15
**Estimated Time:** 4-6 hours

**Files Created:**
- `apps/api/src/eval/` (types, metrics, report, runner, golden-queries)
- `apps/api/src/services/taxonomy-cache.ts`
- `apps/api/src/services/query-logger.ts`
- `migrations/003-gened-aliases.sql`
- `migrations/004-topic-aliases.sql`
- `migrations/005-search-logs.sql`

**Files Modified:**
- `apps/api/src/services/extractor.ts`
- `apps/api/src/services/search.ts`
- `apps/api/src/services/search-pipeline.ts`
- `apps/api/package.json`
- Various test files
