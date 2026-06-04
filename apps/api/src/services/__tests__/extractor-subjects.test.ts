
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

  it.each([
    'last semester',
    'career path',
    'lead discussion',
    'scan open classes',
    'port',
  ])('ignores newly unsafe lowercase subject-code prose "%s"', (query) => {
    const result = extract(query);
    expect(result.hints.find(h => h.type === 'subject')).toBeUndefined();
  });

  it.each(['LAST', 'LEAD', 'PATH', 'PORT', 'SCAN'])('still extracts uppercase unsafe subject code "%s"', (code) => {
    const result = extract(`${code} courses`);
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'subject', value: code })
    );
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

  it('ignores unsafe lowercase "the" while still allowing the Theatre subject name', () => {
    const result = extract("intro to the theatre");
    expect(result.hints).not.toContainEqual(
      expect.objectContaining({ type: 'subject', value: 'THE' })
    );
    expect(result.hints).toContainEqual(
      expect.objectContaining({ type: 'subject', value: 'THEA' })
    );
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

  it('extracts multiword department aliases before standalone topic search', () => {
    const result = extract('intro to comp sci');
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('CS');
    expect(subject?.metadata.raw).toBe('comp sci');
    expect(result.residual).toBe('intro to');
  });

  it('extracts full department names as subject aliases', () => {
    const result = extract('intro computer science');
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe('CS');
    expect(result.residual).toBe('intro');
  });

  it.each([
    ['philosophy', 'PHIL'],
    ['intro to philosophy', 'PHIL'],
    ['political science', 'PS'],
    ['information sciences', 'IS'],
    ['art history', 'ARTH'],
    ['electrical computer engineering', 'ECE'],
    ['stats', 'STAT'],
    ['psych', 'PSYC'],
  ])('extracts official and student subject alias "%s"', (query, expectedSubject) => {
    const result = extract(query);
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe(expectedSubject);
  });

  it.each([
    ['philosphy', 'PHIL'],
    ['philospohy', 'PHIL'],
    ['intro to philosphy', 'PHIL'],
    ['computr science', 'CS'],
    ['politcal science', 'PS'],
    ['informaton sciences', 'IS'],
    ['art histry', 'ARTH'],
    ['organic chemstry', 'CHEM'],
    ['psycology', 'PSYC'],
  ])('extracts typo-tolerant subject alias "%s"', (query, expectedSubject) => {
    const result = extract(query);
    const subject = result.hints.find(h => h.type === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.value).toBe(expectedSubject);
  });

  it('extracts "phil 101" as course code', () => {
    const result = extract("phil 101");
    const course = result.hints.find(h => h.type === 'courseCode');
    expect(course).toBeDefined();
    expect(course?.value).toEqual({ subject: 'PHIL', number: '101' });
  });
});
