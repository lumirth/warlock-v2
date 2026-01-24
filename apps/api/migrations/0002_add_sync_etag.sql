-- Migration: Add etag to sync_state for change detection
ALTER TABLE sync_state ADD COLUMN etag TEXT;
