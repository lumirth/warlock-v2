import { createServer, type ServerResponse } from 'node:http';
import type {
  CourseDetailResponseDto,
  CourseSectionDto,
  CourseSummaryDto,
  MatchEvidence,
  SearchActionDto,
  SearchCourseResultDto,
  SearchCourseMetadataDto,
  SearchRequestDto,
  SearchResponseDto,
  SearchUiPlanDto,
} from '@uiuc-course-search/query-types';
import { singleRequirementFilter } from '@uiuc-course-search/query-types';

const PORT = Number(process.env.QA_MOCK_API_PORT ?? 8787);

type CourseVariantOverride = Partial<CourseSummaryDto> & {
  search?: SearchCourseMetadataDto;
  matchEvidence?: MatchEvidence[];
  warnings?: SearchCourseResultDto['warnings'];
};

const baseCourse: CourseSummaryDto = {
  id: 'CS-225-2026-spring',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data abstractions: elementary data structures and their implementation using an object-oriented programming language.',
  creditHours: 4,
  year: 2026,
  term: 'spring',
  primaryInstructor: 'Lovelace, A; Hopper, G',
  metrics: {
    primaryInstructorRating: 4.8,
    avgGpa: 3.62,
    medianGpa: 3.67,
    gpaSampleSize: 820,
    qualityScore: 88,
    workloadScore: 42,
  },
  catalog: {
    courseInfo: 'Credit is not given for both CS 225 and ECE 220.',
    degreeAttributes: 'Quantitative Reasoning II',
  },
  scheduleNotes: {
    classScheduleInfo: null,
    dateRangeText: 'Jan 20, 2026 - May 6, 2026',
  },
  registration: {
    registrationNotes: null,
    approvalCode: null,
  },
  requirements: [
    {
      categoryId: 'QR',
      categoryName: 'Quantitative Reasoning',
      attributeCode: null,
      attributeName: null,
    },
  ],
  instructorLinks: {
    'Lovelace, A': {
      instructorName: 'Lovelace, A',
      rmpRating: 4.8,
      rmpDifficulty: 3.1,
      rmpId: 'ada',
      rmpUrl: null,
      rmpSearchUrl: 'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A',
      avgGpa: 3.62,
      medianGpa: 3.67,
      gpaSampleSize: 820,
      numRatings: 140,
      wouldTakeAgainPct: 92,
      topTags: ['Clear grading', 'Helpful'],
      department: 'Computer Science',
    },
  },
  links: {
    courseExplorerUrl: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
  },
};

const course: SearchCourseResultDto = {
  course: baseCourse,
  search: {
    score: 1,
    keywordRank: 1,
    historical: false,
  },
  matchEvidence: [
    { kind: 'course_code', label: 'Course CS 225', source: 'filter', weight: 'hard', value: 'CS 225' },
    { kind: 'requirement', label: 'Requirement QR', source: 'filter', weight: 'hard', value: 'QR' },
    { kind: 'keyword', label: 'Strong keyword match', source: 'keyword', weight: 'rank', value: '1' },
  ],
  warnings: [],
};

const baseSection: CourseSectionDto = {
  crn: '12345',
  sectionNumber: 'AL1',
  availability: {
    status: 'open',
    label: 'Open',
    rawStatus: 'Open',
    statusCode: 'A',
    sectionStatusCode: 'A',
  },
  schedule: {
    type: 'Lecture',
    days: 'MWF',
    startTime: '09:00',
    endTime: '09:50',
    location: 'Siebel Center 1404',
    dateRangeText: 'Jan 20, 2026 - May 6, 2026',
    partOfTerm: '1',
    startDate: '2026-01-20',
    endDate: '2026-05-06',
    creditHours: '4',
    meetings: [
      {
        typeCode: 'LEC',
        typeName: 'Lecture',
        days: 'MWF',
        startTime: '09:00',
        endTime: '09:50',
        buildingName: 'Siebel Center',
        roomNumber: '1404',
        dateRangeText: 'Jan 20, 2026 - May 6, 2026',
        instructorNames: ['Lovelace, A'],
        instructors: [baseCourse.instructorLinks['Lovelace, A']!],
      },
    ],
  },
  instructors: {
    displayName: 'Lovelace, A',
    rmpRating: 4.8,
    avgGpa: 3.62,
    stats: [baseCourse.instructorLinks['Lovelace, A']!],
  },
  sourceFacts: {
    sectionTitle: null,
    sectionText: null,
    sectionNotes: null,
    cappArea: null,
  },
  links: {
    courseExplorerUrl: baseCourse.links.courseExplorerUrl,
  },
};

const courseDetailResponse: CourseDetailResponseDto = {
  course: {
    ...baseCourse,
    sections: [baseSection],
  },
  cache: {
    cached: true,
    termStatus: 'active',
  },
};

function courseVariant(overrides: CourseVariantOverride = {}): SearchCourseResultDto {
  return {
    course: {
      ...course.course,
      id: overrides.id ?? course.course.id,
      subject: overrides.subject ?? course.course.subject,
      number: overrides.number ?? course.course.number,
      title: overrides.title ?? course.course.title,
      description: overrides.description ?? course.course.description,
      creditHours: overrides.creditHours ?? course.course.creditHours,
      year: overrides.year ?? course.course.year,
      term: overrides.term ?? course.course.term,
      primaryInstructor: overrides.primaryInstructor ?? course.course.primaryInstructor,
      metrics: {
        ...course.course.metrics,
        ...overrides.metrics,
        primaryInstructorRating:
          overrides.metrics?.primaryInstructorRating ??
          course.course.metrics.primaryInstructorRating,
        avgGpa: overrides.metrics?.avgGpa ?? course.course.metrics.avgGpa,
        medianGpa:
          overrides.metrics?.medianGpa ?? course.course.metrics.medianGpa,
        gpaSampleSize:
          overrides.metrics?.gpaSampleSize ??
          course.course.metrics.gpaSampleSize,
        qualityScore:
          overrides.metrics?.qualityScore ??
          course.course.metrics.qualityScore,
        workloadScore:
          overrides.metrics?.workloadScore ??
          course.course.metrics.workloadScore,
      },
      registration: {
        ...course.course.registration,
        ...overrides.registration,
      },
      catalog: {
        ...course.course.catalog,
        ...overrides.catalog,
      },
      scheduleNotes: {
        ...course.course.scheduleNotes,
        ...overrides.scheduleNotes,
      },
      requirements: overrides.requirements ?? course.course.requirements,
      instructorLinks: overrides.instructorLinks ?? course.course.instructorLinks,
      links: {
        ...course.course.links,
        ...overrides.links,
        courseExplorerUrl:
          overrides.links?.courseExplorerUrl ??
          course.course.links.courseExplorerUrl,
      },
    },
    search: overrides.search ?? course.search,
    matchEvidence: overrides.matchEvidence ?? course.matchEvidence,
    warnings: overrides.warnings ?? course.warnings,
  };
}

function searchAction(nextRequest: SearchRequestDto): SearchActionDto {
  return { kind: 'run_search', nextRequest };
}

function searchUi(query: string): SearchUiPlanDto {
  const lower = query.toLowerCase();
  const chips: SearchUiPlanDto['chips'] = [];
  const ambiguityActions: SearchUiPlanDto['ambiguityActions'] = [];

  if (lower.includes('cs 225')) {
    chips.push({
      id: 'course-code-CS-225',
      type: 'courseCode',
      label: 'Course CS 225',
      value: 'CS 225',
      source: 'natural_language',
      removable: true,
      editable: true,
      action: searchAction({ query: query.replace(/cs\s*225/i, '').trim() }),
    });
  }

  if (lower.includes('fagen')) {
    chips.push({
      id: 'instructor-fagen',
      type: 'instructor',
      label: 'Instructor fagen',
      value: 'fagen',
      source: 'natural_language',
      removable: true,
      editable: true,
      action: searchAction({
        query: query
          .replace(/professor\s+fagen/i, '')
          .replace(/fagen/i, '')
          .trim(),
      }),
    });
  }

  if (lower.includes('gened') || lower.includes('gened:cs')) {
    chips.push({
      id: 'requirement-CS',
      type: 'requirement',
      label: 'Requirement Cultural Studies',
      value: 'CS',
      source: 'natural_language',
      removable: true,
      editable: true,
      action: searchAction({
        query: query.replace(/\bgened\b/i, '').trim(),
      }),
    });
    ambiguityActions.push({
      id: 'requirement-CS-alternative',
      term: 'CS',
      label: 'Cultural Studies',
      action: searchAction({ query: '', filters: { requirement: singleRequirementFilter('CS') } }),
    });
  }

  if (lower.includes('intro') && (lower.includes('cs') || lower.includes('comp sci') || lower.includes('computer science'))) {
    chips.push({
      id: 'levelBoost-intro',
      type: 'levelBoost',
      label: 'Introductory courses',
      value: '100',
      source: 'natural_language',
      removable: true,
      editable: true,
      action: searchAction({ query: query.replace(/\bintro\b/i, '').trim() }),
    });
    chips.push({
      id: 'subject-CS',
      type: 'subject',
      label: 'Subject CS',
      value: 'CS',
      source: 'natural_language',
      removable: true,
      editable: true,
      action: searchAction({
        query: query
          .replace(/comp\s+sci/i, '')
          .replace(/\bcs\b/i, '')
          .trim(),
      }),
    });
  }

  return { chips, ambiguityActions };
}

function introResults(): SearchCourseResultDto[] {
  const firstPage = [
    courseVariant({
      id: 'CS-124-2026-spring',
      number: '124',
      title: 'Introduction to Computer Science I',
      description: 'A first programming and computer science course for students beginning the CS sequence.',
      creditHours: 3,
      search: { score: 0.98 },
      matchEvidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
        { kind: 'term', label: 'Introductory course', source: 'metadata', weight: 'soft', value: '100' },
      ],
    }),
    courseVariant({
      id: 'CS-100-2026-spring',
      number: '100',
      title: 'Freshman Orientation',
      description: 'Orientation to computer science study, department resources, and first-year planning.',
      creditHours: 1,
      search: { score: 0.92 },
      matchEvidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
        { kind: 'term', label: 'Introductory course', source: 'metadata', weight: 'soft', value: '100' },
      ],
    }),
    courseVariant({
      id: 'CS-101-2026-spring',
      number: '101',
      title: 'Introduction to Computing',
      description: 'Computing concepts and programming for students from a broad range of majors.',
      creditHours: 3,
      search: { score: 0.88 },
      matchEvidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
        { kind: 'term', label: 'Introductory course', source: 'metadata', weight: 'soft', value: '100' },
      ],
    }),
  ];

  return [
    ...firstPage,
    ...Array.from({ length: 19 }, (_, index) => courseVariant({
      id: `CS-${199 - index}-2026-spring`,
      number: String(199 - index),
      title: `Introductory CS Topic ${index + 1}`,
      description: 'Additional introductory CS result used to exercise paginated exploration in Browser QA.',
      creditHours: 3,
      search: { score: 0.75 - index / 100 },
      matchEvidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
      ],
    })),
  ];
}

function defaultResults(query: string): SearchCourseResultDto[] {
  return query.toLowerCase().includes('empty') ? [] : [
    course,
    courseVariant({
      id: 'CS-173-2026-spring',
      number: '173',
      title: 'Discrete Structures',
      description: 'Discrete mathematical structures frequently encountered in computer science.',
      creditHours: 3,
      primaryInstructor: null,
      search: { score: 0.82 },
      matchEvidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
        { kind: 'keyword', label: 'Keyword match', source: 'keyword', weight: 'rank', value: '2' },
      ],
    }),
  ];
}

function searchResponse(query: string, limit: number, offset: number): SearchResponseDto {
  const lower = query.toLowerCase();
  const isIntroCs = lower.includes('intro') && (lower.includes('cs') || lower.includes('comp sci') || lower.includes('computer science'));
  const allResults = isIntroCs ? introResults() : defaultResults(query);
  const pageResults = allResults.slice(offset, offset + limit);
  const hasMore = allResults.length > offset + limit;

  return {
    results: pageResults,
    meta: {
      query: { raw: query, residual: query.toLowerCase().includes('cs 225') || isIntroCs ? '' : query },
      nextRequest: {
        query,
      },
      interpretation: {
        queryTypes: isIntroCs ? ['topic'] : query.toLowerCase().includes('cs 225') ? ['exact_course'] : ['topic'],
        negativeTerms: [],
        topicTerms: isIntroCs ? ['computer science'] : [],
        expandedTerms: [],
        assumptions: isIntroCs
          ? [{ kind: 'introductory_gateway', label: 'Introductory courses', confidence: 0.72, source: 'rule' }]
          : [],
        warnings: [],
        evidenceLanes: ['official_text'],
        relaxationPlan: [],
        needsStudentProfile: false,
        confidence: 0.78,
      },
      timing: { extraction_ms: 2, search_ms: 6, total_ms: 8 },
      fallback: { tierReached: 1, constraintsRelaxed: [], originalResultCount: allResults.length },
      term: { activeTermId: '2026-spring', registrableTermId: '2026-spring' },
      ui: searchUi(query),
    },
    pagination: {
      resultCountLowerBound: allResults.length,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    },
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${PORT}`}`);
  console.log(`[mock-api] ${request.method ?? 'GET'} ${url.pathname} q=${JSON.stringify(url.searchParams.get('q') ?? '').slice(0, 80)} limit=${url.searchParams.get('limit') ?? ''} offset=${url.searchParams.get('offset') ?? ''}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Origin': '*',
    });
    response.end();
    return;
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, { healthy: true });
    return;
  }

  if (url.pathname === '/api/search') {
    const query = url.searchParams.get('q') ?? '';
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
    if (query.toLowerCase().includes('error')) {
      sendJson(response, 500, { error: 'Mock API error for Browser QA' });
      return;
    }
    sendJson(response, 200, searchResponse(query, Number.isFinite(limit) ? limit : 20, Number.isFinite(offset) ? offset : 0));
    return;
  }

  if (url.pathname === '/api/course/CS/225') {
    sendJson(response, 200, courseDetailResponse);
    return;
  }

  if (url.pathname === '/api/feedback' && request.method === 'POST') {
    sendJson(response, 202, {
      id: 'feedback-browser-qa',
      status: 'accepted',
      received_at: Math.floor(Date.now() / 1000),
    });
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Browser QA mock API listening on http://127.0.0.1:${PORT}`);
});
