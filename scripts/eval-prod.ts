
import { fetch } from 'undici';

const BASE_URL = 'https://uiuc-course-search.lumirth.workers.dev/api/search';

interface SearchApiResult {
  subject?: string;
  number?: string;
  title?: string;
}

interface SearchApiResponse {
  results?: SearchApiResult[];
  meta?: {
    plan?: {
      filters?: unknown;
      semanticQuery?: string;
    };
  };
}

const categories = [
  {
    name: "1) I know what course I want",
    queries: [
      "CS 225",
      "PHIL 102 online",
      "STAT 400 spring",
      "MATH 241 professor name",
      "CRN 12345",
      "Data Structures UIUC",
      "Intro to psych"
    ]
  },
  {
    name: "2) I need a requirement / Gen Ed",
    queries: [
      "humanities gen ed",
      "US minority requirement",
      "QR requirement",
      "advanced composition",
      "gen ed that double counts",
      "easy humanities",
      "non western gen ed"
    ]
  },
  {
    name: "3) I want something on a topic",
    queries: [
      "artificial intelligence",
      "machine learning",
      "ethics of technology",
      "game design",
      "personal finance",
      "public speaking",
      "climate change",
      "law and society",
      "statistics for data science"
    ]
  },
  {
    name: "4) Make it fit my schedule",
    queries: [
      "no friday classes",
      "TTh after 3",
      "MWF before 11",
      "no 8am",
      "one day a week",
      "night class",
      "online asynchronous",
      "in person",
      "half semester"
    ]
  },
  {
    name: "5) Make it low-pain / survivable",
    queries: [
      "easy A",
      "no exams",
      "no attendance",
      "light workload",
      "easy gen ed",
      "minimal writing",
      "no group projects",
      "project based",
      "open notes exams"
    ]
  },
  {
    name: "6) Instructor-driven",
    queries: [
      "Smith",
      "Smith CS 225",
      "best professor for calc 2",
      "avoid professor Jones",
      "who teaches data structures",
      "good instructor for STAT 400"
    ]
  },
  {
    name: "7) Constraints they half-understand",
    queries: [
      "no prereqs",
      "prereq is CS 124",
      "for non majors",
      "freshman level",
      "400 level CS",
      "grad level NLP",
      "3 credit online",
      "4 credit with lab"
    ]
  },
  {
    name: "8) Registration status / logistics",
    queries: [
      "open seats",
      "waitlist only",
      "restricted to majors",
      "cross listed with",
      "time conflict with CS 225",
      "same time as my lab",
      "discussion required"
    ]
  },
  {
    name: "9) Planning / exploration",
    queries: [
      "what should I take after CS 225",
      "courses like ECON 102",
      "best electives for CS major",
      "interesting 1 credit",
      "fun class",
      "easy elective"
    ]
  }
];

async function run() {
  console.log(`Evaluating against ${BASE_URL}\n`);

  for (const cat of categories) {
    console.log(`\n=== ${cat.name} ===`);
    for (const query of cat.queries) {
      try {
        const start = Date.now();
        const url = `${BASE_URL}?q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const json = await res.json() as SearchApiResponse;
        const duration = Date.now() - start;

        const results = Array.isArray(json.results) ? json.results : [];
        const topResult = results[0] ? `${results[0].subject} ${results[0].number}: ${results[0].title}` : 'NO RESULTS';
        const plan = json.meta?.plan || {};
        const filters = JSON.stringify(plan.filters || {});
        const semantic = plan.semanticQuery || '';
        console.log(`\nQuery: "${query}" (${duration}ms)`);
        console.log(`  Top: ${topResult}`);
        console.log(`  Filters: ${filters}`);
        console.log(`  Semantic: "${semantic}"`);
        // console.log(`  Keyword: "${keyword}"`);
      } catch (err) {
        console.error(`  ERROR: ${err}`);
      }
    }
  }
}

run();
