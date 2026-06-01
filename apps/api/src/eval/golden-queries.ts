// apps/api/src/eval/golden-queries.ts
import type { GoldQuery } from './types.js';

export const GOLDEN_QUERIES: GoldQuery[] = [
  // === NAVIGATIONAL (Course Codes) ===
  {
    id: 1,
    query: "CS 225",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 2,
    query: "cs 225",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 3,
    query: "CS225",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 4,
    query: "STAT 400",
    expected_filters: { subject: "STAT", number: "400" },
    expected_residual: "",
    invariants: { subject: "STAT" },
    category: "navigational"
  },
  {
    id: 5,
    query: "ECE 110",
    expected_filters: { subject: "ECE", number: "110" },
    expected_residual: "",
    invariants: { subject: "ECE" },
    category: "navigational"
  },
  {
    id: 6,
    query: "MATH 241",
    expected_filters: { subject: "MATH", number: "241" },
    expected_residual: "",
    invariants: { subject: "MATH" },
    category: "navigational"
  },
  {
    id: 7,
    query: "RHET 105",
    expected_filters: { subject: "RHET", number: "105" },
    expected_residual: "",
    invariants: { subject: "RHET" },
    category: "navigational"
  },
  {
    id: 8,
    query: "CRN 12345",
    expected_filters: { crn: "12345" },
    expected_residual: "",
    category: "navigational"
  },
  {
    id: 9,
    query: "12345",
    expected_filters: { crn: "12345" },
    expected_residual: "",
    category: "navigational"
  },
  {
    id: 10,
    query: "econ",
    expected_filters: { subject: "ECON" },
    expected_residual: "",
    invariants: { subject: "ECON" },
    category: "navigational"
  },

  // === STRUCTURED (Single Filter) ===
  {
    id: 11,
    query: "easy humanities gen ed",
    expected_filters: { difficulty: "easy", gened_code: "HUM" },
    expected_residual: "",
    invariants: { gened_code: "HUM" },
    category: "structured",
    notes: "Residual should NOT contain 'gen ed'"
  },
  {
    id: 12,
    query: "3 credits",
    expected_filters: { credits: 3 },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 13,
    query: "MWF morning",
    expected_filters: { days: "MWF", time: "morning" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 14,
    query: "TR afternoon",
    expected_filters: { days: "TR", time: "afternoon" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 15,
    query: "400 level CS",
    expected_filters: { level: 400, subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS", level_gte: 400, level_lte: 499 },
    category: "structured"
  },
  {
    id: 16,
    query: "online courses",
    expected_filters: { online: true },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'courses'"
  },
  {
    id: 17,
    query: "in person classes",
    expected_filters: { online: false },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'classes'"
  },
  {
    id: 18,
    query: "quantitative reasoning",
    expected_filters: { gened_code: "QR" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 19,
    query: "natural sciences gen ed",
    expected_filters: { gened_code: "NAT" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 20,
    query: "open sections",
    expected_filters: { status: "open" },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'sections'"
  },

  // === STRUCTURED (Multi Filter) ===
  {
    id: 21,
    query: "400 level CS MWF morning 3 credits",
    expected_filters: { level: 400, subject: "CS", days: "MWF", time: "morning", credits: 3 },
    expected_residual: "",
    invariants: { subject: "CS", level_gte: 400, level_lte: 499 },
    category: "structured"
  },
  {
    id: 22,
    query: "easy humanities MWF afternoon",
    expected_filters: { difficulty: "easy", gened_code: "HUM", days: "MWF", time: "afternoon" },
    expected_residual: "",
    invariants: { gened_code: "HUM" },
    category: "structured"
  },
  {
    id: 23,
    query: "open 3 credit online",
    expected_filters: { status: "open", credits: 3, online: true },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 24,
    query: "graduate algorithms",
    expected_filters: { level: 500 },
    expected_residual: "algorithms",
    invariants: { level_gte: 500 },
    category: "structured"
  },
  {
    id: 25,
    query: "beginner spanish",
    expected_filters: {},
    expected_soft_preferences: { levelBoost: 100 },
    expected_residual: "beginner spanish",
    category: "structured"
  },

  // === SEMANTIC ===
  {
    id: 26,
    query: "data structures",
    expected_filters: {},
    expected_residual: "data structures",
    expected_top1_title: "Data Structures",
    category: "semantic"
  },
  {
    id: 27,
    query: "machine learning",
    expected_filters: {},
    expected_residual: "machine learning",
    category: "semantic"
  },
  {
    id: 28,
    query: "artificial intelligence",
    expected_filters: {},
    expected_residual: "artificial intelligence",
    category: "semantic"
  },
  {
    id: 29,
    query: "organic chemistry",
    expected_filters: {},
    expected_residual: "organic chemistry",
    category: "semantic"
  },
  {
    id: 30,
    query: "linear algebra",
    expected_filters: {},
    expected_residual: "linear algebra",
    category: "semantic"
  },

  // === POWER SYNTAX ===
  {
    id: 31,
    query: "gened:HUM",
    expected_filters: { gened_code: "HUM" },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 32,
    query: "gened:HUM easy",
    expected_filters: { gened_code: "HUM", difficulty: "easy" },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 33,
    query: "gened:any(HUM,US)",
    expected_filters: { gened_any: ["HUM", "US"] },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 34,
    query: "gened:any(HUM, US) morning",
    expected_filters: { gened_any: ["HUM", "US"], time: "morning" },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 35,
    query: "subject:CS 400 level",
    expected_filters: { subject: "CS", level: 400 },
    expected_residual: "",
    category: "power_syntax"
  },

  // === NEGATION ===
  {
    id: 36,
    query: "no morning classes",
    expected_filters: { not: { time: ["morning"] } },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'classes'"
  },
  {
    id: 37,
    query: "avoid friday",
    expected_filters: { not: { days: ["friday"] } },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 38,
    query: "not online",
    expected_filters: { online: false },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 39,
    query: "CS -online",
    expected_filters: { subject: "CS" },
    expected_residual: "",
    category: "power_syntax"
  },

  // === INSTRUCTOR ===
  {
    id: 40,
    query: "CS 225 with Fagen",
    expected_filters: { subject: "CS", number: "225" },
    expected_residual: "",
    category: "structured"
  },
  {
    id: 41,
    query: "Professor Smith CHEM",
    expected_filters: { subject: "CHEM" },
    expected_residual: "",
    category: "structured"
  },

  // === DISAMBIGUATION ===
  {
    id: 42,
    query: "CS courses",
    expected_filters: { subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "disambiguation",
    notes: "CS = Computer Science subject, not Cultural Studies gened"
  },
  {
    id: 43,
    query: "cultural studies gened",
    expected_filters: { gened_code: "CS" },
    expected_residual: "",
    category: "disambiguation"
  },
  {
    id: 44,
    query: "humanities gen ed",
    expected_filters: { gened_code: "HUM" },
    expected_residual: "",
    category: "disambiguation"
  },

  // === TERM EXTRACTION ===
  {
    id: 45,
    query: "CS spring 2026",
    expected_filters: { subject: "CS", term: "spring", year: 2026 },
    expected_residual: "",
    category: "structured",
    notes: "Term extraction"
  },
  {
    id: 46,
    query: "fall 2025 MATH",
    expected_filters: { subject: "MATH", term: "fall", year: 2025 },
    expected_residual: "",
    category: "structured"
  },

  // === STOP PHRASE TESTS ===
  {
    id: 47,
    query: "easy online gen ed",
    expected_filters: { difficulty: "easy", online: true },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'gen ed'"
  },
  {
    id: 48,
    query: "gpa booster",
    expected_filters: { difficulty: "easy" },
    expected_residual: "",
    category: "structured",
    notes: "Should not leave 'booster' in residual"
  },
  {
    id: 49,
    query: "writing intensive courses",
    expected_filters: { gened_code: "ACP" },
    expected_residual: "",
    category: "structured",
    notes: "Residual should NOT contain 'courses'"
  },

  // === INTRO AS BOOST ===
  {
    id: 50,
    query: "intro to compilers",
    expected_filters: {},
    expected_residual: "intro to compilers",
    category: "semantic",
    notes: "intro should NOT force level=100 for compilers"
  },

  // === QUERY LANGUAGE V1 EDGE CASES ===
  {
    id: 51,
    query: "gened:all(HUM,US)",
    expected_filters: { gened_all: ["HUM", "US"] },
    expected_residual: "",
    category: "power_syntax"
  },
  {
    id: 52,
    query: 'status:open online:true days:MWF time:morning term:spring-2026 "data structures" -friday',
    expected_filters: {
      status: "open",
      online: true,
      days: "MWF",
      time: "morning",
      term: "spring",
      year: 2026,
      not: { days: ["friday"] }
    },
    expected_residual: "",
    require_term_metadata: true,
    category: "power_syntax",
    notes: "Quoted phrase should become query text while hard filters remain explicit"
  },
  {
    id: 53,
    query: "campus:urbana algorithms",
    expected_filters: {},
    expected_residual: "campus:urbana algorithms",
    category: "power_syntax",
    notes: "Unsupported fields stay in residual instead of disappearing silently"
  },
  {
    id: 54,
    query: "algorithms -calculus",
    expected_filters: {},
    expected_residual: "algorithms -calculus",
    category: "power_syntax",
    notes: "Unsupported dash negation stays in residual"
  },
  {
    id: 55,
    query: "not online data structures",
    expected_filters: { online: false },
    expected_residual: "data structures",
    category: "structured"
  },
  {
    id: 56,
    query: "no exams CS",
    expected_filters: { subject: "CS" },
    expected_residual: "no exams",
    invariants: { subject: "CS" },
    category: "structured",
    notes: "Unsupported natural-language negation remains searchable text"
  },
  {
    id: 57,
    query: "partOfTerm:A CS",
    expected_filters: { partOfTerm: "A", subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "power_syntax"
  },
  {
    id: 58,
    query: 'subject:CS "machine learning"',
    expected_filters: { subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "power_syntax"
  },
];
