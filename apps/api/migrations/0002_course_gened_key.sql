CREATE TABLE course_gened_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    category_name TEXT,
    attribute_code TEXT NOT NULL DEFAULT '',
    attribute_name TEXT,
    UNIQUE(course_id, category_id, attribute_code),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

INSERT INTO course_gened_v2 (
    course_id,
    category_id,
    category_name,
    attribute_code,
    attribute_name
)
SELECT
    course_id,
    category_id,
    MAX(category_name),
    COALESCE(attribute_code, ''),
    MAX(attribute_name)
FROM course_gened
GROUP BY course_id, category_id, COALESCE(attribute_code, '');

DROP TABLE course_gened;
ALTER TABLE course_gened_v2 RENAME TO course_gened;
CREATE INDEX idx_course_gened_course ON course_gened(course_id);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '0002_course_gened_key', unixepoch());
