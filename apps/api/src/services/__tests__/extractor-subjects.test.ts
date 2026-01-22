
import { describe, it, expect } from 'vitest';
import { extract } from '../extractor.js';

describe('Subject Extraction Rules', () => {
  it('extracts safe lowercase subjects', () => {
    const result = extract("phil of law and state");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('PHIL');
  });

  it('extracts uppercase unsafe subjects', () => {
    // Standalone "IS" (not followed by number)
    const result = extract("courses in IS department");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('IS');
  });

  it('ignores lowercase unsafe subjects', () => {
    const result = extract("this is a test");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeUndefined();
  });

  it('extracts uppercase UP', () => {
    const result = extract("classes about UP");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('UP');
  });

  it('ignores lowercase up', () => {
    const result = extract("sign up for class");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeUndefined();
  });

  it('extracts uppercase ME', () => {
    const result = extract("major in ME");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('ME');
  });

  it('ignores lowercase me', () => {
    const result = extract("email me the syllabus");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeUndefined();
  });

  it('ignores "the" (not a subject)', () => {
    const result = extract("intro to the theatre");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeUndefined();
  });

  it('extracts "thea" (safe lowercase)', () => {
     const result = extract("intro to thea");
     const subject = result.hints.find(h => h.type === 'subject');
     expect(subject).toBeDefined();
     expect(subject?.value).toBe('THEA');
  });

  it('extracts "cs" (safe lowercase)', () => {
    const result = extract("cs courses");
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('CS');
  });

  it('extracts "phil 101" as course code', () => {
    const result = extract("phil 101");
    const course = result.hints.find(h => h.type === 'courseCode');
    expect(course).toBeDefined();
    expect(course?.value).toEqual({ subject: 'PHIL', number: '101' });
  });
});
