import { createServer, type ServerResponse } from 'node:http';
import type { CourseDto, SearchResponseDto, SearchUiPlanDto } from '@uiuc-course-search/query-types';

const PORT = Number(process.env.QA_MOCK_API_PORT ?? 8787);

const course: CourseDto = {
  id: 'CS-225-2026-spring',
  subject: 'CS',
  number: '225',
  title: 'Data Structures',
  description: 'Data abstractions: elementary data structures and their implementation using an object-oriented programming language.',
  credit_hours: 4,
  gened: 'QR',
  year: 2026,
  term: 'spring',
  primary_instructor: 'Lovelace, A; Hopper, G',
  primary_instructor_rmp: 4.8,
  avg_gpa: 3.62,
  gpa_sample_size: 820,
  quality_score: 88,
  difficulty_score: 42,
  instructor_links: {
    'Lovelace, A': {
      instructor_name: 'Lovelace, A',
      rmp_rating: 4.8,
      rmp_difficulty: 3.1,
      rmp_id: 'ada',
      rmp_url: null,
      rmp_search_url: 'https://www.ratemyprofessors.com/search/professors/1112?q=Lovelace%2C%20A',
      avg_gpa: 3.62,
      gpa_sample_size: 820,
      num_ratings: 140,
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
      queryPatch: { removeText: 'CS 225' },
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
      queryPatch: { removeText: lower.includes('professor fagen') ? 'professor fagen' : 'fagen' },
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
      queryPatch: { removeText: 'gened' },
    });
    advanced.gened = 'CS';
    ambiguityActions.push({
      id: 'gened-CS-alternative',
      term: 'CS',
      label: 'Cultural Studies',
      filter: { gened_code: 'CS' },
      queryPatch: { replaceQuery: 'gened:CS' },
    });
  }

  return { chips, advanced, ambiguityActions };
}

function searchResponse(query: string): SearchResponseDto {
  return {
    results: query.toLowerCase().includes('empty') ? [] : [
      course,
      {
        ...course,
        id: 'CS-173-2026-spring',
        number: '173',
        title: 'Discrete Structures',
        description: 'Discrete mathematical structures frequently encountered in computer science.',
        credit_hours: 3,
        gened: null,
        primary_instructor: null,
        _score: 0.82,
        match_evidence: [
          { kind: 'subject', label: 'Subject CS', source: 'filter', weight: 'hard', value: 'CS' },
          { kind: 'keyword', label: 'Keyword match', source: 'keyword', weight: 'rank', value: '2' },
        ],
      },
    ],
    meta: {
      query: { raw: query, residual: query.toLowerCase().includes('cs 225') ? '' : query },
      extraction: {
        hints: query.toLowerCase().includes('cs 225')
          ? [{
              type: 'courseCode',
              value: { subject: 'CS', number: '225' },
              metadata: { source: 'regex', confidence: 0.95, raw: 'CS 225' },
            }]
          : [],
      },
      plan: {
        filters: query.toLowerCase().includes('cs 225') ? { subject: 'CS', number: '225' } : {},
        semanticQuery: query,
        keywordQuery: query,
      },
      timing: { extraction_ms: 2, search_ms: 6, total_ms: 8 },
      fallback: { tierReached: 1, constraintsRelaxed: [], originalResultCount: 2 },
      term: { activeTermId: '2026-spring', registrableTermId: '2026-spring' },
      ui: searchUi(query),
    },
    pagination: { total: query.toLowerCase().includes('empty') ? 0 : 2, limit: 20, offset: 0 },
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
  console.log(`[mock-api] ${request.method ?? 'GET'} ${url.pathname} q=${JSON.stringify(url.searchParams.get('q') ?? '').slice(0, 80)}`);

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
    if (query.toLowerCase().includes('error')) {
      sendJson(response, 500, { error: 'Mock API error for Browser QA' });
      return;
    }
    sendJson(response, 200, searchResponse(query));
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
