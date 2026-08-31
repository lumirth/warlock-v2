import { describe, expect, it } from 'vitest';
import { evaluateScenario } from '../checks.js';

const result = {
  course: {
    id: 'CS-225',
    subject: 'CS',
    number: '225',
    title: 'Data Structures',
    requirements: [{ categoryId: 'QR', attributeCode: 'QR2' }],
  },
};

describe('public eval boundary', () => {
  it('requires the public results contract', () => {
    expect(evaluateScenario({ name: 'contract', queries: ['x'] }, {}))
      .toEqual(['response.results must be an array']);
  });

  it('checks only observable result promises', () => {
    expect(evaluateScenario({
      name: 'course',
      queries: ['CS 225'],
      nonEmpty: true,
      top: [{ subject: 'CS', number: '225', titleIncludes: 'Data Structures' }],
      all: { subjects: ['CS'], requirements: ['QR'], minLevel: 200, maxLevel: 299 },
    }, { results: [result] })).toEqual([]);
  });

  it('reports hard-constraint leakage', () => {
    expect(evaluateScenario({
      name: 'subject',
      queries: ['CS'],
      all: { subjects: ['MATH'], requirements: ['HUM'] },
    }, { results: [result] })).toEqual([
      'CS-225 has subject CS',
      'CS-225 lacks HUM',
    ]);
  });
});
