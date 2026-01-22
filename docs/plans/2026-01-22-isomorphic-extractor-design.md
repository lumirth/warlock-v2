# Isomorphic Query Extractor Design

## Overview

A single query extractor package that runs identically on client (React/Vite) and server (Cloudflare Workers). Uses a "Swiss Cheese" strategy: regex patterns extract structured data first, then Compromise NLP extracts linguistic patterns from the residual text.

## Goals

1. **Accuracy** - Comprehensive test suite with golden file testing. Each pattern well-tested in isolation and in combination.

2. **Extensibility** - Single-file pattern registry. Adding a pattern means adding one entry with an extract function. Clear three-phase structure (structured → keywords → NLP).

3. **Debuggability** - One codebase, identical behavior on client and server. Rich hint metadata includes source (regex vs Compromise), text spans, and extractor version.

4. **Graceful degradation** - If Compromise fails to load, falls back to regex-only. Response includes `degraded: true` flag so UI can indicate reduced functionality.

## Key Decisions

- **Server is source of truth** - Client hints are preview; server re-extracts and validates
- **Hybrid vocabulary** - Hardcoded UIUC vocabulary on both sides; dynamic vocabulary (instructors) server-only
- **Sequential extraction** - Regex consumes structured patterns, Compromise processes residual
- **Golden file testing** - Single JSON file with test cases for accuracy validation
- **No rollback** - Breaking change, clean migration, fix forward if issues

## Package Structure

```
packages/extractor/
├── src/
│   ├── index.ts              # Main extract() function + pattern registry
│   ├── types.ts              # ExtractedQuery, Hint, HintMetadata interfaces
│   ├── compromise-plugin.ts  # UIUC vocabulary (GenEd, buildings, nicknames)
│   ├── patterns/             # Pattern extract functions
│   │   ├── course-code.ts
│   │   ├── crn.ts
│   │   ├── instructor.ts
│   │   ├── negation.ts
│   │   └── ...
│   └── vocabulary/
│       ├── gened-codes.ts    # HUM, NAT, SBS, QR1, etc.
│       ├── buildings.ts      # Siebel, Grainger, ECEB, etc.
│       └── nicknames.ts      # "Data Structures" → CS 225
├── test/
│   ├── index.test.ts         # Main test runner
│   └── golden-queries.json   # Test corpus
├── package.json
└── tsconfig.json
```

**Exports:**
```typescript
export { extract } from './index'
export type { ExtractedQuery, Hint, HintMetadata } from './types'
export { extendVocabulary } from './compromise-plugin'
```

## Core Types

```typescript
export type HintType =
  | 'courseCode'
  | 'crn'
  | 'instructor'
  | 'days'
  | 'time'
  | 'difficulty'
  | 'gened'
  | 'credits'
  | 'semester'
  | 'online'
  | 'status'
  | 'negation'
  | 'vagueIntent'

export type ExtractionSource = 'regex' | 'compromise'

export interface HintMetadata {
  source: ExtractionSource
  span: [number, number]      // Start and end index in original query
  confidence: number          // 0-1, how certain we are
  raw: string                 // Original matched text
}

export interface Hint {
  type: HintType
  value: string | number | boolean | NegationValue
  metadata: HintMetadata
}

export interface NegationValue {
  target: HintType            // What's being negated (e.g., 'time')
  value: string               // The negated value (e.g., 'morning')
}

export interface ExtractedQuery {
  rawQuery: string
  hints: Hint[]
  residual: string            // Leftover text for semantic search
  extractorVersion: string
  degraded: boolean           // True if Compromise failed to load
}

export interface PatternExtractor {
  name: HintType
  phase: 1 | 2 | 3            // 1=structured, 2=keywords, 3=NLP
  extract: (text: string, doc?: CompromiseDocument) => ExtractionResult | null
}

export interface ExtractionResult {
  hint: Omit<Hint, 'metadata'> & { span: [number, number] }
  consumed: string            // Text to remove from residual
}
```

## Pattern Registry & Extraction Flow

```typescript
import nlp from 'compromise'
import { uiucPlugin } from './compromise-plugin'

const EXTRACTOR_VERSION = '1.0.0'

nlp.plugin(uiucPlugin)

const patterns: PatternExtractor[] = [
  // Phase 1: Structured (regex) - most specific first
  { name: 'courseCode', phase: 1, extract: extractCourseCode },
  { name: 'crn', phase: 1, extract: extractCRN },
  { name: 'credits', phase: 1, extract: extractCredits },
  { name: 'semester', phase: 1, extract: extractSemester },
  { name: 'days', phase: 1, extract: extractDays },
  { name: 'gened', phase: 1, extract: extractGened },

  // Phase 2: Keywords (regex)
  { name: 'difficulty', phase: 2, extract: extractDifficulty },
  { name: 'time', phase: 2, extract: extractTime },
  { name: 'online', phase: 2, extract: extractOnline },
  { name: 'status', phase: 2, extract: extractStatus },

  // Phase 3: NLP (Compromise)
  { name: 'instructor', phase: 3, extract: extractInstructor },
  { name: 'negation', phase: 3, extract: extractNegation },
  { name: 'vagueIntent', phase: 3, extract: extractVagueIntent },
]

export function extract(query: string): ExtractedQuery {
  let residual = query
  let degraded = false
  const hints: Hint[] = []

  // Phase 1 & 2: Regex patterns
  for (const pattern of patterns.filter(p => p.phase <= 2)) {
    const result = pattern.extract(residual)
    if (result) {
      hints.push(buildHint(result, 'regex'))
      residual = removeSpan(residual, result.hint.span)
    }
  }

  // Phase 3: Compromise NLP on residual
  try {
    const doc = nlp(residual)
    for (const pattern of patterns.filter(p => p.phase === 3)) {
      const result = pattern.extract(residual, doc)
      if (result) {
        hints.push(buildHint(result, 'compromise'))
        residual = removeSpan(residual, result.hint.span)
      }
    }
  } catch (e) {
    degraded = true
    console.error('Compromise extraction failed:', e)
  }

  return {
    rawQuery: query,
    hints,
    residual: residual.replace(/\s+/g, ' ').trim(),
    extractorVersion: EXTRACTOR_VERSION,
    degraded,
  }
}
```

## Compromise Plugin (UIUC Vocabulary)

```typescript
import { genedCodes } from './vocabulary/gened-codes'
import { buildings } from './vocabulary/buildings'

export const uiucPlugin = {
  tags: {
    GenEdCode: { isA: 'Noun' },
    Building: { isA: 'Place' },
    CourseNickname: { isA: 'Noun' },
    InstructorTitle: { isA: 'Honorific' },
  },

  words: {
    ...Object.fromEntries(genedCodes.map(c => [c.toLowerCase(), 'GenEdCode'])),
    ...Object.fromEntries(buildings.map(b => [b.toLowerCase(), 'Building'])),
    'ta': 'InstructorTitle',
    'prof': 'InstructorTitle',
    'professor': 'InstructorTitle',
    'instructor': 'InstructorTitle',
    'lecturer': 'InstructorTitle',
  },
}

export function extendVocabulary(instructorNames: string[]) {
  instructorNames.forEach(name => {
    nlp.plugin({ words: { [name.toLowerCase()]: 'Person' } })
  })
}
```

### Vocabulary Files

```typescript
// vocabulary/gened-codes.ts
export const genedCodes = [
  'ACP', 'CMP', 'HUM', 'HP', 'LA', 'NAT', 'PS', 'LS',
  'SBS', 'SS', 'BSC', 'CS', 'NW', 'US', 'WCC', 'QR', 'QR1', 'QR2'
]

// vocabulary/buildings.ts
export const buildings = [
  'Siebel', 'Grainger', 'ECEB', 'DCL', 'Altgeld', 'Noyes',
  'Chemistry', 'Loomis', 'MEB', 'Transportation', 'Illini Union'
]

// vocabulary/nicknames.ts
export const courseNicknames: Record<string, { subject: string, number: string }> = {
  'data structures': { subject: 'CS', number: '225' },
  'discrete math': { subject: 'CS', number: '173' },
  'systems programming': { subject: 'CS', number: '241' },
  'algorithms': { subject: 'CS', number: '374' },
}
```

## Client Integration

```typescript
// apps/web/src/hooks/useExtractor.ts

import { useState, useEffect } from 'react'
import type { ExtractedQuery } from '@uiuc-course-search/extractor'

let extractorPromise: Promise<typeof import('@uiuc-course-search/extractor')> | null = null

function loadExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@uiuc-course-search/extractor')
  }
  return extractorPromise
}

export function useExtractor(query: string) {
  const [extracted, setExtracted] = useState<ExtractedQuery | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setExtracted(null)
      return
    }

    let cancelled = false
    setLoading(true)

    loadExtractor().then(({ extract }) => {
      if (!cancelled) {
        setExtracted(extract(query))
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [query])

  return { extracted, loading }
}
```

Key points:
- Extractor is lazy-loaded (not in initial bundle)
- Chips appear as user types once extractor loads
- Client sends hints + version to server for comparison

## Server Integration

```typescript
// apps/api/src/services/extractor.ts

import { extract, extendVocabulary } from '@uiuc-course-search/extractor'
import type { ExtractedQuery, Hint } from '@uiuc-course-search/extractor'
import type { D1Database } from '@cloudflare/workers-types'

export async function initExtractor(db: D1Database) {
  const { results } = await db.prepare(
    'SELECT DISTINCT display_name FROM instructors'
  ).all<{ display_name: string }>()

  extendVocabulary(results.map(r => r.display_name))
}

export function serverExtract(
  query: string,
  clientHints?: Hint[],
  clientVersion?: string
): ExtractedQuery & { discrepancy?: DiscrepancyLog } {
  const extracted = extract(query)

  let discrepancy: DiscrepancyLog | undefined

  if (clientHints && clientVersion) {
    discrepancy = compareHints(extracted.hints, clientHints, clientVersion)
    if (discrepancy.hasDiff) {
      console.warn('Hint discrepancy:', discrepancy)
    }
  }

  return { ...extracted, discrepancy }
}

interface DiscrepancyLog {
  hasDiff: boolean
  clientVersion: string
  serverVersion: string
  clientOnly: Hint[]
  serverOnly: Hint[]
  valueDiffs: Array<{ type: string, client: unknown, server: unknown }>
}
```

Key points:
- Server loads instructor names at startup via `extendVocabulary()`
- Server always re-extracts; client hints used for logging only
- Discrepancies logged for debugging version drift

## Testing Strategy

```typescript
// test/index.test.ts

import { describe, it, expect } from 'vitest'
import { extract } from '../src'
import goldenQueries from './golden-queries.json'

describe('extractor', () => {
  describe('golden file tests', () => {
    for (const testCase of goldenQueries) {
      it(`extracts "${testCase.input}"`, () => {
        const result = extract(testCase.input)

        for (const [type, expected] of Object.entries(testCase.expected)) {
          const hint = result.hints.find(h => h.type === type)
          expect(hint, `Missing hint: ${type}`).toBeDefined()
          expect(hint?.value).toEqual(expected)
        }

        expect(result.hints.length).toBe(Object.keys(testCase.expected).length)

        if (testCase.residual !== undefined) {
          expect(result.residual).toBe(testCase.residual)
        }
      })
    }
  })
})
```

### Golden Queries File

```json
[
  {
    "input": "cs 225",
    "expected": { "courseCode": "CS 225" },
    "residual": ""
  },
  {
    "input": "CS 225 with Dr. Fleck",
    "expected": { "courseCode": "CS 225", "instructor": "Fleck" },
    "residual": ""
  },
  {
    "input": "easy humanities gened",
    "expected": { "difficulty": "easy", "gened": "HUM" },
    "residual": ""
  },
  {
    "input": "data structures not morning",
    "expected": {
      "courseCode": "CS 225",
      "negation": { "target": "time", "value": "morning" }
    },
    "residual": ""
  },
  {
    "input": "3 credit MWF afternoon class",
    "expected": { "credits": 3, "days": "MWF", "time": "afternoon" },
    "residual": "class"
  },
  {
    "input": "Fagen's section of 225",
    "expected": { "instructor": "Fagen", "courseCode": "CS 225" }
  }
]
```

## Error Handling & Degradation

| Failure | Impact | Behavior |
|---------|--------|----------|
| Single regex pattern throws | Minimal | Log, skip pattern, continue |
| Single NLP pattern throws | Minimal | Log, skip pattern, continue |
| Compromise fails to load | Moderate | `degraded: true`, regex-only extraction |
| All extraction fails | Severe | Return empty hints, full query as residual |

Client UI response to degradation:
```tsx
{extracted?.degraded && (
  <span className="warning">Some filters may not be detected</span>
)}
```

## Migration Plan

**Approach:** Breaking change. Delete old extractors, ship new one.

**Steps:**

1. **Build new package**
   - Create `packages/extractor/` with full implementation
   - Comprehensive golden file tests
   - Verify all patterns work

2. **Update server**
   - Replace `query-extractor-lite` import with new extractor
   - Add `initExtractor()` call for dynamic vocabulary
   - Delete `packages/query-extractor-lite/`

3. **Update client**
   - Replace `src/lib/extractor.ts` with `useExtractor` hook
   - Add lazy loading
   - Delete old extractor file

4. **Deploy together**
   - Server and client deploy at same time
   - No backwards compatibility period
   - Old code is gone

**No rollback plan.** If something breaks, fix it forward.

## Pattern Coverage

| Pattern | Phase | Source | Example |
|---------|-------|--------|---------|
| Course codes | 1 | regex | "CS 225", "math241" |
| CRNs | 1 | regex | "12345", "CRN 54321" |
| Credit hours | 1 | regex | "3 credits", "4 credit hours" |
| Semester | 1 | regex | "fall 2025", "spring semester" |
| Days | 1 | regex | "MWF", "TR", "tuesday thursday" |
| GenEd codes | 1 | regex | "HUM", "QR1", "humanities" |
| Difficulty | 2 | regex | "easy", "hard", "challenging" |
| Time keywords | 2 | regex | "morning", "afternoon", "evening" |
| Online status | 2 | regex | "online", "in person", "remote" |
| Section status | 2 | regex | "open", "available" |
| Instructors | 3 | compromise | "with Fagen", "Dr. Margaret Fleck" |
| Negation | 3 | compromise | "not morning", "avoid early" |
| Vague intent | 3 | compromise | "something about AI" |

## Replaces

- `packages/query-extractor-lite/` (current regex-only server extractor)
- `apps/web/src/lib/extractor.ts` (current incomplete Compromise client extractor)
