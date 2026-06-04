import { createServer, type ServerResponse } from 'node:http';
import type {
  CourseDto,
  SearchActionDto,
  SearchRequestDto,
  SearchResponseDto,
  SearchUiPlanDto,
} from '@uiuc-course-search/query-types';

const PORT = Number(process.env.QA_MOCK_API_PORT ?? 8787);

const course: CourseDto = {
  id: 'CS-225-2026-spring',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data abstractions: elementary data structures and their implementation using an object-oriented programming language.',
  credit_hours: 4,
  year: 2026,
  term: 'spring',
  primary_instructor: 'Lovelace, A; Hopper, G',
  primary_instructor_rmp: 4.8,
  avg_gpa: 3.62,
  median_gpa: 3.67,
  gpa_sample_size: 820,
  quality_score: 88,
  difficulty_score: 42,
  course_info: 'Credit is not given for both CS 225 and ECE 220.',
  degree_attributes: 'Quantitative Reasoning II',
  class_schedule_info: null,
  date_range_text: 'Jan 20, 2026 - May 6, 2026',
  registration_notes: null,
  approval_code: null,
  geneds: [
    {
      categoryId: 'QR',
      categoryName: 'Quantitative Reasoning',
      attributeCode: null,
      attributeName: null,
    },
  ],
  instructor_links: {
    'Lovelace, A': {
      instructor_name: 'Lovelace, A',
      rmp_rating: 4.8,
      rmp_difficulty: 3.1,
      rmp_id: 'ada',
      rmp_url: null,
      rmp_search_url: 'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A',
	      avg_gpa: 3.62,
	      median_gpa: 3.67,
	      gpa_sample_size: 820,
	      num_ratings: 140,
	      would_take_again_pct: 92,
	      top_tags: ['Clear grading', 'Helpful'],
	      department: 'Computer Science',
	    },
	  },
  sections: [
    {
      crn: '12345',
      sectionNumber: 'AL1',
      status: 'Open',
      type: 'Lecture',
      days: 'MWF',
      startTime: '09:00',
      endTime: '09:50',
      location: 'Siebel Center for Computer Science 1404',
      instructor: 'Lovelace, A',
	      instructorRmp: 4.8,
	      instructorGpa: 3.62,
	      instructorStats: [],
	      sectionTitle: null,
	      statusCode: null,
	      sectionStatusCode: null,
	      sectionText: null,
	      sectionNotes: null,
	      cappArea: null,
	      dateRangeText: 'Jan 20, 2026 - May 6, 2026',
	      partOfTerm: '1',
	      startDate: '2026-01-20',
	      endDate: '2026-05-06',
	      creditHours: null,
	      meetings: [
	        {
	          typeCode: 'LCD',
	          typeName: 'Lecture-Discussion',
	          days: 'MWF',
	          startTime: '09:00',
	          endTime: '09:50',
	          buildingName: 'Siebel Center for Computer Science',
	          roomNumber: '1404',
	          dateRangeText: 'Jan 20, 2026 - May 6, 2026',
	          instructorNames: ['Lovelace, A'],
	          instructors: [],
	        },
	      ],
	      course_explorer_url: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
	    },
    {
      crn: '67890',
      sectionNumber: 'AD1',
      status: 'Restricted',
      type: 'Discussion',
      days: 'TR',
      startTime: '15:30',
      endTime: '16:50',
      location: 'Digital Computer Laboratory 1320',
      instructor: 'Hopper, G',
	      instructorRmp: null,
	      instructorGpa: null,
	      instructorStats: [],
	      sectionTitle: null,
	      statusCode: null,
	      sectionStatusCode: null,
	      sectionText: null,
	      sectionNotes: 'Restricted to Computer Science majors until open registration.',
	      cappArea: null,
	      dateRangeText: 'Mar 16, 2026 - May 6, 2026',
	      partOfTerm: 'B',
	      startDate: '2026-03-16',
	      endDate: '2026-05-06',
	      creditHours: null,
	      meetings: [],
	      course_explorer_url: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
	    },
  ],
  course_explorer_url: 'https://courses.illinois.edu/schedule/2026/spring/CS/225',
  _score: 1,
  _keywordRank: 1,
  _historical: false,
  _cached: true,
  _term_status: 'active',
  match_evidence: [
    { kind: 'course_code', label: 'Course CS 225', source: 'filter', weight: 'hard', value: 'CS 225' },
    { kind: 'gened', label: 'GenEd QR', source: 'filter', weight: 'hard', value: 'QR' },
    { kind: 'keyword', label: 'Strong keyword match', source: 'keyword', weight: 'rank', value: '1' },
  ],
  warnings: [],
};

function courseVariant(overrides: Partial<CourseDto>): CourseDto {
  return {
    ...course,
    ...overrides,
    instructor_links: overrides.instructor_links ?? course.instructor_links,
    sections: overrides.sections ?? course.sections,
    match_evidence: overrides.match_evidence ?? course.match_evidence,
    warnings: overrides.warnings ?? course.warnings,
  };
}

function searchAction(nextRequest: SearchRequestDto): SearchActionDto {
  return { kind: 'run_search', nextRequest };
}

function searchUi(query: string): SearchUiPlanDto {
  const lower = query.toLowerCase();
  const chips: SearchUiPlanDto['chips'] = [];
  const advanced: SearchUiPlanDto['advanced'] = {};
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
    advanced.subject = 'CS';
    advanced.number = '225';
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
    advanced.instructor = 'fagen';
  }

  if (lower.includes('gened') || lower.includes('gened:cs')) {
    chips.push({
      id: 'gened-CS',
      type: 'gened',
      label: 'GenEd Cultural Studies',
      value: 'CS',
      source: 'natural_language',
      removable: true,
      editable: true,
      action: searchAction({
        query: query.replace(/\bgened\b/i, '').trim(),
      }),
    });
    advanced.gened = 'CS';
    ambiguityActions.push({
      id: 'gened-CS-alternative',
      term: 'CS',
      label: 'Cultural Studies',
      action: searchAction({ query: '', filters: { gened: 'CS' } }),
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
    advanced.subject = 'CS';
  }

  return { chips, advanced, ambiguityActions };
}

function introResults(): CourseDto[] {
  const firstPage = [
    courseVariant({
      id: 'CS-124-2026-spring',
      number: '124',
      title: 'Introduction to Computer Science I',
      description: 'A first programming and computer science course for students beginning the CS sequence.',
      credit_hours: 3,
      _score: 0.98,
      match_evidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
        { kind: 'term', label: 'Introductory course', source: 'metadata', weight: 'soft', value: '100' },
      ],
    }),
    courseVariant({
      id: 'CS-100-2026-spring',
      number: '100',
      title: 'Freshman Orientation',
      description: 'Orientation to computer science study, department resources, and first-year planning.',
      credit_hours: 1,
      _score: 0.92,
      match_evidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
        { kind: 'term', label: 'Introductory course', source: 'metadata', weight: 'soft', value: '100' },
      ],
    }),
    courseVariant({
      id: 'CS-101-2026-spring',
      number: '101',
      title: 'Introduction to Computing',
      description: 'Computing concepts and programming for students from a broad range of majors.',
      credit_hours: 3,
      _score: 0.88,
      match_evidence: [
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
      credit_hours: 3,
      _score: 0.75 - index / 100,
      match_evidence: [
        { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
      ],
    })),
  ];
}

function defaultResults(query: string): CourseDto[] {
  return query.toLowerCase().includes('empty') ? [] : [
    course,
    courseVariant({
      id: 'CS-173-2026-spring',
      number: '173',
      title: 'Discrete Structures',
      description: 'Discrete mathematical structures frequently encountered in computer science.',
      credit_hours: 3,
      primary_instructor: null,
      _score: 0.82,
      match_evidence: [
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
      interpretation: {
        queryTypes: isIntroCs ? ['topic'] : query.toLowerCase().includes('cs 225') ? ['exact_course'] : ['topic'],
        negativeTerms: [],
        topicTerms: isIntroCs ? ['computer science'] : [],
        expandedTerms: [],
        assumptions: isIntroCs
          ? [{ kind: 'introductory_gateway', label: 'Introductory courses', confidence: 0.72, source: 'rule' }]
          : [],
        warnings: [],
        retrievalLanes: ['official_text'],
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
      total: allResults.length,
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
    sendJson(response, 200, course);
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
