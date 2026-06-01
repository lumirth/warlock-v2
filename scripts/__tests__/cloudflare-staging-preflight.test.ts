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
database_id = "3f1e2d4c-5b6a-4789-9abc-def012345678"

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

  it('rejects placeholder-looking staging resource ids', () => {
    const fakeConfig = VALID_STAGING_CONFIG
      .replace('3f1e2d4c-5b6a-4789-9abc-def012345678', '11111111-1111-1111-1111-111111111111')
      .replace('abcdefabcdefabcdefabcdefabcdefab', 'replace-with-staging-kv-id');

    const results = checkStagingConfigText(fakeConfig);
    expect(results.find(result => result.name === 'staging D1 id')?.ok).toBe(false);
    expect(results.find(result => result.name === 'staging KV id')?.ok).toBe(false);
  });

  it('requires all staging smoke checks to pass', () => {
    const smokeResults = [
      'health',
      'search public route',
      'course public route',
      'admin rejects missing token',
      'admin accepts staging token',
      'admin sync status accepts staging token',
      'internal rejects missing token',
      'internal accepts staging token',
    ].map(name => ({ name, ok: true }));

    expect(checkSmokeResultsText(JSON.stringify(smokeResults)).ok).toBe(true);
    expect(checkSmokeResultsText(JSON.stringify(smokeResults.slice(0, -1))).ok).toBe(false);
  });

  it('requires concrete staging, WAF, and D1 restore evidence', () => {
    const validEvidence = [
      'Staging API URL: https://uiuc-course-search-staging.lu-uiuc.workers.dev',
      'WAF Rule ID: 3f1e2d4c-5b6a-4789-9abc-def012345678',
      'Abuse Control Routes: /api/search*, /api/course/*',
      'Abuse Control Action: managed_challenge',
      'Abuse Control Thresholds: /api/search*=60/min/IP, /api/course/*=120/min/IP',
      'D1 Backup Ref: 20260601T170000Z',
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-20260601T170000Z.sql',
      'D1 Restore Database: course-search-db-staging-restore-20260601T170000Z',
      'D1 Restore Verified: yes',
    ].join('\n');

    expect(checkEvidenceReportText(validEvidence).every(result => result.ok)).toBe(true);

    const placeholderEvidence = 'Staging API URL: https://<staging-worker-host>';
    expect(checkEvidenceReportText(placeholderEvidence).some(result => !result.ok)).toBe(true);

    const weakRuleEvidence = validEvidence.replace(
      'WAF Rule ID: 3f1e2d4c-5b6a-4789-9abc-def012345678',
      'WAF Rule ID: rule_123'
    );
    expect(checkEvidenceReportText(weakRuleEvidence).find(result => result.name === 'WAF or rate-limit rule evidence')?.ok).toBe(false);

    const missingBackupLocation = validEvidence.replace(
      'D1 Backup Location: artifacts/d1-backups/course-search-db-staging-20260601T170000Z.sql',
      ''
    );
    expect(checkEvidenceReportText(missingBackupLocation).find(result => result.name === 'D1 backup location evidence')?.ok).toBe(false);

    const missingRouteCoverage = validEvidence.replace(
      'Abuse Control Routes: /api/search*, /api/course/*',
      'Abuse Control Routes: /api/search*'
    );
    expect(checkEvidenceReportText(missingRouteCoverage).find(result => result.name === 'WAF or rate-limit route coverage evidence')?.ok).toBe(false);

    const weakAction = validEvidence.replace(
      'Abuse Control Action: managed_challenge',
      'Abuse Control Action: log'
    );
    expect(checkEvidenceReportText(weakAction).find(result => result.name === 'WAF or rate-limit action evidence')?.ok).toBe(false);

    const weakThresholds = validEvidence.replace(
      'Abuse Control Thresholds: /api/search*=60/min/IP, /api/course/*=120/min/IP',
      'Abuse Control Thresholds: /api/search*=60/min/IP'
    );
    expect(checkEvidenceReportText(weakThresholds).find(result => result.name === 'WAF or rate-limit threshold evidence')?.ok).toBe(false);
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
