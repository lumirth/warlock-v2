# UIUC Course Search Engine - Design Document

**Date:** 2026-01-19
**Status:** Ready for Implementation
**Cost:** $0/month (Cloudflare Free Tier)

---

## Executive Summary

A natural language course search engine for UIUC that combines:
- **Hybrid search** (semantic + keyword) via Cloudflare Vectorize + D1 FTS5
- **Natural language parsing** via Compromise.js
- **Live enrollment data** via CISAPI polling
- **Enrichment data** from GPA statistics and RateMyProfessor

Users can search with queries like:
- "easy cs courses with good professors, no mornings"
- "3-credit humanities gen ed"
- "400-level math, open sections"

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Search: [easy cs courses with good professors, no mornings    ] [🔍] │ │
│  │                                                                        │ │
│  │  Understood: ✓ Easy (high GPA)  ✓ CS  ✓ Good professor  ✓ No mornings │ │
│  │                                                                        │ │
│  │  Filters: [Difficulty ▼] [Time ▼] [Credits ▼] [GenEd ▼] [Status ▼]   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE EDGE (FREE TIER)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Cloudflare      │    │ Workers         │    │ Queues          │         │
│  │ Pages           │    │ (API)           │    │ (Background)    │         │
│  │                 │    │                 │    │                 │         │
│  │ Static frontend │    │ Search handler  │    │ CISAPI sync     │         │
│  │ Compromise.js   │    │ Course detail   │    │ GPA sync        │         │
│  │ FlexSearch      │    │ RRF fusion      │    │ RMP sync        │         │
│  └─────────────────┘    └────────┬────────┘    └─────────────────┘         │
│                                  │                                          │
│         ┌────────────────────────┼────────────────────────┐                │
│         │                        │                        │                │
│         ▼                        ▼                        ▼                │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Workers AI      │    │ Vectorize       │    │ D1 (SQLite)     │         │
│  │                 │    │                 │    │                 │         │
│  │ bge-small-en    │    │ Semantic index  │    │ Courses, GPA    │         │
│  │ Query embedding │    │ 384 dimensions  │    │ RMP, Sections   │         │
│  │ FREE tier       │    │ FREE tier       │    │ FTS5 + Trigram  │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EXTERNAL DATA SOURCES                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ CISAPI          │    │ wadefagen/      │    │ RateMyProfessor │         │
│  │                 │    │ datasets        │    │                 │         │
│  │ Live course     │    │                 │    │ Professor       │         │
│  │ data + sections │    │ GPA history     │    │ ratings         │         │
│  │ Every 10 min    │    │ CSV (daily)     │    │ GraphQL (weekly)│         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Query Parser (Client-Side)

**Technology:** Compromise.js (~50KB)
**Location:** Browser
**Latency:** ~2ms

Parses natural language queries into structured filters:

```javascript
Input:  "easy cs courses with good professors, no mornings"

Output: {
  searchTerms: "courses",
  filters: {
    min_gpa: 3.5,           // "easy"
    subject: "CS",          // "cs"
    min_rmp: 4.0,           // "good professors"
    min_start_time: "12:00" // "no mornings"
  },
  understood: [
    { type: "difficulty", value: "easy" },
    { type: "subject", value: "CS" },
    { type: "quality", value: "good professor" },
    { type: "negated_time", value: "no morning" }
  ]
}
```

**Supported patterns:**

| Pattern | Example | Filter |
|---------|---------|--------|
| Difficulty | "easy", "chill", "hard", "rigorous" | min_gpa / max_gpa |
| Subject | "cs", "math", "physics" | subject |
| Quality | "good professor", "highly rated" | min_rmp |
| Time (positive) | "morning", "afternoon", "evening" | start_time range |
| Time (negated) | "no mornings", "avoid 8am" | min_start_time |
| Credits | "3-credit", "4 hours" | credits |
| Level | "400-level", "intro", "upper level" | number range |
| GenEd | "humanities", "quant", "science" | gened |
| Status | "open", "available" | status |
| Format | "online", "in-person" | format |
| Course code | "CS 225", "MATH 241" | subject + number |

---

### 2. Hybrid Search (Server-Side)

**Location:** Cloudflare Worker
**Latency:** ~50-100ms

Combines semantic and keyword search using Reciprocal Rank Fusion (RRF).

```
┌─────────────────────────────────────────────────────────────────┐
│                     HYBRID SEARCH FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Query: "machine learning courses"                              │
│  Filters: { min_gpa: 3.5, status: "Open" }                      │
│         │                                                        │
│         ├──────────────────────┬─────────────────────────────┐  │
│         │                      │                             │  │
│         ▼                      ▼                             │  │
│  ┌─────────────────┐    ┌─────────────────┐                 │  │
│  │ SEMANTIC PATH   │    │ KEYWORD PATH    │                 │  │
│  │                 │    │                 │                 │  │
│  │ 1. Embed query  │    │ 1. FTS5 search  │                 │  │
│  │    (Workers AI) │    │    (D1)         │                 │  │
│  │ 2. Vector search│    │ 2. Apply filters│                 │  │
│  │    (Vectorize)  │    │ 3. BM25 ranking │                 │  │
│  │ 3. Top 50       │    │ 4. Top 50       │                 │  │
│  └────────┬────────┘    └────────┬────────┘                 │  │
│           │                      │                           │  │
│           └──────────┬───────────┘                           │  │
│                      ▼                                        │  │
│               ┌─────────────────┐                            │  │
│               │   RRF FUSION    │                            │  │
│               │                 │                            │  │
│               │ score(d) = Σ    │                            │  │
│               │   1/(k + rank)  │                            │  │
│               │                 │                            │  │
│               │ k = 60          │                            │  │
│               └────────┬────────┘                            │  │
│                        │                                      │  │
│                        ▼                                      │  │
│                 Top 20 results                               │  │
│                                                               │  │
└─────────────────────────────────────────────────────────────────┘
```

**Why hybrid beats single approach:**

| Query Type | Semantic Only | Keyword Only | Hybrid |
|------------|---------------|--------------|--------|
| "CS 225" | ❌ Noise | ✅ Exact | ✅ Exact |
| "machine learning" | ✅ Finds AI courses | ⚠️ Misses "AI" | ✅ Best of both |
| "coding for beginners" | ✅ Finds intro CS | ❌ Misses | ✅ Best of both |
| "PHYS 211" | ❌ Noise | ✅ Exact | ✅ Exact |

---

### 3. Data Storage (D1)

**Technology:** Cloudflare D1 (SQLite)
**Free Tier:** 5GB storage, 5M reads/day, 100K writes/day

#### Schema

```sql
-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE courses (
    id TEXT PRIMARY KEY,              -- "CS-225-2025-fall"
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    credit_hours INTEGER,
    gened TEXT,                       -- "QR", "HUM", etc.
    year INTEGER NOT NULL,
    term TEXT NOT NULL,

    -- Enrichment (joined from cache tables)
    avg_gpa REAL,
    gpa_sample_size INTEGER,
    primary_instructor TEXT,
    primary_instructor_rmp REAL,

    -- Computed scores
    difficulty_score REAL,            -- 1-5, inverse of GPA
    quality_score REAL,               -- Blend of ratings

    -- Sync metadata
    last_synced INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),

    UNIQUE(subject, number, year, term)
);

CREATE TABLE sections (
    crn TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    section_number TEXT,

    -- Status (updated every 10 min, from CISAPI enrollmentStatus)
    status TEXT,                      -- "Open", "Closed", "Restricted", "Unknown"
    -- Note: CISAPI returns status text only, not seat counts

    -- Schedule
    type TEXT,                        -- "Lecture", "Discussion", "Lab"
    days TEXT,                        -- "MWF", "TR"
    start_time TEXT,                  -- "09:00"
    end_time TEXT,                    -- "09:50"
    location TEXT,

    -- Instructor
    instructor TEXT,
    instructor_rmp REAL,
    instructor_gpa REAL,

    -- Final exam
    final_exam_date TEXT,
    final_exam_time TEXT,
    final_exam_location TEXT,

    last_synced INTEGER,

    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE TABLE gpa_stats (
    id INTEGER PRIMARY KEY,
    subject TEXT NOT NULL,
    number TEXT NOT NULL,
    instructor TEXT,                  -- NULL = course average

    avg_gpa REAL,
    median_gpa REAL,
    sample_size INTEGER,

    -- Grade distribution
    a_plus_pct REAL, a_pct REAL, a_minus_pct REAL,
    b_plus_pct REAL, b_pct REAL, b_minus_pct REAL,
    c_plus_pct REAL, c_pct REAL, c_minus_pct REAL,
    d_plus_pct REAL, d_pct REAL, d_minus_pct REAL,
    f_pct REAL, w_pct REAL,

    last_updated INTEGER,

    UNIQUE(subject, number, instructor)
);

CREATE TABLE rmp_cache (
    id INTEGER PRIMARY KEY,
    instructor_name TEXT UNIQUE NOT NULL,

    rmp_id TEXT,
    rating REAL,
    difficulty REAL,
    would_take_again_pct REAL,
    num_ratings INTEGER,
    department TEXT,
    top_tags TEXT,                    -- JSON array

    fetched_at INTEGER,
    expires_at INTEGER
);

CREATE TABLE user_ratings (
    id INTEGER PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    user_id TEXT NOT NULL,

    overall_rating INTEGER CHECK(overall_rating BETWEEN 1 AND 5),
    difficulty_rating INTEGER CHECK(difficulty_rating BETWEEN 1 AND 5),
    workload_hours INTEGER,
    comment TEXT,

    created_at INTEGER DEFAULT (unixepoch()),

    UNIQUE(course_id, user_id)
);

-- ============================================================
-- FULL-TEXT SEARCH (Trigram for fuzzy matching)
-- ============================================================

CREATE VIRTUAL TABLE courses_fts USING fts5(
    subject,
    number,
    title,
    description,
    primary_instructor,
    gened,
    content='courses',
    content_rowid='rowid',
    tokenize='trigram'
);

-- Auto-sync triggers
CREATE TRIGGER courses_fts_insert AFTER INSERT ON courses BEGIN
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor, gened)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor, new.gened);
END;

CREATE TRIGGER courses_fts_delete AFTER DELETE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor, gened)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor, old.gened);
END;

CREATE TRIGGER courses_fts_update AFTER UPDATE ON courses BEGIN
    INSERT INTO courses_fts(courses_fts, rowid, subject, number, title, description, primary_instructor, gened)
    VALUES('delete', old.rowid, old.subject, old.number, old.title, old.description, old.primary_instructor, old.gened);
    INSERT INTO courses_fts(rowid, subject, number, title, description, primary_instructor, gened)
    VALUES (new.rowid, new.subject, new.number, new.title, new.description, new.primary_instructor, new.gened);
END;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_courses_subject ON courses(subject);
CREATE INDEX idx_courses_term ON courses(year, term);
CREATE INDEX idx_courses_gpa ON courses(avg_gpa);
CREATE INDEX idx_sections_course ON sections(course_id);
CREATE INDEX idx_sections_status ON sections(status);
CREATE INDEX idx_sections_instructor ON sections(instructor);
CREATE INDEX idx_sections_time ON sections(start_time);
CREATE INDEX idx_gpa_course ON gpa_stats(subject, number);
CREATE INDEX idx_rmp_expires ON rmp_cache(expires_at);
```

---

### 4. Data Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA SYNC ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  CRON: Every 10 minutes                                                      │
│  ───────────────────────                                                     │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Enrollment Sync (via Cloudflare Queues)                               │ │
│  │                                                                        │ │
│  │  1. Cron Worker fetches subject list from /ajax/subject/auto          │ │
│  │  2. Discovers valid sessionIds from /schedule/sessions/{year}/{term}  │ │
│  │  3. Sends 200 messages to COURSE_SYNC_QUEUE (one per subject)         │ │
│  │  4. Queue consumers process in parallel:                              │ │
│  │     - Fetch CISAPI ?mode=cascade for subject                          │ │
│  │     - Parse XML                                                        │ │
│  │     - Apply client-side filters (time/location/days)                  │ │
│  │     - Upsert courses + sections to D1                                 │ │
│  │  5. Full sync completes in ~30 seconds                                │ │
│  │                                                                        │ │
│  │  Free tier: 1M queue ops/month (we use ~864K)                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  CRON: Daily (3 AM)                                                          │
│  ──────────────────                                                          │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  GPA Data Sync                                                         │ │
│  │                                                                        │ │
│  │  1. Check GitHub API for wadefagen/datasets last commit                │ │
│  │  2. If changed since last sync:                                        │ │
│  │     - Fetch CSV from GitHub raw                                        │ │
│  │     - Parse and compute course averages                                │ │
│  │     - Batch upsert to gpa_stats                                        │ │
│  │     - Update courses.avg_gpa via JOIN                                  │ │
│  │                                                                        │ │
│  │  Source: github.com/wadefagen/datasets/gpa/uiuc-gpa-dataset.csv       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  CRON: Weekly (Sunday 2 AM)                                                  │
│  ─────────────────────────                                                   │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  RMP Ratings Sync                                                      │ │
│  │                                                                        │ │
│  │  1. Get unique instructor names from D1                                │ │
│  │  2. Send batch to RMP_SYNC_QUEUE                                       │ │
│  │  3. Queue consumers query RMP GraphQL                                  │ │
│  │  4. Upsert to rmp_cache with 7-day TTL                                 │ │
│  │  5. Update sections.instructor_rmp                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  CRON: Daily (during semester)                                               │
│  ─────────────────────────────                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  Final Exams Sync                                                      │ │
│  │                                                                        │ │
│  │  Source: Frontend /ajax/finalexams/{year}/{term}/{subj}/{num}         │ │
│  │  Store in sections table                                               │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Live Course View

When a user views a specific course, section data is fetched live from CISAPI:

```
┌─────────────────────────────────────────────────────────────────┐
│                     COURSE DETAIL VIEW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User views /course/CS/225                                      │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  PARALLEL FETCH                                          │   │
│  │                                                           │   │
│  │  ┌───────────────────┐    ┌───────────────────┐         │   │
│  │  │  D1 (cached)      │    │  CISAPI (live)    │         │   │
│  │  │                   │    │                   │         │   │
│  │  │  • Title, desc    │    │  • Section status │         │   │
│  │  │  • GPA stats      │    │  • Enrollment #s  │         │   │
│  │  │  • RMP ratings    │    │  • Instructors    │         │   │
│  │  │  • GenEd          │    │  • Meeting times  │         │   │
│  │  │                   │    │                   │         │   │
│  │  │  (rarely changes) │    │  (changes often)  │         │   │
│  │  └─────────┬─────────┘    └─────────┬─────────┘         │   │
│  │            │                        │                    │   │
│  │            └───────────┬────────────┘                    │   │
│  │                        ▼                                  │   │
│  │                  MERGE & RETURN                          │   │
│  │                                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Result:                                                        │
│  • Course metadata from D1 (fast, enriched)                    │
│  • Sections ALWAYS from CISAPI (live, authoritative)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### 6. Client-Side Faceting

After receiving search results, the browser uses FlexSearch for instant filtering:

```javascript
// Load results from API
const results = await fetch('/api/search?q=cs+courses&min_gpa=3.5');
const courses = await results.json();

// Initialize client-side index
const index = new FlexSearch.Document({
  document: {
    id: 'id',
    index: ['title', 'description', 'instructor'],
    store: true
  }
});

// Add results
courses.forEach(course => index.add(course));

// Instant client-side filtering (no network)
function filterByCredit(credits) {
  return Object.values(index.store).filter(c => c.credit_hours === credits);
}

function filterByTime(maxStart) {
  return Object.values(index.store).filter(c =>
    c.sections.some(s => s.start_time <= maxStart)
  );
}

// Instant facet counts
function getFacets() {
  const all = Object.values(index.store);
  return {
    credits: groupBy(all, 'credit_hours'),
    gened: groupBy(all, 'gened'),
    status: groupBy(all, s => s.sections.some(sec => sec.status === 'Open') ? 'Open' : 'Closed')
  };
}
```

---

## API Endpoints

### Search

```
GET /api/search?q={query}&{filters}

Query Parameters:
  q                 Search query (natural language or keywords)
  subject           Subject code filter (CS, MATH, etc.)
  min_gpa           Minimum average GPA
  max_gpa           Maximum average GPA
  min_rmp           Minimum RMP rating
  credits           Credit hours
  gened             GenEd category (HUM, QR, NAT, etc.)
  min_start_time    Earliest start time (HH:MM) [client-side filter]
  max_start_time    Latest start time (HH:MM) [client-side filter]
  days              Days filter (MWF, TR, etc.) [client-side filter]
  status            Enrollment status (Open, Closed)
  format            Format (online, inperson)
  limit             Max results (default 50)

Response:
{
  "results": [...],
  "parsed": {
    "searchTerms": "...",
    "filters": {...},
    "understood": [...]
  },
  "meta": {
    "total": 150,
    "semantic_count": 50,
    "keyword_count": 50
  }
}
```

### Course Detail

```
GET /api/course/{subject}/{number}

Response:
{
  "id": "CS-225-2025-fall",
  "subject": "CS",
  "number": "225",
  "title": "Data Structures",
  "description": "...",
  "credit_hours": 4,
  "gened": null,
  "avg_gpa": 3.2,
  "gpa_sample_size": 1500,

  // Sections are ALWAYS live from CISAPI
  "sections": [
    {
      "crn": "74481",
      "section_number": "AL1",
      "status": "Open",
      "enrollment_current": 150,
      "enrollment_max": 200,
      "instructor": "Challen, G",
      "instructor_rmp": 4.5,
      "days": "MWF",
      "start_time": "10:00",
      "end_time": "10:50",
      "location": "Siebel 1404"
    }
  ],

  "_meta": {
    "course_data": "cached",
    "section_data": "live",
    "fetched_at": "2026-01-19T15:30:00Z"
  }
}
```

---

## Cost Analysis

### Cloudflare Free Tier Limits vs Usage

| Resource | Free Limit | Our Usage | Utilization |
|----------|------------|-----------|-------------|
| **Workers Requests** | 100K/day | ~30K/day (with caching) | 30% |
| **D1 Reads** | 5M/day | ~50K searches × 1 query | 1% |
| **D1 Storage** | 5GB | ~100MB (courses + indexes) | 2% |
| **Vectorize Stored** | 5M dims | ~4K courses × 384 = 1.5M (3 terms) | 30% |
| **Vectorize Queried** | 30M dims/mo | 2.6K queries/day × 384 × 30 | ~100% |
| **Workers AI** | 10K neurons/day | ~5K queries/day | 50% |
| **Queues** | 1M ops/month | 864K (10-min sync) | 86% |
| **KV** | 100K reads/day | Cache hits | Fine |

### Total Monthly Cost: $0

---

## Deployment

### wrangler.toml

```toml
name = "uiuc-course-search"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "course-search"
database_id = "xxxxx"

# Vectorize
[[vectorize]]
binding = "VECTORIZE"
index_name = "courses"

# Queues
[[queues.producers]]
binding = "COURSE_SYNC_QUEUE"
queue = "course-sync"

[[queues.producers]]
binding = "RMP_SYNC_QUEUE"
queue = "rmp-sync"

[[queues.consumers]]
queue = "course-sync"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3

[[queues.consumers]]
queue = "rmp-sync"
max_batch_size = 5
max_batch_timeout = 60
max_retries = 3

# KV (caching)
[[kv_namespaces]]
binding = "CACHE"
id = "xxxxx"

# Scheduled Triggers
[triggers]
crons = [
    "*/10 * * * *",    # Every 10 minutes: enrollment sync
    "0 3 * * *",       # Daily 3 AM: GPA sync
    "0 2 * * 0"        # Weekly Sunday 2 AM: RMP sync
]

# Environment Variables
[vars]
CURRENT_YEAR = "2025"
CURRENT_TERM = "fall"
CISAPI_BASE = "https://courses.illinois.edu/cisapp/explorer"
FRONTEND_BASE = "https://courses.illinois.edu"
GPA_DATASET_URL = "https://raw.githubusercontent.com/wadefagen/datasets/main/gpa/uiuc-gpa-dataset.csv"
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Set up D1 database with schema
- [ ] Create Vectorize index
- [ ] Set up Queues for background sync
- [ ] Implement CISAPI sync Worker
- [ ] Test with single subject

### Phase 2: Search Implementation (Week 2)
- [ ] Implement D1 FTS5 keyword search
- [ ] Implement Vectorize semantic search
- [ ] Implement RRF fusion
- [ ] Create search API endpoint
- [ ] Test hybrid search quality

### Phase 3: Query Parser (Week 3)
- [ ] Integrate Compromise.js
- [ ] Implement modifier detection
- [ ] Handle negations
- [ ] Visual feedback for understood terms
- [ ] Test with natural language queries

### Phase 4: Data Enrichment (Week 4)
- [ ] GPA sync from wadefagen/datasets
- [ ] RMP sync via GraphQL
- [ ] Final exams sync
- [ ] Compute difficulty/quality scores

### Phase 5: Frontend (Week 5)
- [ ] Build search UI
- [ ] Implement filter controls
- [ ] Client-side FlexSearch faceting
- [ ] Course detail pages
- [ ] Real-time status indicators

### Phase 6: Polish & Launch (Week 6)
- [ ] Performance optimization
- [ ] Error handling
- [ ] Monitoring/logging
- [ ] Documentation
- [ ] Deploy to production

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Search latency (p50) | < 100ms |
| Search latency (p95) | < 200ms |
| Query understanding accuracy | > 90% |
| Data freshness (enrollment) | < 10 min |
| Uptime | > 99.9% |
| Monthly cost | $0 |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Vectorize free tier limit | Index only 3 most recent terms (~4K courses) |
| CISAPI rate limiting | Unlikely (none observed), but implement backoff |
| RMP blocks scraping | Cache aggressively, respect rate limits |
| D1 query performance | Index optimization, query caching |
| Workers CPU limit (10ms) | All heavy work is I/O (D1/Vectorize queries don't count) |

---

## Future Enhancements

1. **User accounts** - Save favorite courses, personalized recommendations
2. **Schedule builder** - Drag-and-drop course scheduling
3. **Notifications** - Alert when section opens
4. **Mobile app** - React Native or PWA
5. **Professor comparisons** - Side-by-side instructor comparison
6. **Prerequisite checker** - Validate course eligibility
7. **Degree audit integration** - Track progress toward graduation

---

**Document prepared by:** Claude (AI Assistant)
**Last updated:** 2026-01-19
