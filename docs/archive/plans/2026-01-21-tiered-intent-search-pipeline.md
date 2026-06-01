# Implementation Plan - Tiered Intent-Based Search Pipeline

## Phase 1: Exploration & Understanding
- [x] Analyze search pipeline (`search.ts`, `extractor.ts`, `query-resolver.ts`)
- [x] Identify root causes of poor ranking:
    - `&` causes parser failures
    - Rigid extraction order ("cs 400 level" vs "400 level cs")
    - "AI" not expanding to "Artificial Intelligence"
    - "Easy" dominating semantic search
    - Weak boosting of Subject/Title matches in RRF

## Phase 2: Design
- [x] **Architecture:** Tiered Intent-Based Pipeline (Hybrid Threshold)
    - **Tier 1 (Navigational):** Exact Course/CRN + Filters. Stops if found.
    - **Tier 2 (Structured):** Strict Filters (Subject, Level) + FTS. Stops if N >= 3.
    - **Tier 3 (Topic Hybrid):** Synonym Expansion + FTS (Boosted) + Semantic.
    - **Tier 4 (Fallback):** Broad Semantic.
- [x] **Ranking Strategy:**
    - Title Match: 2.0x Boost
    - Description Match: 0.5x Dampener
    - Subject Match: 10.0x Boost
- [x] **Components:**
    - `TopicMap`: "ai" -> "artificial intelligence"
    - `MultiPassExtractor`: Order-independent entity extraction.

## Phase 3: Implementation

### Step 1: Sanitization & Basic Setup
- [ ] **Fix Parser:** Update `services/search.ts` to strictly sanitize `&`, `|`, and syntax chars before they hit FTS.
- [ ] **Create Topic Map:** Create `services/topic-registry.ts` with common CS/UIUC synonyms.

### Step 2: Robust Extraction
- [ ] **Refactor Extractor:** Rewrite `services/extractor.ts` to use a multi-pass approach (Regex Entities -> Keyword Attributes -> Topic Expansion). Ensure "CS 400 level" and "400 level CS" yield identical results.

### Step 3: Pipeline Implementation
- [ ] **Create Pipeline Class:** Implement `services/search-pipeline.ts`.
- [ ] **Implement Tiers:**
    - Tier 1: `findExactMatch`
    - Tier 2: `searchStructured`
    - Tier 3: `searchHybrid` (with Topic Expansion)
- [ ] **Wire up Ranking:** Apply the Title/Description weighting logic in the FTS query builder or post-processing.

### Step 4: Integration
- [ ] **Update Resolver:** Modify `services/query-resolver.ts` to use the new `SearchPipeline`.
- [ ] **Update Route:** Ensure `routes/search.ts` calls the new resolver method.

## Phase 4: Verification
- [ ] **Test Cases:**
    - "cs 225" -> Exact match (Tier 1)
    - "cs 400 level" -> List of 400-level CS courses (Tier 2)
    - "400 level cs" -> Same as above (Tier 2)
    - "easy ai classes" -> "Artificial Intelligence" in title ranks #1 (Tier 3)
    - "phil of law & state" -> Returns results, no crash.
