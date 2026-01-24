# Design: Contextual Course Scoring & Enrichment

## Problem
Currently, our search ranking relies on simple text matching or raw fields. We lack a unified "Quality" or "Difficulty" metric that combines the objective truth of GPA data with the subjective sentiment of RateMyProfessor (RMP) ratings.

Furthermore, a "Course" is an abstract entity; its quality depends entirely on *who* is teaching it this semester. Historical averages are misleading if the "good" professor isn't teaching.

## Solution: Composite Contextual Scores
We will calculate two dynamic scores for every course, based on the **weighted average of instructors teaching in the active term**.

### 1. The Scores

#### A. Composite Difficulty Score (0-100)
*   **Goal**: Represent how "hard" the class is to get a good grade/pass.
*   **Scale**: 0 (Free A) to 100 (Impossible).
*   **Formula**:
    *   **50%** from **GPA**: (Normalized: 4.0 GPA -> 0 Diff, 2.0 GPA -> 100 Diff).
    *   **50%** from **RMP Difficulty**: (Normalized: 1.0 -> 0 Diff, 5.0 -> 100 Diff).

#### B. Composite Quality Score (0-100)
*   **Goal**: Represent the overall "desirability" of the course section.
*   **Scale**: 0 (Avoid) to 100 (Must Take).
*   **Formula**:
    *   **70%** from **RMP Rating**: (Normalized: 1.0 -> 0 Qual, 5.0 -> 100 Qual).
    *   **30%** from **GPA**: (Normalized: 2.0 -> 0 Qual, 4.0 -> 100 Qual).
    *   *Philosophy*: "Easy but terrible" is a valid strategy, so high GPA boosts Quality slightly.

### 2. The Logic (Robustness)

#### Weighting by Section
If Prof A teaches 1 section (30 students) and Prof B teaches 4 sections (120 students), the course score is:
`Score = (ScoreA * 0.2) + (ScoreB * 0.8)`

#### Bayesian Smoothing (Small Sample Correction)
For RMP data, we trust it less if `num_ratings` is low.
*   We add **5 "dummy" ratings** of the global average (3.0) to every professor's count.
*   This pulls extreme outliers (e.g., one 1.0 rating) back toward the mean.

#### The "Cold Start" Fallback
If an instructor has **NO data** (New hire):
*   Fallback Level 1: Use the **Course's Historical Average** (from `gpa_stats` for all instructors).
*   Fallback Level 2: If course is new, use the **Department Average**.

### 3. Implementation Plan

1.  **Constants**: Define weights in `scoring-constants.ts` (Single Source of Truth).
2.  **Enrichment Service**:
    *   Fetch active term sections.
    *   Group by Course.
    *   Calculate Composite Scores.
    *   Update `courses` table (`computed_quality_score`, `computed_difficulty_score`).
3.  **Search Integration**:
    *   Update `search.ts` to use these columns for `sort: 'quality'` or `filter: 'easy'`.

### 4. Schema Updates
We need to add these columns to the `courses` table if they aren't fully supported yet (we have `quality_score` but will rename/clarify to `computed_*` for clarity or reuse existing).

*For this iteration, we will reuse the existing `quality_score` and `difficulty_score` columns in D1 to avoid schema migrations if possible, but document their new definition.*
