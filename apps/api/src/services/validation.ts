import type { TermSyncResult } from './parallel-sync.js';
import type { SubjectSnapshot } from '../transforms/course.js';

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

export function assertPublishableSubjectSnapshot(
  snapshot: SubjectSnapshot,
  expectedSubject?: string
): void {
  const errors: string[] = [];
  const subjectId = snapshot.subject.id.trim().toUpperCase();

  if (!subjectId) errors.push('subject ID is empty');
  if (expectedSubject && subjectId !== expectedSubject.trim().toUpperCase()) {
    errors.push(`subject ID ${subjectId || '(empty)'} does not match requested ${expectedSubject}`);
  }
  if (snapshot.termId !== `${snapshot.year}-${snapshot.term}`) {
    errors.push(`term ID ${snapshot.termId} does not match ${snapshot.year}-${snapshot.term}`);
  }
  if (snapshot.courses.length === 0) {
    errors.push('snapshot contains no courses');
  }

  const courseIds = new Set<string>();
  const sectionIds = new Set<string>();
  let sectionsCount = 0;
  for (const courseSnapshot of snapshot.courses) {
    const course = courseSnapshot.course;
    if (courseIds.has(course.id)) errors.push(`duplicate course ID ${course.id}`);
    courseIds.add(course.id);

    if (
      course.subject.trim().toUpperCase() !== subjectId
      || course.subject_id?.trim().toUpperCase() !== subjectId
    ) {
      errors.push(`course ${course.id} is assigned to a different subject`);
    }
    if (course.year !== snapshot.year || course.term !== snapshot.term) {
      errors.push(`course ${course.id} is assigned to a different term`);
    }

    for (const sectionSnapshot of courseSnapshot.sections) {
      const section = sectionSnapshot.section;
      sectionsCount += 1;
      if (sectionIds.has(section.id)) errors.push(`duplicate section ID ${section.id}`);
      sectionIds.add(section.id);
      if (section.course_id !== course.id) {
        errors.push(`section ${section.id} references a different course`);
      }
      if (section.term_id !== snapshot.termId) {
        errors.push(`section ${section.id} references a different term`);
      }
    }
  }

  if (snapshot.courses.length > 0 && sectionsCount === 0) {
    errors.push('snapshot contains courses but no sections');
  }

  if (errors.length > 0) {
    throw new Error(`Refusing to publish invalid ${subjectId || 'subject'} snapshot: ${errors.join('; ')}`);
  }
}

export function validateSyncBatchContract(
  value: unknown,
  expectation: { year: number; term: string; subjects: string[] }
): string[] {
  if (!isRecord(value)) return ['response is not an object'];

  const errors: string[] = [];
  const expectedTermId = `${expectation.year}-${expectation.term}`;
  if (value.termId !== expectedTermId) errors.push(`termId must be ${expectedTermId}`);
  if (value.year !== expectation.year) errors.push(`year must be ${expectation.year}`);
  if (value.term !== expectation.term) errors.push(`term must be ${expectation.term}`);
  if (!Array.isArray(value.subjectResults)) return [...errors, 'subjectResults must be an array'];

  const expectedSubjects = new Set(expectation.subjects);
  const seenSubjects = new Set<string>();
  let totalCourses = 0;
  let totalSections = 0;
  let successfulSubjects = 0;
  let failedSubjects = 0;

  for (const item of value.subjectResults) {
    if (!isRecord(item)) {
      errors.push('subject result is not an object');
      continue;
    }
    const subject = typeof item.subject === 'string' ? item.subject : '';
    if (!expectedSubjects.has(subject)) errors.push(`unexpected subject result ${subject || '(empty)'}`);
    if (seenSubjects.has(subject)) errors.push(`duplicate subject result ${subject}`);
    seenSubjects.add(subject);
    if (typeof item.success !== 'boolean') errors.push(`subject ${subject} has invalid success`);
    if (!isNonNegativeInteger(item.coursesCount)) errors.push(`subject ${subject} has invalid coursesCount`);
    if (!isNonNegativeInteger(item.sectionsCount)) errors.push(`subject ${subject} has invalid sectionsCount`);
    if (!isNonNegativeNumber(item.durationMs)) errors.push(`subject ${subject} has invalid durationMs`);
    if (item.skipped !== undefined && typeof item.skipped !== 'boolean') {
      errors.push(`subject ${subject} has invalid skipped`);
    }
    if (item.error !== undefined && typeof item.error !== 'string') {
      errors.push(`subject ${subject} has invalid error`);
    }

    if (isNonNegativeInteger(item.coursesCount)) totalCourses += item.coursesCount;
    if (isNonNegativeInteger(item.sectionsCount)) totalSections += item.sectionsCount;
    if (item.success === true) successfulSubjects += 1;
    if (item.success === false) failedSubjects += 1;
  }

  for (const subject of expectedSubjects) {
    if (!seenSubjects.has(subject)) errors.push(`missing subject result ${subject}`);
  }
  if (value.totalCourses !== totalCourses) errors.push('totalCourses does not match subject results');
  if (value.totalSections !== totalSections) errors.push('totalSections does not match subject results');
  if (value.successfulSubjects !== successfulSubjects) errors.push('successfulSubjects does not match subject results');
  if (value.failedSubjects !== failedSubjects) errors.push('failedSubjects does not match subject results');
  if (!isNonNegativeNumber(value.durationMs)) errors.push('durationMs is invalid');
  if (!isNonNegativeInteger(value.rateLimitHits)) errors.push('rateLimitHits is invalid');

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
