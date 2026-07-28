-- Fence subject snapshot publication with a unique lease owner. A stale
-- Worker can no longer publish or overwrite status after a TTL/forced takeover.
ALTER TABLE subject_sync_state ADD COLUMN owner_token TEXT;

CREATE UNIQUE INDEX idx_subject_sync_state_owner
ON subject_sync_state(term_id, subject, owner_token);

-- Publication code inserts and removes a guard row inside each D1 batch. The
-- foreign key aborts the whole batch if its owner token is no longer current.
CREATE TABLE subject_sync_publication_fences (
    term_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    owner_token TEXT NOT NULL,
    PRIMARY KEY (term_id, subject, owner_token),
    FOREIGN KEY (term_id, subject, owner_token)
      REFERENCES subject_sync_state(term_id, subject, owner_token)
      ON UPDATE CASCADE
      ON DELETE CASCADE
);

INSERT OR REPLACE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '0004_subject_sync_fencing', unixepoch());
