# Unified Query System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a server-only, layman-first query processing system that extracts structure from natural language, applies filters intelligently, and returns rich metadata.

**Architecture:** Server-only extraction with three phases (regex → alias → NLP). Query parser handles power-user syntax. Disambiguator generates suggestions for ambiguous terms. All processing happens on the Cloudflare Worker; the client is just a search box.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1, Vitest, Compromise NLP

**Design Spec:** See `docs/plans/2026-01-22-unified-query-system-design.md` for full rationale.

---

## Task 1: Update Query Types

**Files:**
- Modify: `packages/query-types/index.ts`

**Step 1: Write the new type definitions**

Add the following types to `packages/query-types/index.ts`:

```typescript
// === NEW TYPES FOR UNIFIED QUERY SYSTEM ===

// Hint metadata with source tracking
export interface HintMetadata {
  source: 'regex' | 'alias' | 'nlp';
  span?: [number, number];
  confidence: number;
  raw: string;
}

// Rich hint structure
export interface Hint {
  type: HintType;
  value: string | number | boolean | NegationValue;
  metadata: HintMetadata;
}

export type HintType =
  | 'courseCode'
  | 'crn'
  | 'subject'
  | 'instructor'
  | 'days'
  | 'time'
  | 'level'
  | 'credits'
  | 'online'
  | 'status'
  | 'difficulty'
  | 'gened'
  | 'semester'
  | 'negation';

export interface NegationValue {
  target: HintType;
  value: string;
}

// Suggestion for ambiguous terms
export interface Suggestion {
  text: string;
  action: 'add_filter' | 'remove_filter' | 'change_filter';
  filter?: Partial<SearchFilters>;
}

// Parsed query from power-user syntax
export interface ParsedQuery {
  raw: string;
  clauses: ParsedClause[];
}

export interface ParsedClause {
  filters: FieldFilter[];
  negations: string[];
  phrases: string[];
  genedMode?: {
    any?: string[];
    all?: string[];
  };
  residual: string;
}

export interface FieldFilter {
  field: string;
  value: string;
  negated?: boolean;
}
```

**Step 2: Update SearchFilters with new fields**

Update the existing `SearchFilters` interface:

```typescript
export interface SearchFilters {
  // Entity filters
  instructor_ids?: number[];
  subject?: string;
  number?: string;
  crn?: string;
  gened_code?: string;
  gened_any?: string[];       // NEW: Course has ANY of these geneds
  gened_all?: string[];       // NEW: Course has ALL of these geneds

  // Schedule filters
  days?: string;
  time?: string;              // CHANGED: now just string, not time_start/time_end

  // Attribute filters
  level?: number;
  credits?: number;
  online?: boolean;
  status?: string;
  difficulty?: 'easy' | 'hard';

  // Negations
  not?: {                     // NEW: Negation support
    time?: string[];
    days?: string[];
    instructor_ids?: number[];
  };

  // Legacy (keep for compatibility)
  term?: string;
  year?: number;
}
```

**Step 3: Run typecheck to verify**

Run: `cd packages/query-types && npx tsc --noEmit`
Expected: PASS (no errors)

**Step 4: Commit**

```bash
git add packages/query-types/index.ts
git commit -m "$(cat <<'EOF'
feat(query-types): add types for unified query system

- Add Hint, HintMetadata, HintType for rich extraction output
- Add Suggestion for disambiguation UI
- Add ParsedQuery, ParsedClause, FieldFilter for power-user syntax
- Add gened_any, gened_all, not to SearchFilters
- Add NegationValue for structured negations

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create Query Parser

Parse power-user syntax: `field:value`, `gened:any(...)`, `gened:all(...)`, `-negation`, `"phrases"`.

**Files:**
- Create: `apps/api/src/services/query-parser.ts`
- Create: `apps/api/src/services/__tests__/query-parser.test.ts`

### Step 1: Write failing test for basic parsing

Create `apps/api/src/services/__tests__/query-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../query-parser.js';

describe('parseQuery', () => {
  describe('basic queries', () => {
    it('returns residual for plain text', () => {
      const result = parseQuery('data structures');
      expect(result.clauses).toHaveLength(1);
      expect(result.clauses[0].residual).toBe('data structures');
      expect(result.clauses[0].filters).toEqual([]);
      expect(result.clauses[0].negations).toEqual([]);
      expect(result.clauses[0].phrases).toEqual([]);
    });
  });

  describe('field:value syntax', () => {
    it('extracts gened:HUM', () => {
      const result = parseQuery('easy gened:HUM');
      expect(result.clauses[0].filters).toContainEqual({
        field: 'gened',
        value: 'HUM',
      });
      expect(result.clauses[0].residual).toBe('easy');
    });

    it('extracts subject:CS', () => {
      const result = parseQuery('subject:CS algorithms');
      expect(result.clauses[0].filters).toContainEqual({
        field: 'subject',
        value: 'CS',
      });
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('extracts multiple field:value pairs', () => {
      const result = parseQuery('gened:HUM difficulty:easy');
      expect(result.clauses[0].filters).toHaveLength(2);
    });
  });

  describe('gened:any/all syntax', () => {
    it('extracts gened:any(HUM,US)', () => {
      const result = parseQuery('gened:any(HUM,US) easy');
      expect(result.clauses[0].genedMode?.any).toEqual(['HUM', 'US']);
      expect(result.clauses[0].residual).toBe('easy');
    });

    it('extracts gened:all(NW,US)', () => {
      const result = parseQuery('gened:all(NW,US)');
      expect(result.clauses[0].genedMode?.all).toEqual(['NW', 'US']);
    });
  });

  describe('negation syntax', () => {
    it('extracts -term as negation', () => {
      const result = parseQuery('algorithms -calculus');
      expect(result.clauses[0].negations).toContain('calculus');
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('extracts multiple negations', () => {
      const result = parseQuery('-morning -evening');
      expect(result.clauses[0].negations).toContain('morning');
      expect(result.clauses[0].negations).toContain('evening');
    });
  });

  describe('phrase syntax', () => {
    it('extracts "quoted phrase"', () => {
      const result = parseQuery('"data structures" algorithms');
      expect(result.clauses[0].phrases).toContain('data structures');
      expect(result.clauses[0].residual).toBe('algorithms');
    });

    it('extracts multiple phrases', () => {
      const result = parseQuery('"intro to" "computer science"');
      expect(result.clauses[0].phrases).toContain('intro to');
      expect(result.clauses[0].phrases).toContain('computer science');
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/api && npx vitest run src/services/__tests__/query-parser.test.ts`
Expected: FAIL with "Cannot find module '../query-parser.js'"

### Step 3: Write minimal implementation

Create `apps/api/src/services/query-parser.ts`:

```typescript
import type { ParsedQuery, ParsedClause, FieldFilter } from '@uiuc-course-search/query-types';

/**
 * Parse power-user syntax from a query string.
 * Extracts: field:value, gened:any(...), gened:all(...), -negations, "phrases"
 */
export function parseQuery(query: string): ParsedQuery {
  // For now, we don't support top-level OR, so single clause
  const clause = parseClause(query);

  return {
    raw: query,
    clauses: [clause],
  };
}

function parseClause(text: string): ParsedClause {
  const filters: FieldFilter[] = [];
  const negations: string[] = [];
  const phrases: string[] = [];
  let genedMode: ParsedClause['genedMode'] = undefined;
  let residual = text;

  // 1. Extract gened:any(...) and gened:all(...)
  const genedAnyRegex = /gened:any\(([^)]+)\)/gi;
  const genedAllRegex = /gened:all\(([^)]+)\)/gi;

  let anyMatch = genedAnyRegex.exec(residual);
  if (anyMatch) {
    genedMode = genedMode || {};
    genedMode.any = anyMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(anyMatch[0], ' ');
  }

  let allMatch = genedAllRegex.exec(residual);
  if (allMatch) {
    genedMode = genedMode || {};
    genedMode.all = allMatch[1].split(',').map(s => s.trim().toUpperCase());
    residual = residual.replace(allMatch[0], ' ');
  }

  // 2. Extract "quoted phrases"
  const phraseRegex = /"([^"]+)"/g;
  let phraseMatch;
  while ((phraseMatch = phraseRegex.exec(residual)) !== null) {
    phrases.push(phraseMatch[1]);
  }
  residual = residual.replace(phraseRegex, ' ');

  // 3. Extract -negations (must be preceded by space or start of string)
  const negationRegex = /(?:^|\s)-(\w+)/g;
  let negMatch;
  while ((negMatch = negationRegex.exec(residual)) !== null) {
    negations.push(negMatch[1]);
  }
  residual = residual.replace(negationRegex, ' ');

  // 4. Extract field:value pairs
  const fieldValueRegex = /(\w+):(\w+)/g;
  let fieldMatch;
  while ((fieldMatch = fieldValueRegex.exec(residual)) !== null) {
    filters.push({
      field: fieldMatch[1].toLowerCase(),
      value: fieldMatch[2],
    });
  }
  residual = residual.replace(fieldValueRegex, ' ');

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  return {
    filters,
    negations,
    phrases,
    genedMode,
    residual,
  };
}
```

### Step 4: Run test to verify it passes

Run: `cd apps/api && npx vitest run src/services/__tests__/query-parser.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/services/query-parser.ts apps/api/src/services/__tests__/query-parser.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add query parser for power-user syntax

Parses:
- field:value (e.g., gened:HUM, subject:CS)
- gened:any(HUM,US) and gened:all(NW,US)
- -negations (e.g., -calculus, -morning)
- "quoted phrases"

Returns residual text for natural language extraction.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create Alias Registry

Deterministic phrase-to-entity matching with cue rules.

**Files:**
- Create: `apps/api/src/services/alias-registry.ts`
- Create: `apps/api/src/services/__tests__/alias-registry.test.ts`

### Step 1: Write failing tests

Create `apps/api/src/services/__tests__/alias-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AliasRegistry, createDefaultRegistry } from '../alias-registry.js';

describe('AliasRegistry', () => {
  let registry: AliasRegistry;

  beforeEach(() => {
    registry = createDefaultRegistry();
  });

  describe('time aliases', () => {
    it('matches "morning"', () => {
      const matches = registry.match('morning classes');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'time', canonical: 'morning' })
      );
    });

    it('matches "early morning" as early', () => {
      const matches = registry.match('early morning');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'time', canonical: 'early' })
      );
    });
  });

  describe('difficulty aliases', () => {
    it('matches "easy"', () => {
      const matches = registry.match('easy class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'easy' })
      );
    });

    it('matches "gpa booster" as easy', () => {
      const matches = registry.match('gpa booster');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'easy' })
      );
    });

    it('matches "hard"', () => {
      const matches = registry.match('hard class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'hard' })
      );
    });
  });

  describe('status aliases', () => {
    it('matches "open"', () => {
      const matches = registry.match('open sections');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'status', canonical: 'open' })
      );
    });

    it('matches "has seats" as open', () => {
      const matches = registry.match('has seats');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'status', canonical: 'open' })
      );
    });
  });

  describe('delivery aliases', () => {
    it('matches "online"', () => {
      const matches = registry.match('online class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'delivery', canonical: 'true' })
      );
    });

    it('matches "in person" as not online', () => {
      const matches = registry.match('in person');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'delivery', canonical: 'false' })
      );
    });
  });

  describe('days aliases', () => {
    it('matches "tuesday thursday" as TR', () => {
      const matches = registry.match('tuesday thursday');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'days', canonical: 'TR' })
      );
    });

    it('matches "monday wednesday friday" as MWF', () => {
      const matches = registry.match('monday wednesday friday');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'days', canonical: 'MWF' })
      );
    });
  });

  describe('gened aliases with cue rule', () => {
    it('does NOT match "humanities" without cue', () => {
      const matches = registry.match('humanities');
      const genedMatches = matches.filter(m => m.kind === 'gened');
      expect(genedMatches).toHaveLength(0);
    });

    it('matches "humanities gen ed" with cue', () => {
      const matches = registry.match('humanities gen ed');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });

    it('matches "humanities requirement" with cue', () => {
      const matches = registry.match('humanities requirement');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });

    it('matches gened code directly without cue', () => {
      const matches = registry.match('HUM');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'gened', canonical: 'HUM' })
      );
    });
  });

  describe('longest match first', () => {
    it('matches "early morning" before "morning"', () => {
      const matches = registry.match('early morning');
      const timeMatches = matches.filter(m => m.kind === 'time');
      expect(timeMatches).toHaveLength(1);
      expect(timeMatches[0].canonical).toBe('early');
    });

    it('matches "gpa booster" before "gpa"', () => {
      const matches = registry.match('gpa booster class');
      expect(matches).toContainEqual(
        expect.objectContaining({ kind: 'difficulty', canonical: 'easy' })
      );
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/api && npx vitest run src/services/__tests__/alias-registry.test.ts`
Expected: FAIL with "Cannot find module '../alias-registry.js'"

### Step 3: Write implementation

Create `apps/api/src/services/alias-registry.ts`:

```typescript
export type AliasKind = 'subject' | 'gened' | 'delivery' | 'status' | 'difficulty' | 'days' | 'time';

export interface AliasEntry {
  kind: AliasKind;
  canonical: string;
  aliases: string[];
  requiresCue?: boolean;
}

export interface AliasMatch {
  kind: AliasKind;
  canonical: string;
  span: [number, number];
  confidence: number;
  raw: string;
}

// Cue words that indicate gened filter intent
const GENED_CUES = ['gen ed', 'gened', 'gen-ed', 'requirement', 'category'];

export class AliasRegistry {
  private entries: AliasEntry[] = [];

  add(entry: AliasEntry): void {
    this.entries.push(entry);
  }

  addAll(entries: AliasEntry[]): void {
    this.entries.push(...entries);
  }

  match(text: string): AliasMatch[] {
    const normalized = text.toLowerCase();
    const matches: AliasMatch[] = [];
    const consumed = new Set<number>(); // Track consumed character positions

    // Check for cues in the text
    const hasCue = GENED_CUES.some(cue => normalized.includes(cue));

    // Sort entries by longest alias first
    const sortedEntries = [...this.entries].sort((a, b) => {
      const aMax = Math.max(...a.aliases.map(al => al.length));
      const bMax = Math.max(...b.aliases.map(al => al.length));
      return bMax - aMax;
    });

    for (const entry of sortedEntries) {
      // Skip gened entries that require cue if no cue present
      if (entry.requiresCue && !hasCue) {
        continue;
      }

      for (const alias of entry.aliases.sort((a, b) => b.length - a.length)) {
        const aliasLower = alias.toLowerCase();
        let searchStart = 0;

        while (true) {
          const index = normalized.indexOf(aliasLower, searchStart);
          if (index === -1) break;

          // Check if this span is already consumed
          let isConsumed = false;
          for (let i = index; i < index + aliasLower.length; i++) {
            if (consumed.has(i)) {
              isConsumed = true;
              break;
            }
          }

          if (!isConsumed) {
            // Check word boundaries
            const before = index === 0 || /\s/.test(normalized[index - 1]);
            const after = index + aliasLower.length === normalized.length ||
              /\s/.test(normalized[index + aliasLower.length]);

            if (before && after) {
              matches.push({
                kind: entry.kind,
                canonical: entry.canonical,
                span: [index, index + aliasLower.length],
                confidence: 0.9,
                raw: text.slice(index, index + aliasLower.length),
              });

              // Mark this span as consumed
              for (let i = index; i < index + aliasLower.length; i++) {
                consumed.add(i);
              }
            }
          }

          searchStart = index + 1;
        }
      }
    }

    return matches;
  }
}

export function createDefaultRegistry(): AliasRegistry {
  const registry = new AliasRegistry();

  // Time aliases
  registry.addAll([
    { kind: 'time', canonical: 'early', aliases: ['early morning', 'early'] },
    { kind: 'time', canonical: 'morning', aliases: ['morning', 'before noon'] },
    { kind: 'time', canonical: 'midday', aliases: ['midday', 'mid day', 'around noon'] },
    { kind: 'time', canonical: 'afternoon', aliases: ['afternoon', 'after noon'] },
    { kind: 'time', canonical: 'evening', aliases: ['evening', 'night', 'after 5'] },
  ]);

  // Difficulty aliases
  registry.addAll([
    { kind: 'difficulty', canonical: 'easy', aliases: ['easy', 'simple', 'gpa booster', 'easy a', 'not hard'] },
    { kind: 'difficulty', canonical: 'hard', aliases: ['hard', 'difficult', 'challenging', 'tough'] },
  ]);

  // Status aliases
  registry.addAll([
    { kind: 'status', canonical: 'open', aliases: ['open', 'available', 'has seats', 'not full', 'no waitlist'] },
    { kind: 'status', canonical: 'closed', aliases: ['closed', 'full', 'waitlist'] },
  ]);

  // Delivery aliases
  registry.addAll([
    { kind: 'delivery', canonical: 'true', aliases: ['online', 'remote', 'virtual', 'asynchronous', 'async'] },
    { kind: 'delivery', canonical: 'false', aliases: ['in person', 'in-person', 'on campus', 'face to face'] },
  ]);

  // Days aliases
  registry.addAll([
    { kind: 'days', canonical: 'MWF', aliases: ['mwf', 'monday wednesday friday', 'mon wed fri', 'm w f'] },
    { kind: 'days', canonical: 'TR', aliases: ['tr', 'tuesday thursday', 'tue thu', 'tue thur', 't r', 'tuth'] },
    { kind: 'days', canonical: 'MW', aliases: ['mw', 'monday wednesday', 'mon wed'] },
    { kind: 'days', canonical: 'WF', aliases: ['wf', 'wednesday friday', 'wed fri'] },
  ]);

  // GenEd aliases (require cue)
  registry.addAll([
    { kind: 'gened', canonical: 'HUM', aliases: ['humanities', 'humanities and the arts', 'arts'], requiresCue: true },
    { kind: 'gened', canonical: 'NAT', aliases: ['natural sciences', 'nat sci', 'science'], requiresCue: true },
    { kind: 'gened', canonical: 'SBS', aliases: ['social sciences', 'behavioral sciences', 'social and behavioral'], requiresCue: true },
    { kind: 'gened', canonical: 'CS', aliases: ['cultural studies'], requiresCue: true },
    { kind: 'gened', canonical: 'QR', aliases: ['quantitative reasoning', 'quantitative', 'quant'], requiresCue: true },
    { kind: 'gened', canonical: 'NW', aliases: ['non western', 'non-western', 'nonwestern'], requiresCue: true },
    { kind: 'gened', canonical: 'US', aliases: ['us minority', 'minority cultures'], requiresCue: true },
    { kind: 'gened', canonical: 'WCC', aliases: ['western comparative', 'western'], requiresCue: true },
    { kind: 'gened', canonical: 'ACP', aliases: ['advanced composition', 'adv comp', 'writing intensive'], requiresCue: true },
  ]);

  // GenEd codes (no cue required - explicit codes always work)
  registry.addAll([
    { kind: 'gened', canonical: 'HUM', aliases: ['hum'] },
    { kind: 'gened', canonical: 'NAT', aliases: ['nat'] },
    { kind: 'gened', canonical: 'SBS', aliases: ['sbs'] },
    { kind: 'gened', canonical: 'CS', aliases: ['cs gened', 'cs gen ed'] }, // Disambiguate from CS subject
    { kind: 'gened', canonical: 'QR', aliases: ['qr'] },
    { kind: 'gened', canonical: 'QR1', aliases: ['qr1', 'qr 1'] },
    { kind: 'gened', canonical: 'QR2', aliases: ['qr2', 'qr 2'] },
    { kind: 'gened', canonical: 'NW', aliases: ['nw'] },
    { kind: 'gened', canonical: 'US', aliases: ['us minority'] },
    { kind: 'gened', canonical: 'WCC', aliases: ['wcc'] },
    { kind: 'gened', canonical: 'ACP', aliases: ['acp'] },
  ]);

  return registry;
}
```

### Step 4: Run test to verify it passes

Run: `cd apps/api && npx vitest run src/services/__tests__/alias-registry.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/services/alias-registry.ts apps/api/src/services/__tests__/alias-registry.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add deterministic alias registry

- AliasRegistry class with phrase-to-entity matching
- Longest-match-first algorithm
- Cue rule for GenEd names (requires "gen ed", "requirement", etc.)
- Default registry with time, difficulty, status, delivery, days, gened aliases
- Word boundary checking to avoid partial matches

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create Server Extractor

Three-phase extraction: regex → alias → NLP.

**Files:**
- Create: `apps/api/src/services/extractor.ts`
- Create: `apps/api/src/services/__tests__/extractor.test.ts`

### Step 1: Write failing tests for regex phase

Create `apps/api/src/services/__tests__/extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';

describe('extract', () => {
  describe('phase 1: regex patterns', () => {
    it('extracts course code "CS 225"', () => {
      const result = extract('CS 225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: { subject: 'CS', number: '225' },
          metadata: expect.objectContaining({ source: 'regex' }),
        })
      );
    });

    it('extracts course code without space "cs225"', () => {
      const result = extract('cs225');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'courseCode',
          value: expect.objectContaining({ subject: 'CS', number: '225' }),
        })
      );
    });

    it('extracts CRN "12345"', () => {
      const result = extract('12345');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '12345',
          metadata: expect.objectContaining({ source: 'regex' }),
        })
      );
    });

    it('extracts CRN with prefix "CRN 67890"', () => {
      const result = extract('CRN 67890');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'crn',
          value: '67890',
        })
      );
    });

    it('extracts credits "3 credits"', () => {
      const result = extract('3 credits');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'credits',
          value: 3,
        })
      );
    });

    it('extracts credits "4 credit hours"', () => {
      const result = extract('4 credit hours');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'credits',
          value: 4,
        })
      );
    });

    it('extracts level "400 level"', () => {
      const result = extract('400 level');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 400,
        })
      );
    });

    it('extracts level "intro" as 100', () => {
      const result = extract('intro class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 100,
        })
      );
    });

    it('extracts level "advanced" as 400', () => {
      const result = extract('advanced course');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 400,
        })
      );
    });

    it('extracts level "graduate" as 500', () => {
      const result = extract('graduate seminar');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'level',
          value: 500,
        })
      );
    });

    it('extracts days "MWF"', () => {
      const result = extract('MWF morning');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'days',
          value: 'MWF',
        })
      );
    });

    it('extracts days "TR"', () => {
      const result = extract('TR afternoon');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'days',
          value: 'TR',
        })
      );
    });
  });

  describe('phase 2: alias matching', () => {
    it('extracts difficulty "easy"', () => {
      const result = extract('easy class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'difficulty',
          value: 'easy',
          metadata: expect.objectContaining({ source: 'alias' }),
        })
      );
    });

    it('extracts difficulty "gpa booster" as easy', () => {
      const result = extract('gpa booster');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'difficulty',
          value: 'easy',
        })
      );
    });

    it('extracts status "open"', () => {
      const result = extract('open sections');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'status',
          value: 'open',
        })
      );
    });

    it('extracts online "true" for "online"', () => {
      const result = extract('online class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'online',
          value: true,
        })
      );
    });

    it('extracts online "false" for "in person"', () => {
      const result = extract('in person class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'online',
          value: false,
        })
      );
    });

    it('extracts time "morning"', () => {
      const result = extract('morning class');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'time',
          value: 'morning',
        })
      );
    });

    it('extracts gened with cue "humanities gen ed"', () => {
      const result = extract('humanities gen ed');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'gened',
          value: 'HUM',
        })
      );
    });

    it('does NOT extract gened without cue "humanities"', () => {
      const result = extract('humanities');
      const genedHints = result.hints.filter(h => h.type === 'gened');
      expect(genedHints).toHaveLength(0);
      expect(result.residual).toContain('humanities');
    });
  });

  describe('phase 3: NLP (instructor)', () => {
    it('extracts instructor with "with Fagen"', () => {
      const result = extract('CS 225 with Fagen');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Fagen',
          metadata: expect.objectContaining({ source: 'nlp' }),
        })
      );
    });

    it('extracts instructor with "by Fleck"', () => {
      const result = extract('data structures by Fleck');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Fleck',
        })
      );
    });

    it('extracts instructor with "professor Smith"', () => {
      const result = extract('professor Smith');
      expect(result.hints).toContainEqual(
        expect.objectContaining({
          type: 'instructor',
          value: 'Smith',
        })
      );
    });
  });

  describe('residual handling', () => {
    it('removes extracted hints from residual', () => {
      const result = extract('CS 225 with Fagen morning');
      expect(result.residual).not.toContain('CS 225');
      expect(result.residual).not.toContain('Fagen');
      expect(result.residual).not.toContain('morning');
    });

    it('keeps unmatched text in residual', () => {
      const result = extract('data structures algorithms');
      expect(result.residual).toContain('data');
      expect(result.residual).toContain('structures');
      expect(result.residual).toContain('algorithms');
    });
  });

  describe('combined extraction', () => {
    it('extracts multiple hints from complex query', () => {
      const result = extract('easy CS 225 MWF morning with Fagen');
      expect(result.hints.length).toBeGreaterThanOrEqual(4);
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'difficulty' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'courseCode' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'days' }));
      expect(result.hints).toContainEqual(expect.objectContaining({ type: 'instructor' }));
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts`
Expected: FAIL with "Cannot find module '../extractor.js'"

### Step 3: Write implementation

Create `apps/api/src/services/extractor.ts`:

```typescript
import type { Hint, HintType, HintMetadata } from '@uiuc-course-search/query-types';
import { createDefaultRegistry } from './alias-registry.js';

export interface ExtractionResult {
  hints: Hint[];
  residual: string;
}

const LEVEL_KEYWORDS: Record<string, number> = {
  'intro': 100,
  'introductory': 100,
  'beginner': 100,
  'advanced': 400,
  'upper': 400,
  'upper level': 400,
  'graduate': 500,
  'grad': 500,
};

/**
 * Extract structured hints from natural language text.
 * Three-phase extraction: regex → alias → NLP
 */
export function extract(text: string): ExtractionResult {
  const hints: Hint[] = [];
  let residual = text;

  // Phase 1: Regex patterns (structured data)
  residual = extractRegexPatterns(residual, hints);

  // Phase 2: Alias matching (known entities)
  residual = extractAliases(residual, hints);

  // Phase 3: NLP patterns (linguistic)
  residual = extractNlpPatterns(residual, hints);

  // Clean up residual
  residual = residual.replace(/\s+/g, ' ').trim();

  return { hints, residual };
}

function extractRegexPatterns(text: string, hints: Hint[]): string {
  let residual = text;

  // Course codes: CS 225, cs225, MATH241
  const courseCodeRegex = /\b([A-Za-z]{2,4})\s*(\d{3})\b/g;
  let match;
  while ((match = courseCodeRegex.exec(text)) !== null) {
    hints.push({
      type: 'courseCode',
      value: { subject: match[1].toUpperCase(), number: match[2] },
      metadata: createMetadata('regex', match[0], 0.95),
    });
  }
  residual = residual.replace(courseCodeRegex, ' ');

  // CRN with prefix
  const crnPrefixRegex = /\bCRN\s*(\d{5})\b/gi;
  while ((match = crnPrefixRegex.exec(text)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.95),
    });
  }
  residual = residual.replace(crnPrefixRegex, ' ');

  // Standalone 5-digit CRN
  const crnRegex = /\b(\d{5})\b/g;
  while ((match = crnRegex.exec(residual)) !== null) {
    hints.push({
      type: 'crn',
      value: match[1],
      metadata: createMetadata('regex', match[0], 0.7),
    });
  }
  residual = residual.replace(crnRegex, ' ');

  // Credits: 3 credits, 4 credit hours, 3-credit
  const creditsRegex = /\b(\d)\s*-?\s*(?:credit|credits|cr|hour|hours)s?\b/gi;
  while ((match = creditsRegex.exec(text)) !== null) {
    hints.push({
      type: 'credits',
      value: parseInt(match[1]),
      metadata: createMetadata('regex', match[0], 0.9),
    });
  }
  residual = residual.replace(creditsRegex, ' ');

  // Level: 400 level, 400-level
  const levelNumRegex = /\b([1-5])00\s*-?\s*level\b/gi;
  while ((match = levelNumRegex.exec(text)) !== null) {
    hints.push({
      type: 'level',
      value: parseInt(match[1]) * 100,
      metadata: createMetadata('regex', match[0], 0.9),
    });
  }
  residual = residual.replace(levelNumRegex, ' ');

  // Level keywords: intro, advanced, graduate
  for (const [keyword, level] of Object.entries(LEVEL_KEYWORDS)) {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');
    if (keywordRegex.test(text)) {
      hints.push({
        type: 'level',
        value: level,
        metadata: createMetadata('regex', keyword, 0.7),
      });
      residual = residual.replace(keywordRegex, ' ');
    }
  }

  // Days: MWF, TR, MW
  const daysPatterns = [
    { pattern: /\bMWF\b/gi, value: 'MWF' },
    { pattern: /\bTR\b/gi, value: 'TR' },
    { pattern: /\bMW\b/gi, value: 'MW' },
    { pattern: /\bWF\b/gi, value: 'WF' },
  ];
  for (const { pattern, value } of daysPatterns) {
    if (pattern.test(text)) {
      hints.push({
        type: 'days',
        value,
        metadata: createMetadata('regex', value, 0.9),
      });
      residual = residual.replace(pattern, ' ');
    }
  }

  return residual;
}

function extractAliases(text: string, hints: Hint[]): string {
  const registry = createDefaultRegistry();
  const matches = registry.match(text);
  let residual = text;

  for (const match of matches) {
    let hintType: HintType;
    let value: string | number | boolean;

    switch (match.kind) {
      case 'time':
        hintType = 'time';
        value = match.canonical;
        break;
      case 'difficulty':
        hintType = 'difficulty';
        value = match.canonical;
        break;
      case 'status':
        hintType = 'status';
        value = match.canonical;
        break;
      case 'delivery':
        hintType = 'online';
        value = match.canonical === 'true';
        break;
      case 'days':
        hintType = 'days';
        value = match.canonical;
        break;
      case 'gened':
        hintType = 'gened';
        value = match.canonical;
        break;
      default:
        continue;
    }

    hints.push({
      type: hintType,
      value,
      metadata: {
        source: 'alias',
        span: match.span,
        confidence: match.confidence,
        raw: match.raw,
      },
    });

    // Remove matched text from residual
    residual = residual.slice(0, match.span[0]) + ' '.repeat(match.span[1] - match.span[0]) + residual.slice(match.span[1]);
  }

  return residual;
}

function extractNlpPatterns(text: string, hints: Hint[]): string {
  let residual = text;

  // Instructor patterns: with X, by X, professor X, prof X, dr X
  const instructorPatterns = [
    /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    /\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    /\bprofessor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
    /\bprof\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
    /\bdr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi,
  ];

  for (const pattern of instructorPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      hints.push({
        type: 'instructor',
        value: match[1],
        metadata: createMetadata('nlp', match[0], 0.8),
      });
      residual = residual.replace(match[0], ' ');
    }
  }

  // Negation patterns: no mornings, not early, avoid X
  // (Simplified - full NLP would use Compromise)
  const negationPatterns = [
    /\bno\s+(\w+)\b/gi,
    /\bnot\s+(\w+)\b/gi,
    /\bavoid\s+(\w+)\b/gi,
  ];

  for (const pattern of negationPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const target = match[1].toLowerCase();
      // Map to negation hint type
      hints.push({
        type: 'negation',
        value: { target: guessNegationType(target), value: target },
        metadata: createMetadata('nlp', match[0], 0.75),
      });
      residual = residual.replace(match[0], ' ');
    }
  }

  return residual;
}

function guessNegationType(word: string): HintType {
  const timeWords = ['morning', 'afternoon', 'evening', 'early', 'night'];
  const daysWords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'mwf', 'tr'];

  if (timeWords.includes(word)) return 'time';
  if (daysWords.includes(word)) return 'days';
  return 'time'; // Default
}

function createMetadata(source: 'regex' | 'alias' | 'nlp', raw: string, confidence: number): HintMetadata {
  return { source, confidence, raw };
}
```

### Step 4: Run test to verify it passes

Run: `cd apps/api && npx vitest run src/services/__tests__/extractor.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/services/extractor.ts apps/api/src/services/__tests__/extractor.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add three-phase server extractor

Phase 1 (regex):
- Course codes (CS 225, cs225)
- CRNs (12345, CRN 67890)
- Credits (3 credits, 4 hours)
- Level (400 level, intro, advanced, graduate)
- Days (MWF, TR)

Phase 2 (alias):
- Time (morning, afternoon, early)
- Difficulty (easy, gpa booster, hard)
- Status (open, has seats, closed)
- Online/in-person
- GenEd with cue rule

Phase 3 (NLP):
- Instructor (with X, by X, professor X)
- Negation (no mornings, avoid early)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update Query Resolver

Integrate new extraction pipeline and handle all hint types.

**Files:**
- Modify: `apps/api/src/services/query-resolver.ts`
- Modify: `apps/api/src/services/__tests__/query-resolver.test.ts`

### Step 1: Add tests for new hint types

Update `apps/api/src/services/__tests__/query-resolver.test.ts` to add new tests:

```typescript
// Add to existing test file after existing tests:

describe('new hint types', () => {
  describe('days hints', () => {
    it('passes days filter through unchanged', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'MWF classes',
        hints: [{ type: 'days', value: 'MWF', confidence: 0.8 }],
        residual: 'classes'
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.days).toBe('MWF');
    });
  });

  describe('time hints', () => {
    it('passes time filter through unchanged', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'morning classes',
        hints: [{ type: 'time', value: 'morning', confidence: 0.7 }],
        residual: 'classes'
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.time).toBe('morning');
    });
  });

  describe('level hints', () => {
    it('passes numeric level filter', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: '400 level',
        hints: [{ type: 'level', value: '400', confidence: 0.9 }],
        residual: ''
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.level).toBe(400);
    });
  });

  describe('credits hints', () => {
    it('passes credits filter as number', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: '3 credits',
        hints: [{ type: 'credits', value: '3', confidence: 0.8 }],
        residual: ''
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.credits).toBe(3);
    });
  });

  describe('online hints', () => {
    it('converts online hint to boolean true', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'online class',
        hints: [{ type: 'online', value: 'true', confidence: 0.8 }],
        residual: 'class'
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.online).toBe(true);
    });

    it('converts in-person hint to boolean false', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'in person class',
        hints: [{ type: 'online', value: 'false', confidence: 0.8 }],
        residual: 'class'
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.online).toBe(false);
    });
  });

  describe('status hints', () => {
    it('passes status filter unchanged', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'open sections',
        hints: [{ type: 'status', value: 'open', confidence: 0.7 }],
        residual: 'sections'
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.status).toBe('open');
    });
  });

  describe('difficulty hints', () => {
    it('passes difficulty filter unchanged', async () => {
      const mockStmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] })
      };
      (mockDb.prepare as any).mockReturnValue(mockStmt);

      const extracted: ExtractedQuery = {
        rawQuery: 'easy class',
        hints: [{ type: 'difficulty', value: 'easy', confidence: 0.7 }],
        residual: 'class'
      };

      const plan = await resolveQuery(mockDb as any, extracted);
      expect(plan.filters.difficulty).toBe('easy');
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/api && npx vitest run src/services/__tests__/query-resolver.test.ts`
Expected: FAIL (new hint types not handled)

### Step 3: Update resolver implementation

Update `apps/api/src/services/query-resolver.ts` to add new cases in the switch statement:

```typescript
// Add these cases inside the for loop after existing cases:

case 'days':
  plan.filters.days = hint.value as string;
  break;

case 'time':
  plan.filters.time = hint.value as string;
  break;

case 'level':
  const levelValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
  plan.filters.level = levelValue;
  break;

case 'credits':
  const creditsValue = typeof hint.value === 'number' ? hint.value : parseInt(hint.value as string);
  plan.filters.credits = creditsValue;
  break;

case 'online':
  if (typeof hint.value === 'boolean') {
    plan.filters.online = hint.value;
  } else {
    plan.filters.online = hint.value === 'true';
  }
  break;

case 'status':
  plan.filters.status = hint.value as string;
  break;

case 'difficulty':
  plan.filters.difficulty = hint.value as 'easy' | 'hard';
  break;
```

### Step 4: Run test to verify it passes

Run: `cd apps/api && npx vitest run src/services/__tests__/query-resolver.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add apps/api/src/services/query-resolver.ts apps/api/src/services/__tests__/query-resolver.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add new hint types to resolver

Handle new P1 filter hints:
- days (MWF, TR, etc.)
- time (morning, afternoon, evening)
- level (100, 400, 500)
- credits (3, 4)
- online (boolean)
- status (open, closed)
- difficulty (easy, hard)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Search with P1 Filters

Add SQL filter generation for days, time, level, credits, online, status, difficulty.

**Files:**
- Modify: `apps/api/src/services/search.ts`
- Create: `apps/api/src/services/__tests__/search-filters.test.ts`

### Step 1: Write failing tests for filter SQL generation

Create `apps/api/src/services/__tests__/search-filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildFilterClauses, TIME_RANGES, DIFFICULTY_THRESHOLDS } from '../search.js';
import type { SearchFilters } from '@uiuc-course-search/query-types';

describe('buildFilterClauses', () => {
  describe('days filter', () => {
    it('generates SQL for days filter', () => {
      const filters: SearchFilters = { days: 'MWF' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.days = ?');
      expect(result.params).toContain('MWF');
      expect(result.joins).toContain('JOIN sections s ON s.course_id = c.id');
      expect(result.joins).toContain('JOIN meetings m ON m.section_crn = s.crn');
    });
  });

  describe('time filter', () => {
    it('generates SQL for morning filter', () => {
      const filters: SearchFilters = { time: 'morning' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.start_time < ?');
      expect(result.params).toContain('12:00');
    });

    it('generates SQL for afternoon filter', () => {
      const filters: SearchFilters = { time: 'afternoon' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.start_time >= ?');
      expect(result.where).toContain('m.start_time < ?');
      expect(result.params).toContain('12:00');
      expect(result.params).toContain('17:00');
    });

    it('generates SQL for evening filter', () => {
      const filters: SearchFilters = { time: 'evening' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('m.start_time >= ?');
      expect(result.params).toContain('17:00');
    });
  });

  describe('level filter', () => {
    it('generates SQL for level filter', () => {
      const filters: SearchFilters = { level: 400 };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 = ?');
      expect(result.params).toContain(400);
    });
  });

  describe('credits filter', () => {
    it('generates SQL for credits filter', () => {
      const filters: SearchFilters = { credits: 3 };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('c.credit_hours = ?');
      expect(result.params).toContain(3);
    });
  });

  describe('online filter', () => {
    it('generates SQL for online=true', () => {
      const filters: SearchFilters = { online: true };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('online') || w.includes("building_name = ''"))).toBe(true);
    });

    it('generates SQL for online=false (in-person)', () => {
      const filters: SearchFilters = { online: false };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes("building_name != ''"))).toBe(true);
    });
  });

  describe('status filter', () => {
    it('generates SQL for status=open', () => {
      const filters: SearchFilters = { status: 'open' };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('s.status'))).toBe(true);
    });
  });

  describe('difficulty filter', () => {
    it('generates SQL for difficulty=easy', () => {
      const filters: SearchFilters = { difficulty: 'easy' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('c.avg_gpa >= ?');
      expect(result.params).toContain(DIFFICULTY_THRESHOLDS.easy.min_gpa);
    });

    it('generates SQL for difficulty=hard', () => {
      const filters: SearchFilters = { difficulty: 'hard' };
      const result = buildFilterClauses(filters);
      expect(result.where).toContain('c.avg_gpa <= ?');
      expect(result.params).toContain(DIFFICULTY_THRESHOLDS.hard.max_gpa);
    });
  });

  describe('gened_any filter', () => {
    it('generates SQL for gened_any', () => {
      const filters: SearchFilters = { gened_any: ['HUM', 'US'] };
      const result = buildFilterClauses(filters);
      expect(result.where.some(w => w.includes('cg.category_id IN'))).toBe(true);
      expect(result.params).toContain('HUM');
      expect(result.params).toContain('US');
    });
  });

  describe('join deduplication', () => {
    it('deduplicates joins when multiple filters need same table', () => {
      const filters: SearchFilters = { days: 'MWF', time: 'morning', online: true };
      const result = buildFilterClauses(filters);
      const sectionJoins = result.joins.filter(j => j.includes('sections s'));
      expect(sectionJoins.length).toBe(1);
    });
  });
});

describe('TIME_RANGES', () => {
  it('has correct range for early', () => {
    expect(TIME_RANGES.early).toEqual({ end: '09:00' });
  });

  it('has correct range for morning', () => {
    expect(TIME_RANGES.morning).toEqual({ end: '12:00' });
  });

  it('has correct range for midday', () => {
    expect(TIME_RANGES.midday).toEqual({ start: '10:00', end: '14:00' });
  });

  it('has correct range for afternoon', () => {
    expect(TIME_RANGES.afternoon).toEqual({ start: '12:00', end: '17:00' });
  });

  it('has correct range for evening', () => {
    expect(TIME_RANGES.evening).toEqual({ start: '17:00' });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd apps/api && npx vitest run src/services/__tests__/search-filters.test.ts`
Expected: FAIL (buildFilterClauses not exported, constants not defined)

### Step 3: Add filter generation to search.ts

Add to `apps/api/src/services/search.ts`:

```typescript
// Add at top of file after imports:

export const TIME_RANGES: Record<string, { start?: string; end?: string }> = {
  'early': { end: '09:00' },
  'morning': { end: '12:00' },
  'midday': { start: '10:00', end: '14:00' },
  'afternoon': { start: '12:00', end: '17:00' },
  'evening': { start: '17:00' },
};

export const DIFFICULTY_THRESHOLDS = {
  easy: { min_gpa: 3.5, max_difficulty: 3.0 },
  hard: { max_gpa: 3.0, min_difficulty: 4.0 },
};

const STATUS_VALUES: Record<string, string[]> = {
  'open': ['Open'],
  'available': ['Open', 'Restricted'],
  'closed': ['Closed'],
};

export function buildFilterClauses(
  filters: SearchFilters
): { joins: string[]; where: string[]; params: (string | number)[] } {
  const joinsSet = new Set<string>();
  const where: string[] = [];
  const params: (string | number)[] = [];

  // Subject filter
  if (filters.subject) {
    where.push('c.subject = ?');
    params.push(filters.subject);
  }

  // Number filter
  if (filters.number) {
    where.push('c.number = ?');
    params.push(filters.number);
  }

  // Credits filter
  if (filters.credits !== undefined) {
    where.push('c.credit_hours = ?');
    params.push(filters.credits);
  }

  // Level filter
  if (filters.level !== undefined) {
    where.push('CAST(SUBSTR(c.number, 1, 1) AS INTEGER) * 100 = ?');
    params.push(filters.level);
  }

  // GenEd filter (single)
  if (filters.gened_code) {
    joinsSet.add('JOIN course_gened cg ON cg.course_id = c.id');
    where.push('(cg.category_id = ? OR cg.attribute_code = ?)');
    params.push(filters.gened_code, filters.gened_code);
  }

  // GenEd filter (any)
  if (filters.gened_any?.length) {
    joinsSet.add('JOIN course_gened cg ON cg.course_id = c.id');
    const placeholders = filters.gened_any.map(() => '?').join(',');
    where.push(`cg.category_id IN (${placeholders})`);
    params.push(...filters.gened_any);
  }

  // Instructor filter
  if (filters.instructor_ids?.length) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
    joinsSet.add('JOIN meeting_instructors mi ON mi.meeting_id = m.id');
    const placeholders = filters.instructor_ids.map(() => '?').join(',');
    where.push(`mi.instructor_id IN (${placeholders})`);
    params.push(...filters.instructor_ids);
  }

  // Days filter
  if (filters.days) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
    where.push('m.days = ?');
    params.push(filters.days);
  }

  // Time filter
  if (filters.time) {
    const range = TIME_RANGES[filters.time];
    if (range) {
      joinsSet.add('JOIN sections s ON s.course_id = c.id');
      joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
      if (range.start) {
        where.push('m.start_time >= ?');
        params.push(range.start);
      }
      if (range.end) {
        where.push('m.start_time < ?');
        params.push(range.end);
      }
    }
  }

  // Online filter
  if (filters.online !== undefined) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    joinsSet.add('JOIN meetings m ON m.section_crn = s.crn');
    if (filters.online) {
      where.push("(m.building_name = '' OR m.building_name IS NULL OR LOWER(m.building_name) LIKE '%online%')");
    } else {
      where.push("m.building_name != '' AND m.building_name IS NOT NULL AND LOWER(m.building_name) NOT LIKE '%online%'");
    }
  }

  // Status filter
  if (filters.status) {
    joinsSet.add('JOIN sections s ON s.course_id = c.id');
    const statuses = STATUS_VALUES[filters.status] ?? ['Open'];
    const placeholders = statuses.map(() => '?').join(',');
    where.push(`s.status IN (${placeholders})`);
    params.push(...statuses);
  }

  // Difficulty filter
  if (filters.difficulty) {
    const thresholds = DIFFICULTY_THRESHOLDS[filters.difficulty];
    if (thresholds.min_gpa) {
      where.push('c.avg_gpa >= ?');
      params.push(thresholds.min_gpa);
    }
    if (thresholds.max_gpa) {
      where.push('c.avg_gpa <= ?');
      params.push(thresholds.max_gpa);
    }
    if (thresholds.min_difficulty) {
      where.push('c.difficulty_score >= ?');
      params.push(thresholds.min_difficulty);
    }
    if (thresholds.max_difficulty) {
      where.push('c.difficulty_score <= ?');
      params.push(thresholds.max_difficulty);
    }
  }

  return {
    joins: Array.from(joinsSet),
    where,
    params,
  };
}
```

### Step 4: Run test to verify it passes

Run: `cd apps/api && npx vitest run src/services/__tests__/search-filters.test.ts`
Expected: PASS

### Step 5: Integrate buildFilterClauses into keywordSearch

Update the `keywordSearch` function to use `buildFilterClauses` instead of manually building clauses. This is a refactor of the existing code.

### Step 6: Run all search tests

Run: `cd apps/api && npx vitest run src/services/__tests__/search`
Expected: PASS

### Step 7: Commit

```bash
git add apps/api/src/services/search.ts apps/api/src/services/__tests__/search-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add P1 filter SQL generation

Add buildFilterClauses() that generates SQL for:
- days (m.days = ?)
- time (m.start_time ranges)
- level (course number prefix)
- credits (c.credit_hours = ?)
- online (building_name check)
- status (s.status IN (...))
- difficulty (avg_gpa, difficulty_score thresholds)
- gened_any (category_id IN (...))

Add constants:
- TIME_RANGES for time bucket definitions
- DIFFICULTY_THRESHOLDS for easy/hard GPA thresholds

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update Search Route

Return full response metadata with hints, filters, suggestions.

**Files:**
- Modify: `apps/api/src/routes/search.ts`

### Step 1: Update route to use new extraction pipeline

Update `apps/api/src/routes/search.ts`:

```typescript
import { Hono } from 'hono';
import type { D1Database, VectorizeIndex, Ai } from '@cloudflare/workers-types';
import { searchCourses } from '../services/embeddings.js';
import { hybridSearchWithTermRanking, keywordSearch } from '../services/search.js';
import { resolveQuery } from '../services/query-resolver.js';
import { parseQuery } from '../services/query-parser.js';
import { extract } from '../services/extractor.js';
import type { ExtractedQuery, SearchPlan, Hint } from '@uiuc-course-search/query-types';

type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

export const searchRoutes = new Hono<{ Bindings: Bindings }>();

// Semantic search endpoint
searchRoutes.get('/search/semantic', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  try {
    const results = await searchCourses(c.env.VECTORIZE, c.env.AI, query, 20);
    return c.json({ results });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Hybrid search endpoint (combines semantic + keyword with RRF)
searchRoutes.get('/api/search', async (c) => {
  const query = c.req.query('q');
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400);
  }

  const startTime = performance.now();

  // 1. Parse power-user syntax
  const parsed = parseQuery(query);

  // 2. Extract hints from residual text
  const extractionStart = performance.now();
  const extraction = extract(parsed.clauses[0].residual);
  const extractionMs = performance.now() - extractionStart;

  // 3. Build ExtractedQuery for resolver (bridge old format)
  const extracted: ExtractedQuery = {
    rawQuery: query,
    hints: extraction.hints.map(h => ({
      type: mapHintType(h.type),
      value: typeof h.value === 'object' && 'subject' in h.value
        ? `${h.value.subject} ${h.value.number}`
        : String(h.value),
      confidence: h.metadata.confidence,
      metadata: typeof h.value === 'object' && 'subject' in h.value
        ? { subject: h.value.subject, number: h.value.number }
        : undefined,
    })),
    residual: extraction.residual,
  };

  // 4. Apply parsed filters (from power-user syntax)
  for (const filter of parsed.clauses[0].filters) {
    extracted.hints.push({
      type: filter.field as any,
      value: filter.value,
      confidence: 1.0,
      isExplicit: true,
    });
  }

  // 5. Apply gened_any/all from parsed query
  if (parsed.clauses[0].genedMode?.any) {
    // Will be handled in search
  }
  if (parsed.clauses[0].genedMode?.all) {
    // Will be handled in search
  }

  // 6. Resolve hints against database
  const plan = await resolveQuery(c.env.DB, extracted);

  // 7. Apply gened_any/all to plan
  if (parsed.clauses[0].genedMode?.any) {
    plan.filters.gened_any = parsed.clauses[0].genedMode.any;
  }
  if (parsed.clauses[0].genedMode?.all) {
    plan.filters.gened_all = parsed.clauses[0].genedMode.all;
  }

  // 8. Allow manual overrides from query params
  if (c.req.query('subject')) plan.filters.subject = c.req.query('subject');
  if (c.req.query('gened')) plan.filters.gened_code = c.req.query('gened');
  if (c.req.query('credits')) plan.filters.credits = parseInt(c.req.query('credits')!);

  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 20;

  try {
    const searchStart = performance.now();
    const results = await hybridSearchWithTermRanking(
      c.env.DB,
      c.env.VECTORIZE,
      c.env.AI,
      plan,
      limit
    );
    const searchMs = performance.now() - searchStart;
    const totalMs = performance.now() - startTime;

    return c.json({
      results: results.map(r => ({
        ...r.course,
        _score: r.score,
        _semanticRank: r.semanticRank,
        _keywordRank: r.keywordRank,
        _termPriority: r.termPriority,
        _historical: r.historical,
      })),
      meta: {
        query: {
          raw: query,
          residual: extraction.residual,
        },
        extraction: {
          hints: extraction.hints,
        },
        plan: {
          filters: plan.filters,
          clauses: parsed.clauses,
        },
        ambiguities: plan.ambiguities,
        timing: {
          extraction_ms: Math.round(extractionMs),
          search_ms: Math.round(searchMs),
          total_ms: Math.round(totalMs),
        },
      },
      pagination: {
        total: results.length,
        limit,
        offset: 0,
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

function mapHintType(type: string): any {
  const mapping: Record<string, string> = {
    'courseCode': 'course_code',
    'crn': 'crn',
    'subject': 'subject',
    'instructor': 'instructor',
    'days': 'days',
    'time': 'time',
    'level': 'level',
    'credits': 'credits',
    'online': 'online',
    'status': 'status',
    'difficulty': 'difficulty',
    'gened': 'gened',
  };
  return mapping[type] || type;
}
```

### Step 2: Run typecheck

Run: `cd apps/api && npm run typecheck`
Expected: PASS

### Step 3: Run API tests

Run: `cd apps/api && npm test`
Expected: PASS

### Step 4: Commit

```bash
git add apps/api/src/routes/search.ts
git commit -m "$(cat <<'EOF'
feat(api): update search route with full response metadata

- Integrate parseQuery for power-user syntax
- Integrate extract for natural language hints
- Return meta.query (raw, residual)
- Return meta.extraction (hints with metadata)
- Return meta.plan (filters, clauses)
- Return meta.timing (extraction_ms, search_ms, total_ms)
- Support gened:any/all from parsed query

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Delete Old Extractor Package

Remove the now-replaced query-extractor-lite package.

**Files:**
- Delete: `packages/query-extractor-lite/` (entire directory)
- Modify: `apps/api/package.json` (remove dependency)

### Step 1: Remove dependency from package.json

Edit `apps/api/package.json` to remove the query-extractor-lite dependency.

### Step 2: Run install to update lockfile

Run: `npm install`
Expected: PASS

### Step 3: Delete the package directory

Run: `rm -rf packages/query-extractor-lite`

### Step 4: Run full test suite

Run: `cd apps/api && npm run check`
Expected: PASS

### Step 5: Commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove query-extractor-lite package

Replaced by server-side extractor in apps/api/src/services/extractor.ts.
The new extractor has:
- Three-phase extraction (regex → alias → NLP)
- Rich hint metadata (source, confidence, span)
- Cue rule for GenEd names
- Better instructor extraction

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Add Golden File Tests

Create a golden file with expected parses for common queries.

**Files:**
- Create: `apps/api/src/services/__tests__/golden-queries.json`
- Create: `apps/api/src/services/__tests__/golden.test.ts`

### Step 1: Create golden queries file

Create `apps/api/src/services/__tests__/golden-queries.json`:

```json
[
  {
    "input": "cs 225",
    "expected": {
      "hints": [{ "type": "courseCode" }],
      "filters": { "subject": "CS", "number": "225" },
      "residual": ""
    }
  },
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
  },
  {
    "input": "humanities",
    "expected": {
      "hints": [],
      "filters": {},
      "residual": "humanities"
    },
    "note": "No cue word, so humanities stays as residual for semantic search"
  },
  {
    "input": "CS 225 with Fagen",
    "expected": {
      "hints": [
        { "type": "courseCode" },
        { "type": "instructor", "value": "Fagen" }
      ],
      "filters": { "subject": "CS", "number": "225" },
      "residual": ""
    },
    "note": "Instructor resolved separately by resolver"
  },
  {
    "input": "MWF morning 3 credits",
    "expected": {
      "hints": [
        { "type": "days", "value": "MWF" },
        { "type": "time", "value": "morning" },
        { "type": "credits", "value": 3 }
      ],
      "filters": { "days": "MWF", "time": "morning", "credits": 3 },
      "residual": ""
    }
  },
  {
    "input": "easy online gen ed",
    "expected": {
      "hints": [
        { "type": "difficulty", "value": "easy" },
        { "type": "online", "value": true }
      ],
      "filters": { "difficulty": "easy", "online": true },
      "residual": "gen ed"
    },
    "note": "gen ed without category name stays as residual"
  },
  {
    "input": "400 level CS",
    "expected": {
      "hints": [
        { "type": "level", "value": 400 },
        { "type": "courseCode" }
      ],
      "filters": { "level": 400, "subject": "CS" },
      "residual": ""
    }
  },
  {
    "input": "data structures",
    "expected": {
      "hints": [],
      "filters": {},
      "residual": "data structures"
    },
    "note": "Pure semantic query, no extraction"
  },
  {
    "input": "gened:HUM easy",
    "expected": {
      "hints": [{ "type": "difficulty", "value": "easy" }],
      "filters": { "gened_code": "HUM", "difficulty": "easy" },
      "residual": ""
    },
    "note": "Power-user syntax gened:HUM"
  },
  {
    "input": "gened:any(HUM,US) morning",
    "expected": {
      "hints": [{ "type": "time", "value": "morning" }],
      "filters": { "gened_any": ["HUM", "US"], "time": "morning" },
      "residual": ""
    }
  },
  {
    "input": "open sections intro",
    "expected": {
      "hints": [
        { "type": "status", "value": "open" },
        { "type": "level", "value": 100 }
      ],
      "filters": { "status": "open", "level": 100 },
      "residual": "sections"
    }
  }
]
```

### Step 2: Create golden test runner

Create `apps/api/src/services/__tests__/golden.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseQuery } from '../query-parser.js';
import { extract } from '../extractor.js';
import goldenQueries from './golden-queries.json';

describe('golden file tests', () => {
  for (const testCase of goldenQueries) {
    it(`parses "${testCase.input}"`, () => {
      // Parse power-user syntax
      const parsed = parseQuery(testCase.input);

      // Extract from residual
      const extraction = extract(parsed.clauses[0].residual);

      // Check hints
      for (const expectedHint of testCase.expected.hints) {
        const matchingHint = extraction.hints.find(h => h.type === expectedHint.type);
        expect(matchingHint, `Expected hint of type ${expectedHint.type}`).toBeDefined();

        if (expectedHint.value !== undefined) {
          expect(matchingHint!.value).toBe(expectedHint.value);
        }
      }

      // Check residual if specified
      if (testCase.expected.residual !== undefined) {
        expect(extraction.residual.trim()).toBe(testCase.expected.residual);
      }
    });
  }
});
```

### Step 3: Run golden tests

Run: `cd apps/api && npx vitest run src/services/__tests__/golden.test.ts`
Expected: PASS (or identify regressions to fix)

### Step 4: Commit

```bash
git add apps/api/src/services/__tests__/golden-queries.json apps/api/src/services/__tests__/golden.test.ts
git commit -m "$(cat <<'EOF'
test(api): add golden file tests for query extraction

11 test cases covering:
- Course codes (CS 225)
- Instructors (with Fagen)
- Schedule (MWF morning)
- Credits (3 credits)
- Level (400 level, intro)
- Status (open sections)
- Difficulty (easy)
- Online
- GenEd with cue (humanities gen ed)
- GenEd without cue (pure semantic)
- Power-user syntax (gened:HUM, gened:any)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Run Full Test Suite and Deploy

Verify everything works end-to-end.

**Files:**
- None (verification only)

### Step 1: Run typecheck

Run: `cd apps/api && npm run typecheck`
Expected: PASS

### Step 2: Run all tests

Run: `cd apps/api && npm test`
Expected: PASS

### Step 3: Run build check

Run: `cd apps/api && npm run check`
Expected: PASS

### Step 4: Test locally

Run: `cd apps/api && npm run dev`

Test queries:
```bash
curl "http://localhost:8787/api/search?q=easy%20CS%20gen%20ed%20MWF%20morning"
curl "http://localhost:8787/api/search?q=CS%20225%20with%20Fagen"
curl "http://localhost:8787/api/search?q=gened:any(HUM,US)%20easy"
curl "http://localhost:8787/api/search?q=data%20structures"
```

### Step 5: Final commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: complete unified query system implementation

Implements the server-only, layman-first query system:

Components:
- Query parser (power-user syntax: field:value, gened:any/all, -negation)
- Extractor (3-phase: regex → alias → NLP)
- Alias registry (deterministic matching with cue rule)
- Updated resolver (all hint types)
- Updated search (P1 filters: days, time, level, credits, online, status, difficulty)
- Updated route (full response metadata)

See docs/plans/2026-01-22-unified-query-system-design.md for rationale.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Query Types | `packages/query-types/index.ts` |
| 2 | Query Parser | `apps/api/src/services/query-parser.ts` |
| 3 | Alias Registry | `apps/api/src/services/alias-registry.ts` |
| 4 | Extractor | `apps/api/src/services/extractor.ts` |
| 5 | Resolver | `apps/api/src/services/query-resolver.ts` |
| 6 | Search Filters | `apps/api/src/services/search.ts` |
| 7 | Search Route | `apps/api/src/routes/search.ts` |
| 8 | Cleanup | Delete `packages/query-extractor-lite/` |
| 9 | Golden Tests | `apps/api/src/services/__tests__/golden-queries.json` |
| 10 | Verification | Run full test suite |

**Total commits:** 10
**Estimated new code:** ~800 lines
**Estimated tests:** ~400 lines
