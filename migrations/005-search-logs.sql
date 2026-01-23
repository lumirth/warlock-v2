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
