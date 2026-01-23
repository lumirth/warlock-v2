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
