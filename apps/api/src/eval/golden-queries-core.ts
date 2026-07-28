import type { GoldQuery } from './types.js';
import {
  allRequirement,
  anyRequirement,
  requirement,
} from './golden-query-builders.js';

export const CORE_GOLDEN_QUERIES: GoldQuery[] = [
  // === NAVIGATIONAL (Course Codes) ===
  {
    id: 1,
    query: "CS 225",
    expected_filters: { subject: "CS", number: "225" },
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 2,
    query: "cs 225",
    expected_filters: { subject: "CS", number: "225" },
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 3,
    query: "CS225",
    expected_filters: { subject: "CS", number: "225" },
    invariants: { subject: "CS" },
    category: "navigational"
  },
  {
    id: 4,
    query: "STAT 400",
    expected_filters: { subject: "STAT", number: "400" },
    invariants: { subject: "STAT" },
    category: "navigational"
  },
  {
    id: 5,
    query: "ECE 110",
    expected_filters: { subject: "ECE", number: "110" },
    invariants: { subject: "ECE" },
    category: "navigational"
  },
  {
    id: 6,
    query: "MATH 241",
    expected_filters: { subject: "MATH", number: "241" },
    invariants: { subject: "MATH" },
    category: "navigational"
  },
  {
    id: 7,
    query: "RHET 105",
    expected_filters: { subject: "RHET", number: "105" },
    invariants: { subject: "RHET" },
    category: "navigational"
  },
  {
    id: 8,
    query: "CRN 12345",
    expected_filters: { crn: "12345" },
    category: "navigational"
  },
  {
    id: 9,
    query: "12345",
    expected_filters: { crn: "12345" },
    category: "navigational"
  },
  {
    id: 10,
    query: "econ",
    expected_filters: { subject: "ECON" },
    invariants: { subject: "ECON" },
    category: "navigational"
  },

  // === STRUCTURED (Single Filter) ===
  {
    id: 11,
    query: "easy humanities gen ed",
    expected_filters: { requirement: requirement("HUM") },
    invariants: { requirement: "HUM" },
    category: "structured",
    notes: "Residual should NOT contain 'gen ed'"
  },
  {
    id: 12,
    query: "3 credits",
    expected_filters: { credits: 3 },
    category: "structured"
  },
  {
    id: 13,
    query: "MWF morning",
    expected_filters: { days: "MWF", time: "morning" },
    category: "structured"
  },
  {
    id: 14,
    query: "TR afternoon",
    expected_filters: { days: "TR", time: "afternoon" },
    category: "structured"
  },
  {
    id: 15,
    query: "400 level CS",
    expected_filters: { level: 400, subject: "CS" },
    invariants: { subject: "CS", level_gte: 400, level_lte: 499 },
    category: "structured"
  },
  {
    id: 16,
    query: "online courses",
    expected_filters: { online: true },
    category: "structured",
    notes: "Residual should NOT contain 'courses'"
  },
  {
    id: 17,
    query: "in person classes",
    expected_filters: { online: false },
    category: "structured",
    notes: "Residual should NOT contain 'classes'"
  },
  {
    id: 18,
    query: "quantitative reasoning",
    expected_filters: { requirement: requirement("QR") },
    category: "structured"
  },
  {
    id: 19,
    query: "natural sciences gen ed",
    expected_filters: { requirement: requirement("NAT") },
    category: "structured"
  },
  {
    id: 20,
    query: "open sections",
    expected_filters: { status: "open" },
    category: "structured",
    notes: "Residual should NOT contain 'sections'"
  },

  // === STRUCTURED (Multi Filter) ===
  {
    id: 21,
    query: "400 level CS MWF morning 3 credits",
    expected_filters: { level: 400, subject: "CS", days: "MWF", time: "morning", credits: 3 },
    invariants: { subject: "CS", level_gte: 400, level_lte: 499 },
    category: "structured"
  },
  {
    id: 22,
    query: "easy humanities MWF afternoon",
    expected_filters: { requirement: requirement("HUM"), days: "MWF", time: "afternoon" },
    invariants: { requirement: "HUM" },
    category: "structured"
  },
  {
    id: 23,
    query: "open 3 credit online",
    expected_filters: { status: "open", credits: 3, online: true },
    category: "structured"
  },
  {
    id: 24,
    query: "graduate algorithms",
    expected_filters: { level: 500 },
    invariants: { level_gte: 500 },
    category: "structured"
  },
  {
    id: 25,
    query: "beginner spanish",
    expected_filters: { subject: "SPAN" },
    expected_soft_preferences: { levelBoost: 100 },
    invariants: { subject: "SPAN" },
    category: "structured"
  },

  // === SEMANTIC ===
  {
    id: 26,
    query: "data structures",
    expected_filters: {},
    expected_top1_title: "Data Structures",
    category: "semantic"
  },
  {
    id: 27,
    query: "machine learning",
    expected_filters: {},
    category: "semantic"
  },
  {
    id: 28,
    query: "artificial intelligence",
    expected_filters: {},
    category: "semantic"
  },
  {
    id: 29,
    query: "organic chemistry",
    expected_filters: { subject: "CHEM" },
    invariants: { subject: "CHEM" },
    category: "semantic"
  },
  {
    id: 30,
    query: "linear algebra",
    expected_filters: {},
    category: "semantic"
  },

  // === POWER SYNTAX ===
  {
    id: 31,
    query: "gened:HUM",
    expected_filters: { requirement: requirement("HUM") },
    category: "power_syntax"
  },
  {
    id: 32,
    query: "gened:HUM easy",
    expected_filters: { requirement: requirement("HUM") },
    category: "power_syntax"
  },
  {
    id: 33,
    query: "gened:any(HUM,US)",
    expected_filters: { requirement: anyRequirement(["HUM", "US"]) },
    category: "power_syntax"
  },
  {
    id: 34,
    query: "gened:any(HUM, US) morning",
    expected_filters: { requirement: anyRequirement(["HUM", "US"]), time: "morning" },
    category: "power_syntax"
  },
  {
    id: 35,
    query: "subject:CS 400 level",
    expected_filters: { subject: "CS", level: 400 },
    category: "power_syntax"
  },

  // === NEGATION ===
  {
    id: 36,
    query: "no morning classes",
    expected_filters: { not: { time: ["morning"] } },
    category: "structured",
    notes: "Residual should NOT contain 'classes'"
  },
  {
    id: 37,
    query: "avoid friday",
    expected_filters: { not: { days: ["friday"] } },
    category: "structured"
  },
  {
    id: 38,
    query: "not online",
    expected_filters: { online: false },
    category: "structured"
  },
  {
    id: 39,
    query: "CS -online",
    expected_filters: { subject: "CS" },
    category: "power_syntax"
  },

  // === INSTRUCTOR ===
  {
    id: 40,
    query: "CS 225 with Fagen",
    expected_filters: { subject: "CS", number: "225" },
    category: "structured"
  },
  {
    id: 41,
    query: "Professor Smith CHEM",
    expected_filters: { subject: "CHEM" },
    category: "structured"
  },

  // === DISAMBIGUATION ===
  {
    id: 42,
    query: "CS courses",
    expected_filters: { subject: "CS" },
    invariants: { subject: "CS" },
    category: "disambiguation",
    notes: "CS = Computer Science subject, not Cultural Studies gened"
  },
  {
    id: 43,
    query: "cultural studies gened",
    expected_filters: { requirement: requirement("CS") },
    category: "disambiguation"
  },
  {
    id: 44,
    query: "humanities gen ed",
    expected_filters: { requirement: requirement("HUM") },
    category: "disambiguation"
  },

  // === TERM EXTRACTION ===
  {
    id: 45,
    query: "CS spring 2026",
    expected_filters: { subject: "CS", term: "spring", year: 2026 },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { subjects: ["CS"] }
    },
    category: "structured",
    notes: "Term extraction"
  },
  {
    id: 46,
    query: "fall 2025 MATH",
    expected_filters: { subject: "MATH", term: "fall", year: 2025 },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { subjects: ["MATH"] }
    },
    category: "structured"
  },

  // === STOP PHRASE TESTS ===
  {
    id: 47,
    query: "easy online gen ed",
    expected_filters: { online: true },
    category: "structured",
    notes: "Residual should NOT contain 'gen ed'"
  },
  {
    id: 48,
    query: "gpa booster",
    expected_filters: {},
    category: "semantic",
    notes: "Subjective language remains searchable and does not imply instructor difficulty"
  },
  {
    id: 49,
    query: "writing intensive courses",
    expected_filters: { requirement: requirement("ACP") },
    category: "structured",
    notes: "Residual should NOT contain 'courses'"
  },

  // === INTRO AS BOOST ===
  {
    id: 50,
    query: "intro to compilers",
    expected_filters: {},
    expected_results: {
      non_empty: true,
      top_k: 10,
      must_include: [{ titleIncludes: "Compiler" }]
    },
    category: "semantic",
    notes: "intro should NOT force level=100 for compilers"
  },

  // === QUERY LANGUAGE V1 EDGE CASES ===
  {
    id: 51,
    query: "gened:all(HUM,US)",
    expected_filters: { requirement: allRequirement(["HUM", "US"]) },
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
    category: "power_syntax",
    notes: "Quoted phrase should become query text while hard filters remain explicit"
  },
  {
    id: 53,
    query: "campus:urbana algorithms",
    expected_filters: {},
    category: "power_syntax",
    notes: "Unsupported fields stay in residual instead of disappearing silently"
  },
  {
    id: 54,
    query: "algorithms -calculus",
    expected_filters: {},
    category: "power_syntax",
    notes: "Unsupported dash negation stays in residual"
  },
  {
    id: 55,
    query: "not online data structures",
    expected_filters: { online: false },
    category: "structured"
  },
  {
    id: 56,
    query: "no exams CS",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { lowExams: 0.88 },
    expected_intent: {
      queryTypes: ["avoidance", "subjective_vibe"],
      negativeTerms: ["exam_heavy", "tests", "exams"],
      warnings: ["exam_evidence_incomplete"],
    },
    invariants: { subject: "CS" },
    category: "decision",
    notes: "No-exam language is now an evidence-backed avoidance preference"
  },
];
