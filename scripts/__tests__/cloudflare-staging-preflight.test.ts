import { describe, expect, it } from 'vitest';
import {
  checkEvidenceReportText,
  checkRequiredEnv,
  checkSmokeResultsText,
  checkStagingConfigText,
} from '../cloudflare-staging-preflight.js';

const VALID_STAGING_CONFIG = `
[env.staging]
name = "uiuc-course-search-staging"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "course-search-db-staging"
database_id = "11111111-2222-3333-4444-555555555555"

[[env.staging.kv_namespaces]]
binding = "GPA_CACHE"
id = "abcdefabcdefabcdefabcdefabcdefab"

[[env.staging.vectorize]]
binding = "VECTORIZE"
index_name = "course-embeddings-staging"

[env.staging.ai]
binding = "AI"

[[env.staging.services]]
binding = "SELF"
service = "uiuc-course-search-staging"
`;

describe('Cloudflare staging preflight', () => {
  it('accepts an explicit staging wrangler config', () => {
    const results = checkStagingConfigText(VALID_STAGING_CONFIG);
    expect(results.every(result => result.ok)).toBe(true);
  });

  it('rejects production-only wrangler config as staging evidence', () => {
    const results = checkStagingConfigText('name = "uiuc-course-search"');
    expect(results.some(result => !result.ok)).toBe(true);
    expect(results.find(result => result.name === 'wrangler env.staging block')?.ok).toBe(false);
  });

  it('requires all staging smoke checks to pass', () => {
    const smokeResults = [
      'health',
      'search public route',
      'course public route',
      'admin rejects missing token',
      'admin accepts staging token',
      'internal rejects missing token',
      'internal accepts staging token',
    ].map(name => ({ name, ok: true }));

    expect(checkSmokeResultsText(JSON.stringify(smokeResults)).ok).toBe(true);
    expect(checkSmokeResultsText(JSON.stringify(smokeResults.slice(0, -1))).ok).toBe(false);
  });

  it('requires concrete staging, WAF, and D1 restore evidence', () => {
    const validEvidence = [
      'Staging API URL: https://uiuc-course-search-staging.example.workers.dev',
      'WAF Rule ID: rule_123',
      'D1 Backup Ref: 20260601T170000Z',
      'D1 Restore Database: course-search-db-staging-restore-20260601T170000Z',
      'D1 Restore Verified: yes',
    ].join('\n');

    expect(checkEvidenceReportText(validEvidence).every(result => result.ok)).toBe(true);

    const placeholderEvidence = 'Staging API URL: https://<staging-worker-host>';
    expect(checkEvidenceReportText(placeholderEvidence).some(result => !result.ok)).toBe(true);
  });

  it('requires every staging environment variable by name', () => {
    const results = checkRequiredEnv({
      STAGING_API_BASE_URL: 'https://example.com',
      STAGING_ADMIN_TOKEN: 'redacted',
      STAGING_INTERNAL_TOKEN: 'redacted',
      EVAL_BASE_URL: 'https://example.com',
    });

    expect(results.every(result => result.ok)).toBe(true);
    expect(checkRequiredEnv({}).every(result => !result.ok)).toBe(true);
  });
});
