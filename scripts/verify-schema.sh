#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/apps/api/src/db/schema.sql"
MIGRATIONS="$ROOT/apps/api/migrations"
DB="$(mktemp "${TMPDIR:-/tmp}/uiuc-course-migrations.XXXXXX.sqlite")"
SCHEMA_DB="$(mktemp "${TMPDIR:-/tmp}/uiuc-course-schema.XXXXXX.sqlite")"
UPGRADE_DB="$(mktemp "${TMPDIR:-/tmp}/uiuc-course-upgrade.XXXXXX.sqlite")"
trap 'rm -f "$DB" "$SCHEMA_DB" "$UPGRADE_DB"' EXIT

for migration in "$MIGRATIONS"/*.sql; do
  sqlite3 "$DB" < "$migration"
done
sqlite3 "$SCHEMA_DB" < "$SCHEMA"

schema_fingerprint() {
  sqlite3 -separator '|' "$1" "
    SELECT
      type,
      name,
      tbl_name,
      replace(replace(replace(COALESCE(sql, ''), char(10), ' '), char(13), ' '), char(9), ' ')
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name;
  " | sed 's/"//g; s/[[:space:]][[:space:]]*/ /g'
}

if ! diff -u <(schema_fingerprint "$DB") <(schema_fingerprint "$SCHEMA_DB"); then
  echo "Migration chain and current-state bootstrap do not converge" >&2
  exit 1
fi

sqlite3 "$UPGRADE_DB" < "$MIGRATIONS/0001_initial_schema.sql"
sqlite3 "$UPGRADE_DB" "
  INSERT INTO courses (id, subject, number, title, year, term)
  VALUES ('TEST-100-2026-fall', 'TEST', '100', 'Migration Test', 2026, 'fall');
  INSERT INTO course_gened (course_id, category_id, category_name, attribute_code)
  VALUES ('TEST-100-2026-fall', 'HUM', 'Humanities', NULL);
  INSERT INTO course_gened (course_id, category_id, category_name, attribute_code)
  VALUES ('TEST-100-2026-fall', 'HUM', 'Humanities', NULL);
"
sqlite3 "$UPGRADE_DB" < "$MIGRATIONS/0002_course_gened_key.sql"
deduplicated_rows="$(sqlite3 "$UPGRADE_DB" "SELECT COUNT(*) FROM course_gened WHERE course_id = 'TEST-100-2026-fall';")"
if [[ "$deduplicated_rows" != "1" ]]; then
  echo "course_gened migration did not deduplicate nullable legacy keys" >&2
  exit 1
fi

expect_object() {
  local db="$1"
  local name="$2"
  local count
  count="$(sqlite3 "$db" "SELECT COUNT(*) FROM sqlite_master WHERE name = '$name';")"
  if [[ "$count" != "1" ]]; then
    echo "Missing schema object: $name" >&2
    exit 1
  fi
}

expect_column() {
  local db="$1"
  local table="$2"
  local column="$3"
  local count
  count="$(sqlite3 "$db" "SELECT COUNT(*) FROM pragma_table_info('$table') WHERE name = '$column';")"
  if [[ "$count" != "1" ]]; then
    echo "Missing column: $table.$column" >&2
    exit 1
  fi
}

for database in "$DB" "$SCHEMA_DB"; do
  for object in \
    app_meta courses subjects instructors sections meetings meeting_instructors \
    course_gened gpa_source_rows gpa_stats rmp_cache instructor_course_links \
    sync_state subject_sync_state term_state feedback_events courses_fts sections_fts; do
    expect_object "$database" "$object"
  done

  for column in cursor etag; do
    expect_column "$database" sync_state "$column"
  done
  for column in term_id subject status courses_synced sections_synced error; do
    expect_column "$database" subject_sync_state "$column"
  done
  for column in id term_id crn course_id; do
    expect_column "$database" sections "$column"
  done
  expect_column "$database" meetings section_id
  expect_column "$database" rmp_cache rmp_id
  expect_column "$database" feedback_events kind
  expect_column "$database" feedback_events issue
  expect_column "$database" feedback_events page

  schema_version="$(sqlite3 "$database" "SELECT value FROM app_meta WHERE key = 'schema_version';")"
  if [[ "$schema_version" != "0002_course_gened_key" ]]; then
    echo "Unexpected schema_version: $schema_version" >&2
    exit 1
  fi

  nullable_attribute_code="$(sqlite3 "$database" "SELECT \"notnull\" FROM pragma_table_info('course_gened') WHERE name = 'attribute_code';")"
  if [[ "$nullable_attribute_code" != "1" ]]; then
    echo "course_gened.attribute_code must be NOT NULL" >&2
    exit 1
  fi
done

echo "Schema migrations and bootstrap verified: $schema_version"
