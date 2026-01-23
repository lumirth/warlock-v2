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
