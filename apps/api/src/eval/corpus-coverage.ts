import type { GoldQuery, QueryFailureClass } from './types.js';

export interface CorpusCoverageRequirement {
  failureClass: QueryFailureClass;
  description: string;
  minimumCases: number;
  queryIds: number[];
}

export interface CorpusCoverageResult extends CorpusCoverageRequirement {
  presentIds: number[];
  missingIds: number[];
  passes: boolean;
}

export const CORPUS_COVERAGE_REQUIREMENTS: CorpusCoverageRequirement[] = [
  {
    failureClass: 'course_code_navigation',
    description: 'Exact subject/number and CRN navigational searches',
    minimumCases: 8,
    queryIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  },
  {
    failureClass: 'subject_alias',
    description: 'Subject codes, official full names, punctuation-normalized names, and student nicknames',
    minimumCases: 12,
    queryIds: [10, 25, 42, 72, 73, 74, 76, 77, 78, 79, 80, 81, 82, 83],
  },
  {
    failureClass: 'misspelling',
    description: 'Typo-tolerant official subject names and common subject phrases without broad short-code fuzziness',
    minimumCases: 8,
    queryIds: [84, 85, 86, 87, 88, 89, 90, 91],
  },
  {
    failureClass: 'topic_synonym',
    description: 'Acronyms, synonyms, punctuation variants, and typoed topic phrases that expand into canonical search language',
    minimumCases: 9,
    queryIds: [92, 93, 94, 95, 96, 97, 98, 99, 100],
  },
  {
    failureClass: 'introductory_gateway',
    description: 'Generic beginner/introductory subject queries that should prefer gateway courses',
    minimumCases: 5,
    queryIds: [25, 72, 73, 74, 77, 85],
  },
  {
    failureClass: 'topical_intro',
    description: 'Intro-to-topic searches that must remain topical rather than forcing 100-level courses',
    minimumCases: 2,
    queryIds: [50, 75],
  },
  {
    failureClass: 'instructor_name',
    description: 'Professor, prof, with, taught-by, lowercase, hyphenated, apostrophe, and over-capture cases',
    minimumCases: 8,
    queryIds: [40, 41, 59, 60, 61, 62, 63, 64, 69, 71],
  },
  {
    failureClass: 'gened_language',
    description: 'GenEd aliases, explicit GenEd syntax, and ambiguous subject/GenEd terms',
    minimumCases: 8,
    queryIds: [11, 18, 19, 31, 32, 33, 34, 43, 44, 49],
  },
  {
    failureClass: 'schedule_delivery',
    description: 'Days, time windows, online/in-person, open/closed status, and schedule negation',
    minimumCases: 10,
    queryIds: [13, 14, 16, 17, 20, 36, 37, 38, 39, 52, 55, 67, 68],
  },
  {
    failureClass: 'score_quality',
    description: 'Difficulty, workload, GPA-booster, and quality-oriented language',
    minimumCases: 5,
    queryIds: [11, 47, 48, 65, 66],
  },
  {
    failureClass: 'power_syntax',
    description: 'Field filters, quoted phrases, any/all GenEds, and unsupported syntax preservation',
    minimumCases: 10,
    queryIds: [31, 32, 33, 34, 35, 51, 52, 53, 54, 57, 58],
  },
  {
    failureClass: 'ambiguity',
    description: 'Terms that can mean subjects, GenEds, or public-language categories',
    minimumCases: 3,
    queryIds: [42, 43, 44],
  },
  {
    failureClass: 'semantic_topic',
    description: 'Plain topical searches with no hard filter language',
    minimumCases: 7,
    queryIds: [26, 27, 28, 29, 30, 50, 75],
  },
  {
    failureClass: 'unsupported_language',
    description: 'Unsupported filters and generic natural-language commands that must remain searchable',
    minimumCases: 4,
    queryIds: [53, 54, 70, 112],
  },
  {
    failureClass: 'decision_query_rescue',
    description: 'Short, vague, and clunky advising-style queries compile into typed rescue plans',
    minimumCases: 8,
    queryIds: [102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
  },
  {
    failureClass: 'avoidance_language',
    description: 'Student avoidance phrases like no essays, no tests, not math, and less bio become negative preferences',
    minimumCases: 5,
    queryIds: [103, 104, 107, 108, 109, 111],
  },
  {
    failureClass: 'requirement_uncertainty',
    description: 'Counts-for and requirement language marks student-profile uncertainty instead of overclaiming degree progress',
    minimumCases: 3,
    queryIds: [104, 106, 110],
  },
  {
    failureClass: 'no_result_recovery',
    description: 'Over-constrained decision searches carry a relaxation plan for grouped recovery paths',
    minimumCases: 2,
    queryIds: [110, 111],
  },
];

export function evaluateCorpusCoverage(queries: GoldQuery[]): CorpusCoverageResult[] {
  const queryIds = new Set(queries.map(query => query.id));

  return CORPUS_COVERAGE_REQUIREMENTS.map(requirement => {
    const presentIds = requirement.queryIds.filter(queryId => queryIds.has(queryId));
    const missingIds = requirement.queryIds.filter(queryId => !queryIds.has(queryId));

    return {
      ...requirement,
      presentIds,
      missingIds,
      passes: missingIds.length === 0 && presentIds.length >= requirement.minimumCases,
    };
  });
}

export function findDuplicateQueryIds(queries: GoldQuery[]): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  for (const query of queries) {
    if (seen.has(query.id)) {
      duplicates.add(query.id);
    }
    seen.add(query.id);
  }

  return Array.from(duplicates).sort((a, b) => a - b);
}

export function formatCorpusCoverageReport(results: CorpusCoverageResult[]): string {
  const lines = [
    '# Corpus Coverage Report',
    '',
    `Failure classes: ${results.length}`,
    `Passing classes: ${results.filter(result => result.passes).length}`,
    `Failed classes: ${results.filter(result => !result.passes).length}`,
    '',
    '## Class Results',
    '',
  ];

  for (const result of results) {
    const status = result.passes ? 'PASS' : 'FAIL';
    lines.push(`- ${status} ${result.failureClass}: ${result.presentIds.length}/${result.minimumCases} cases`);
    if (result.missingIds.length > 0) {
      lines.push(`  - Missing query ids: ${result.missingIds.join(', ')}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
