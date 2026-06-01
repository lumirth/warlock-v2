# Smart Hybrid Search Design

**Date:** 2026-01-21
**Goal:** Deliver "Google-style" single-box natural language search for UIUC courses.
**Constraints:** Cloudflare Workers Free (10ms CPU limit), D1 (SQL), Vectorize (Semantic).

---

## 1. Architecture Overview

We will adopt a **Monorepo** structure with **Client-Heavy Extraction** and **Server-Authoritative Resolution**.

### 1.1 Components

*   **`apps/web` (Frontend)**: Cloudflare Pages app (React/Vite).
    *   Runs `compromise` locally for fast NLP extraction.
    *   Provides instant UI feedback (chips, "Did you mean?").
    *   Sends `rawQuery` + `hints` to API.
*   **`apps/api` (Backend)**: Cloudflare Worker (Hono).
    *   **Resolver**: Validates hints and maps them to canonical IDs (D1 lookups).
    *   **Fallback**: Runs a lightweight Regex parser if hints are missing.
    *   **Execution**: Parallel D1 (Keyword) + Vectorize (Semantic) search.
*   **`packages/query-types`**: Shared TypeScript interfaces (`Hint`, `SearchPlan`).
*   **`packages/query-extractor-lite`**: Lightweight Regex/Dictionary extractor (for Server Fallback).

### 1.2 Data Flow

1.  **User Input**: "easy gened humanities by fagen"
2.  **Client Extraction**:
    *   `instructor`: "Fagen" (Confidence: High)
    *   `gened`: "Humanities" (Confidence: High)
    *   `residual`: "easy"
3.  **API Request**: `POST /search { query: "...", hints: [...] }`
4.  **Server Resolution**:
    *   `instructor "Fagen"` -> Fuzzy Search `instructors` -> ID `123` (Match Score: 0.95)
    *   `gened "Humanities"` -> Map `GENED_CODES` -> Code `1HUM`
5.  **Search Plan**:
    *   `filters`: `{ instructor_id: 123, gened_code: "1HUM" }`
    *   `semantic_query`: "easy"
6.  **Execution**:
    *   **Vectorize**: Search "easy", filter metadata `gened_code="1HUM"` (cannot filter instructor efficiently in metadata yet, maybe as post-filter or if index allows).
    *   **D1**: `SELECT * FROM courses WHERE instructor_id=123 AND gened_code='1HUM' AND course_fts MATCH 'easy'`
7.  **Fusion**: RRF combination of results.

---

## 2. Search Logic Details

### 2.1 Extraction (Client Side)
Uses `compromise` to identify:
*   **Instructors**: Patterns like "Professor X", "by X", or known names.
*   **Subjects**: "CS", "Computer Science".
*   **GenEds**: "Humanities", "Quant", "QR".
*   **Credits**: "3 credit", "4 hours".

### 2.2 Resolution (Server Side)
*   **Strict Mapping**: GenEds, Subjects, Terms.
*   **Fuzzy Matching**: Instructors. Trigram similarity against `instructors` table.
*   **Constraint Logic**:
    *   If Resolution Confidence > Threshold -> **Hard Filter** (MUST).
    *   If Resolution Confidence < Threshold -> **Soft Boost** (SHOULD) or Drop.

### 2.3 Hybrid Execution
*   **Vectorize**:
    *   Index Metadata: `gened_code`, `subject`, `level` (100, 200).
    *   Query: Residual text.
*   **D1 FTS5**:
    *   Query: Residual text + mapped entities (e.g. "Fagen" might be added to query if not a hard filter).
    *   Filters: All Hard Filters.

---

## 3. Data Schema Updates

### 3.1 Vectorize Metadata
We need to update the embedding sync to include:
*   `gened_ids`: Array of strings (e.g. `["1HUM", "1US"]`).
*   `subject`: String ("CS").
*   `level`: Number (100, 200).
*   `instructor_ids`: Array of IDs (Top 5 instructors? Vectorize limits metadata size). *Decision: Maybe skip instructors in metadata for now due to cardinality/size limits.*

### 3.2 D1 FTS5
Ensure `courses_fts` includes `instructor_names` and `gened_names` to allow text matching if filters are relaxed.

---

## 4. Implementation Steps

1.  **Repo Restructure**: Move current code to `apps/api`.
2.  **Shared Packages**: Create `packages/query-types`.
3.  **Server Resolver**: Implement `resolveQuery` in `apps/api`.
4.  **Search Service**: Update `hybridSearch` to accept `SearchPlan`.
5.  **Client**: Initialize `apps/web` with `compromise`.

