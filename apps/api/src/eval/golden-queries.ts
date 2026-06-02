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
    expected_filters: { subject: "SPAN" },
    expected_soft_preferences: { levelBoost: 100, introductoryIntent: "gateway" },
    expected_residual: "",
    invariants: { subject: "SPAN" },
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
    expected_filters: { subject: "CHEM" },
    expected_residual: "organic",
    invariants: { subject: "CHEM" },
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
  {
    id: 59,
    query: "professor fagen",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "",
    category: "instructor",
    notes: "Lowercase professor-name search should become an instructor hard filter"
  },
  {
    id: 60,
    query: "prof fagen-ulmschneider",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "",
    category: "instructor",
    notes: "Hyphenated professor names should resolve as instructor filters"
  },
  {
    id: 61,
    query: "taught by wade fagen algorithms",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "algorithms",
    category: "instructor",
    notes: "Instructor phrase should be removed while topical residual remains"
  },
  {
    id: 62,
    query: "CS 225 professor fagen",
    expected_filters: { subject: "CS", number: "225" },
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "instructor"
  },
  {
    id: 63,
    query: "with O'Brien",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "",
    category: "instructor",
    notes: "Apostrophes in instructor names should be preserved"
  },
  {
    id: 64,
    query: "with Liu-Prasad",
    expected_filters: {},
    expected_residual: "",
    category: "instructor",
    notes: "Hyphenated instructor names should be preserved without broadening absent names to unrelated first-token matches"
  },
  {
    id: 65,
    query: "hard CS class",
    expected_filters: { subject: "CS", difficulty: "hard" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "score",
    notes: "Difficulty language should be explicit and not remain as residual copy"
  },
  {
    id: 66,
    query: "easy 3 credit humanities",
    expected_filters: { difficulty: "easy", credits: 3, gened_code: "HUM" },
    expected_residual: "",
    category: "score"
  },
  {
    id: 67,
    query: "online MWF morning open",
    expected_filters: { online: true, days: "MWF", time: "morning", status: "open" },
    expected_residual: "",
    category: "schedule"
  },
  {
    id: 68,
    query: "in person no friday afternoon",
    expected_filters: { online: false, time: "afternoon", not: { days: ["friday"] } },
    expected_residual: "",
    category: "schedule"
  },
  {
    id: 69,
    query: "spring 2026 professor fagen open",
    expected_filters: { term: "spring", year: 2026, status: "open" },
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "",
    category: "instructor"
  },
  {
    id: 70,
    query: "sort by difficulty",
    expected_filters: {},
    expected_residual: "sort by difficulty",
    category: "semantic",
    notes: "Generic by-phrases must not become instructor filters"
  },
  {
    id: 71,
    query: "professor fagen algorithms",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    expected_residual: "algorithms",
    category: "instructor",
    notes: "Short professor-name searches should not absorb trailing topic terms into the instructor name"
  },
  {
    id: 72,
    query: "intro to CS",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { levelBoost: 100, introductoryIntent: "gateway" },
    expected_residual: "",
    expected_top1_title: "Introduction to Computer Science I",
    invariants: { subject: "CS" },
    category: "structured",
    notes: "Generic intro-subject queries should become gateway-course intent instead of matching upper-level Introduction-to-X titles"
  },
  {
    id: 73,
    query: "intro to comp sci",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { levelBoost: 100, introductoryIntent: "gateway" },
    expected_residual: "",
    expected_top1_title: "Introduction to Computer Science I",
    invariants: { subject: "CS" },
    category: "structured",
    notes: "Common department nickname should normalize to CS before introductory intent is applied"
  },
  {
    id: 74,
    query: "intro computer science",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { levelBoost: 100, introductoryIntent: "gateway" },
    expected_residual: "",
    expected_top1_title: "Introduction to Computer Science I",
    invariants: { subject: "CS" },
    category: "structured"
  },
  {
    id: 75,
    query: "intro to compilers",
    expected_filters: {},
    expected_soft_preferences: { levelBoost: 100 },
    expected_residual: "intro to compilers",
    category: "semantic",
    notes: "Introductory gateway intent requires a subject or explicit subject override; topic searches stay topical"
  },
  {
    id: 76,
    query: "philosophy",
    expected_filters: { subject: "PHIL" },
    expected_residual: "",
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Official subject names should resolve as subject filters, not loose topical text"
  },
  {
    id: 77,
    query: "intro to philosophy",
    expected_filters: { subject: "PHIL" },
    expected_soft_preferences: { levelBoost: 100, introductoryIntent: "gateway" },
    expected_residual: "",
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Introductory gateway intent should work across official subject names, not only CS aliases"
  },
  {
    id: 78,
    query: "political science",
    expected_filters: { subject: "PS" },
    expected_residual: "",
    invariants: { subject: "PS" },
    category: "structured"
  },
  {
    id: 79,
    query: "information sciences",
    expected_filters: { subject: "IS" },
    expected_residual: "",
    invariants: { subject: "IS" },
    category: "structured",
    notes: "Unsafe lowercase code IS should still be reachable through its official full name"
  },
  {
    id: 80,
    query: "art history",
    expected_filters: { subject: "ARTH" },
    expected_residual: "",
    invariants: { subject: "ARTH" },
    category: "structured",
    notes: "Punctuation-normalized official names should beat shorter subject aliases such as ART"
  },
  {
    id: 81,
    query: "electrical computer engineering",
    expected_filters: { subject: "ECE" },
    expected_residual: "",
    invariants: { subject: "ECE" },
    category: "structured"
  },
  {
    id: 82,
    query: "stats",
    expected_filters: { subject: "STAT" },
    expected_residual: "",
    invariants: { subject: "STAT" },
    category: "structured",
    notes: "Common student shorthand should be part of the subject alias corpus"
  },
  {
    id: 83,
    query: "psych",
    expected_filters: { subject: "PSYC" },
    expected_residual: "",
    invariants: { subject: "PSYC" },
    category: "structured"
  },
  {
    id: 84,
    query: "philosphy",
    expected_filters: { subject: "PHIL" },
    expected_residual: "",
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Common single-character typo should still resolve to the official subject"
  },
  {
    id: 85,
    query: "intro to philosphy",
    expected_filters: { subject: "PHIL" },
    expected_soft_preferences: { levelBoost: 100, introductoryIntent: "gateway" },
    expected_residual: "",
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Typo-tolerant subject aliases should participate in introductory gateway intent"
  },
  {
    id: 86,
    query: "computr science",
    expected_filters: { subject: "CS" },
    expected_residual: "",
    invariants: { subject: "CS" },
    category: "structured"
  },
  {
    id: 87,
    query: "politcal science",
    expected_filters: { subject: "PS" },
    expected_residual: "",
    invariants: { subject: "PS" },
    category: "structured"
  },
  {
    id: 88,
    query: "informaton sciences",
    expected_filters: { subject: "IS" },
    expected_residual: "",
    invariants: { subject: "IS" },
    category: "structured"
  },
  {
    id: 89,
    query: "art histry",
    expected_filters: { subject: "ARTH" },
    expected_residual: "",
    invariants: { subject: "ARTH" },
    category: "structured"
  },
  {
    id: 90,
    query: "organic chemstry",
    expected_filters: { subject: "CHEM" },
    expected_residual: "organic",
    invariants: { subject: "CHEM" },
    category: "semantic",
    notes: "Subject typo should become a hard subject filter while preserving topical residual"
  },
  {
    id: 91,
    query: "psycology",
    expected_filters: { subject: "PSYC" },
    expected_residual: "",
    invariants: { subject: "PSYC" },
    category: "structured"
  },
  {
    id: 92,
    query: "ai",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["artificial intelligence"] },
    expected_residual: "ai",
    category: "semantic",
    notes: "Acronym topics should expand into canonical search language"
  },
  {
    id: 93,
    query: "ai/ml",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["artificial intelligence", "machine learning"] },
    expected_residual: "ai/ml",
    category: "semantic",
    notes: "Punctuation-separated acronyms should be understood independently"
  },
  {
    id: 94,
    query: "artifical inteligence",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["artificial intelligence"] },
    expected_residual: "artifical inteligence",
    category: "semantic",
    notes: "Long typoed topic phrase should expand conservatively"
  },
  {
    id: 95,
    query: "machne learning",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["machine learning"] },
    expected_residual: "machne learning",
    category: "semantic"
  },
  {
    id: 96,
    query: "database systems",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["database"] },
    expected_residual: "database systems",
    category: "semantic"
  },
  {
    id: 97,
    query: "cyber security",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["cybersecurity"] },
    expected_residual: "cyber security",
    category: "semantic"
  },
  {
    id: 98,
    query: "human compter interaction",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["human computer interaction"] },
    expected_residual: "human compter interaction",
    category: "semantic"
  },
  {
    id: 99,
    query: "c++",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["c++ programming"] },
    expected_residual: "c++",
    category: "semantic"
  },
  {
    id: 100,
    query: "software development",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["software engineering"] },
    expected_residual: "software development",
    category: "semantic"
  },
];
