# QueryCompiler + SearchPlan Design

**Date:** 2026-01-20
**Status:** Draft (reviewed)

## Goal
Build a lightweight QueryCompiler that converts natural-language queries into canonical search constraints, then apply those constraints consistently across D1 and Vectorize retrieval with a soft-boost reranking stage. Provide UX-friendly slot output by default and gated debug payloads on demand.

## Constraints
- **Cloudflare Workers Free** CPU budget is tight; avoid heavy parsing in the Worker per request.
- **Bundle size** should stay small; client-side parsing keeps Worker lean.
- Retrieval correctness requires **MUST** filters to be enforced in both D1 and Vectorize to prevent leakage.

## Architecture Overview
The system is split into two stages:

1) **Extract (client-first, pure)**
- Runs in the browser (Compromise or a minimal parser).
- Emits “hints” with evidence flags and ordinal confidence.
- No DB access; deterministic and portable.

2) **Resolve (server-authoritative)**
- Maps hints to canonical IDs using D1 (subjects, instructors, gened codes, terms).
- Produces final slot modes and a `SearchPlan` used by both retrieval paths.

This keeps UX fast while ensuring the Worker is the source of truth for canonical mapping and enforcement.

## Data Model

### Hint (from extract)
```ts
type ExtractConf = 'LOW' | 'MED' | 'HIGH';

type Hint = {
  type: 'instructor' | 'gened' | 'subject' | 'term' | 'credits' | 'level';
  value: string;
  evidence: {
    explicitCue: boolean;    // e.g., “gened”, “by”, “fall”
    looksLikeCode: boolean;  // e.g., CS, HIST, CS 225
    exactVocabHit: boolean;  // closed vocab match
  };
  extractConf: ExtractConf;
};
```

### Resolution Result
```ts
type SlotMode = 'MUST' | 'SHOULD' | 'RESIDUAL';

type Slot = {
  type: Hint['type'];
  mode: SlotMode;
  display: string;
  canonical?: Record<string, string | number>;
  status: 'matched' | 'corrected' | 'ambiguous' | 'dropped';
  alternatives?: Array<Record<string, string | number>>;
};

type SearchPlan = {
  mustFilters: Record<string, string | number>;
  shouldBoosts: Array<{ type: Slot['type']; value: unknown; weight: 'LOW' | 'MED' | 'HIGH' }>;
  residualQuery: string;
  slots: Slot[];
};
```

## Slot Mode Rules
- **MUST** when explicit cue + high confidence (e.g., “gened humanities”, “CS 225”, “Fall 2026”).
- **SHOULD** when cue or moderate confidence is present (e.g., “fagen” without “by”).
- **RESIDUAL** when confidence is low or ambiguous; token goes back into residual query text.

Instructor is a **default SHOULD** unless explicit cues and high resolver confidence justify MUST.

## Retrieval & Ranking Pipeline
1) **Apply MUST filters** in **both** retrieval paths:
   - D1 FTS query uses WHERE clauses for must filters.
   - Vectorize query applies metadata filters (term, subject, gened, level, etc.).
2) **Run hybrid retrieval** (D1 + Vectorize) and fuse via RRF.
3) **Post-RRF boost** for SHOULD matches:
   - Add a small bonus by confidence bucket (LOW < MED < HIGH).
   - Ensure boosts do not overpower base relevance.

This prevents semantic leakage while keeping preferences as soft nudges.

## Vectorize Metadata Indexes (Suggested)
Prioritize MUST filters in metadata:
- `term`
- `subject`
- `gened`
- `level`
Optional:
- `credits`
- `instructor_id` (only if promoted to MUST in specific cases)

## API Contract
Default response should return **slot mode + canonical values**:

```json
{
  "slots": [
    {
      "type": "instructor",
      "mode": "SHOULD",
      "display": "Fagen",
      "canonical": { "instructor_id": 123, "name": "Fagen" },
      "status": "matched"
    }
  ],
  "mustFilters": { "term": "spring", "subject": "CS" },
  "residualQuery": "machine learning"
}
```

This supports UI chips and user corrections without exposing internal heuristics by default.

## Debug Gating
Two-layer gate for full evidence/debug output:
1) **Environment flag** `DEBUG_EXPLAIN=true` controls availability. If disabled, return **404**.
2) **Auth** required in production when enabled:
   - Preferred: **Cloudflare Access** (JWT validation).
   - Break-glass: **Bearer token** via Worker secret.

Debug responses must set `Cache-Control: no-store`.

## Error Handling
- If hints are missing or malformed, proceed with residual query only.
- If resolver is ambiguous, keep the slot as SHOULD or RESIDUAL and return alternatives.
- Never return empty results solely due to low-confidence slots.

## Testing
- Unit tests for hint extraction rules (client) and slot mode mapping (server).
- Service tests for SearchPlan application in D1 + Vectorize paths.
- RRF + boost invariants: ensure MUST filters are always respected.

## Open Questions
- Final metadata index budget allocation for Vectorize.
- How aggressive SHOULD boosts should be (delta values).
- Whether instructor can become MUST when user toggles “only” in UI.
