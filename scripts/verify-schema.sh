#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/apps/api/src/db/schema.sql"
BASELINE="$ROOT/apps/api/migrations/0001_initial_schema.sql"
DB="$(mktemp "${TMPDIR:-/tmp}/uiuc-course-schema.XXXXXX.sqlite")"
trap 'rm -f "$DB"' EXIT

diff -u "$BASELINE" "$SCHEMA" >/dev/null
sqlite3 "$DB" < "$BASELINE"

expect_object() {
  local name="$1"
  local count
  count="$(sqlite3 "$DB" "SELECT COUNT(*) FROM sqlite_master WHERE name = '$name';")"
  if [[ "$count" != "1" ]]; then
    echo "Missing schema object: $name" >&2
    exit 1
  fi
}

expect_column() {
  local table="$1"
  local column="$2"
  local count
  count="$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('$table') WHERE name = '$column';")"
  if [[ "$count" != "1" ]]; then
    echo "Missing column: $table.$column" >&2
    exit 1
  fi
}

for object in \
  app_meta \
  courses \
  subjects \
  subject_aliases \
  instructors \
  sections \
  meetings \
  meeting_instructors \
  course_gened \
  gpa_stats \
  rmp_cache \
  instructor_course_links \
  sync_state \
  term_state \
  feedback_events \
  gened_aliases \
  topic_aliases \
  courses_fts \
  sections_fts; do
  expect_object "$object"
done

for column in cursor etag; do
  expect_column sync_state "$column"
done

for column in id term_id crn course_id; do
  expect_column sections "$column"
done

expect_column meetings section_id
expect_column rmp_cache rmp_id
expect_column feedback_events kind
expect_column feedback_events issue
expect_column feedback_events page

schema_version="$(sqlite3 "$DB" "SELECT value FROM app_meta WHERE key = 'schema_version';")"
if [[ "$schema_version" != "0001_initial_schema" ]]; then
  echo "Unexpected schema_version: $schema_version" >&2
  exit 1
fi

echo "Schema bootstrap verified: $schema_version"
