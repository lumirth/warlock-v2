-- Migration: Add cursor to sync_state for resumable syncs
ALTER TABLE sync_state ADD COLUMN cursor INTEGER DEFAULT 0;
