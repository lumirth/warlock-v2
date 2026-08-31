import type { EvalScenario } from './checks.js';

// Deployment checks are equivalence classes, not a second parser test suite.
// Pure parsing and ranking edge cases belong beside their implementations;
// these cases prove that the public API preserves the product's hard promises.
export const EVAL_SCENARIOS: EvalScenario[] = [
  {
    name: 'course navigation',
    queries: ['CS 225', 'cs225'],
    nonEmpty: true,
    top: [{ subject: 'CS', number: '225', titleIncludes: 'Data Structures' }],
    all: { subjects: ['CS'] },
  },
  {
    name: 'subject disambiguation',
    queries: ['CS courses'],
    nonEmpty: true,
    all: { subjects: ['CS'] },
  },
  {
    name: 'level constraint',
    queries: ['400 level CS'],
    nonEmpty: true,
    all: { subjects: ['CS'], minLevel: 400, maxLevel: 499 },
  },
  {
    name: 'humanities requirement',
    queries: ['humanities gen ed', 'gened:HUM'],
    nonEmpty: true,
    all: { requirements: ['HUM'] },
  },
  {
    name: 'cultural studies requirement',
    queries: ['cultural studies gened'],
    nonEmpty: true,
    all: { requirements: ['CS'] },
  },
  {
    name: 'combined requirement',
    queries: ['gened:all(HUM,US)'],
    nonEmpty: true,
    all: { requirements: ['HUM', 'US'] },
  },
  {
    name: 'subject names and aliases',
    queries: ['philosophy', 'philosphy'],
    nonEmpty: true,
    all: { subjects: ['PHIL'] },
  },
  {
    name: 'unsafe short subject via full name',
    queries: ['information sciences'],
    nonEmpty: true,
    all: { subjects: ['IS'] },
  },
  {
    name: 'longest subject name wins',
    queries: ['art history'],
    nonEmpty: true,
    all: { subjects: ['ARTH'] },
  },
  {
    name: 'introductory intent',
    queries: ['intro to CS', 'intro to comp sci'],
    nonEmpty: true,
    top: [{ titleIncludes: 'Introduction to Computer Science' }],
    all: { subjects: ['CS'] },
  },
  {
    name: 'topic intent remains topical',
    queries: ['intro to compilers'],
    nonEmpty: true,
    top: [{ titleIncludes: 'Compiler' }],
  },
  {
    name: 'semantic navigation',
    queries: ['data structures'],
    nonEmpty: true,
    top: [{ titleIncludes: 'Data Structures' }],
  },
  {
    name: 'avoidance keeps hard subject',
    queries: ['no exams CS'],
    nonEmpty: true,
    all: { subjects: ['CS'] },
  },
];
