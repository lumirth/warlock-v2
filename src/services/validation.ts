import type { TermSyncResult } from './parallel-sync.js';

export function validateSyncResult(result: TermSyncResult): string[] {
  const warnings: string[] = [];

  // Critical: Courses synced but 0 sections indicates parser bug
  if (result.totalCourses > 0 && result.totalSections === 0) {
    warnings.push('CRITICAL: Courses synced but 0 sections — parser bug?');
  }

  // Warning: Too few courses for spring/fall (should have 4000+)
  const isMainTerm = result.term === 'spring' || result.term === 'fall';
  if (isMainTerm && result.totalCourses > 0 && result.totalCourses < 1000) {
    warnings.push(`WARNING: Only ${result.totalCourses} courses — expected 4000+`);
  }

  // Warning: High subject failure rate
  const totalSubjects = result.successfulSubjects + result.failedSubjects;
  if (totalSubjects > 0) {
    const failRate = result.failedSubjects / totalSubjects;
    if (failRate > 0.1) {
      warnings.push(`WARNING: ${(failRate * 100).toFixed(0)}% of subjects failed`);
    }
  }

  return warnings;
}
