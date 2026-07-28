import { GENERIC_REQUIREMENT_CODES } from '@uiuc-course-search/query-types';
import type { GoldQuery } from './types.js';
import {
  anyRequirement,
  requirement,
} from './golden-query-builders.js';

export const LONG_TAIL_GOLDEN_QUERIES: GoldQuery[] = [
  {
    id: 57,
    query: "partOfTerm:A CS",
    expected_filters: { partOfTerm: "A", subject: "CS" },
    invariants: { subject: "CS" },
    category: "power_syntax"
  },
  {
    id: 58,
    query: 'subject:CS "machine learning"',
    expected_filters: { subject: "CS" },
    invariants: { subject: "CS" },
    category: "power_syntax"
  },
  {
    id: 59,
    query: "professor fagen",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    category: "instructor",
    notes: "Lowercase professor-name search should become an instructor hard filter"
  },
  {
    id: 60,
    query: "prof fagen-ulmschneider",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    category: "instructor",
    notes: "Hyphenated professor names should resolve as instructor filters"
  },
  {
    id: 61,
    query: "taught by wade fagen algorithms",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    category: "instructor",
    notes: "Instructor phrase should be removed while topical residual remains"
  },
  {
    id: 62,
    query: "CS 225 professor fagen",
    expected_filters: { subject: "CS", number: "225" },
    expected_filter_keys: ["instructor_ids"],
    invariants: { subject: "CS" },
    category: "instructor"
  },
  {
    id: 63,
    query: "with O'Brien",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    category: "instructor",
    notes: "Apostrophes in instructor names should be preserved"
  },
  {
    id: 64,
    query: "with Liu-Prasad",
    expected_filters: {},
    category: "instructor",
    notes: "Hyphenated instructor names should be preserved without broadening absent names to unrelated first-token matches"
  },
  {
    id: 65,
    query: "hard CS class",
    expected_filters: { subject: "CS" },
    invariants: { subject: "CS" },
    category: "score",
    notes: "Subjective language remains searchable and does not imply instructor difficulty"
  },
  {
    id: 66,
    query: "easy 3 credit humanities",
    expected_filters: { credits: 3, requirement: requirement("HUM") },
    category: "score"
  },
  {
    id: 67,
    query: "online MWF morning open",
    expected_filters: { online: true, days: "MWF", time: "morning", status: "open" },
    category: "schedule"
  },
  {
    id: 68,
    query: "in person no friday afternoon",
    expected_filters: { online: false, time: "afternoon", not: { days: ["friday"] } },
    category: "schedule"
  },
  {
    id: 69,
    query: "spring 2026 professor fagen open",
    expected_filters: { term: "spring", year: 2026, status: "open" },
    expected_filter_keys: ["instructor_ids"],
    category: "instructor"
  },
  {
    id: 70,
    query: "sort by instructor difficulty",
    expected_filters: {},
    expected_soft_preferences: { inferredSort: { field: "instructor_difficulty", direction: "asc" } },
    expected_results: { non_empty: true, top_k: 10 },
    category: "semantic",
    notes: "Generic sort commands should become ranking controls, not keyword text"
  },
  {
    id: 71,
    query: "professor fagen algorithms",
    expected_filters: {},
    expected_filter_keys: ["instructor_ids"],
    category: "instructor",
    notes: "Short professor-name searches should not absorb trailing topic terms into the instructor name"
  },
  {
    id: 72,
    query: "intro to CS",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { levelBoost: 100 },
    expected_top1_title: "Introduction to Computer Science I",
    invariants: { subject: "CS" },
    category: "structured",
    notes: "Generic intro-subject queries should become gateway-course intent instead of matching upper-level Introduction-to-X titles"
  },
  {
    id: 73,
    query: "intro to comp sci",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { levelBoost: 100 },
    expected_top1_title: "Introduction to Computer Science I",
    invariants: { subject: "CS" },
    category: "structured",
    notes: "Common department nickname should normalize to CS before introductory intent is applied"
  },
  {
    id: 74,
    query: "intro computer science",
    expected_filters: { subject: "CS" },
    expected_soft_preferences: { levelBoost: 100 },
    expected_top1_title: "Introduction to Computer Science I",
    invariants: { subject: "CS" },
    category: "structured"
  },
  {
    id: 75,
    query: "intro to compilers",
    expected_filters: {},
    expected_soft_preferences: { levelBoost: 100 },
    expected_results: {
      non_empty: true,
      top_k: 10,
      must_include: [{ titleIncludes: "Compiler" }]
    },
    category: "semantic",
    notes: "Introductory gateway intent requires a subject or explicit subject override; topic searches stay topical"
  },
  {
    id: 76,
    query: "philosophy",
    expected_filters: { subject: "PHIL" },
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Official subject names should resolve as subject filters, not loose topical text"
  },
  {
    id: 77,
    query: "intro to philosophy",
    expected_filters: { subject: "PHIL" },
    expected_soft_preferences: { levelBoost: 100 },
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Introductory gateway intent should work across official subject names, not only CS aliases"
  },
  {
    id: 78,
    query: "political science",
    expected_filters: { subject: "PS" },
    invariants: { subject: "PS" },
    category: "structured"
  },
  {
    id: 79,
    query: "information sciences",
    expected_filters: { subject: "IS" },
    invariants: { subject: "IS" },
    category: "structured",
    notes: "Unsafe lowercase code IS should still be reachable through its official full name"
  },
  {
    id: 80,
    query: "art history",
    expected_filters: { subject: "ARTH" },
    invariants: { subject: "ARTH" },
    category: "structured",
    notes: "Punctuation-normalized official names should beat shorter subject aliases such as ART"
  },
  {
    id: 81,
    query: "electrical computer engineering",
    expected_filters: { subject: "ECE" },
    invariants: { subject: "ECE" },
    category: "structured"
  },
  {
    id: 82,
    query: "stats",
    expected_filters: { subject: "STAT" },
    invariants: { subject: "STAT" },
    category: "structured",
    notes: "Common student shorthand should be part of the subject alias corpus"
  },
  {
    id: 83,
    query: "psych",
    expected_filters: { subject: "PSYC" },
    invariants: { subject: "PSYC" },
    category: "structured"
  },
  {
    id: 84,
    query: "philosphy",
    expected_filters: { subject: "PHIL" },
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Common single-character typo should still resolve to the official subject"
  },
  {
    id: 85,
    query: "intro to philosphy",
    expected_filters: { subject: "PHIL" },
    expected_soft_preferences: { levelBoost: 100 },
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Typo-tolerant subject aliases should participate in introductory gateway intent"
  },
  {
    id: 86,
    query: "computr science",
    expected_filters: { subject: "CS" },
    invariants: { subject: "CS" },
    category: "structured"
  },
  {
    id: 87,
    query: "politcal science",
    expected_filters: { subject: "PS" },
    invariants: { subject: "PS" },
    category: "structured"
  },
  {
    id: 88,
    query: "informaton sciences",
    expected_filters: { subject: "IS" },
    invariants: { subject: "IS" },
    category: "structured"
  },
  {
    id: 89,
    query: "art histry",
    expected_filters: { subject: "ARTH" },
    invariants: { subject: "ARTH" },
    category: "structured"
  },
  {
    id: 90,
    query: "organic chemstry",
    expected_filters: { subject: "CHEM" },
    invariants: { subject: "CHEM" },
    category: "semantic",
    notes: "Subject typo should become a hard subject filter while preserving topical residual"
  },
  {
    id: 91,
    query: "psycology",
    expected_filters: { subject: "PSYC" },
    invariants: { subject: "PSYC" },
    category: "structured"
  },
  {
    id: 92,
    query: "ai",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["artificial intelligence"] },
    category: "semantic",
    notes: "Acronym topics should expand into canonical search language"
  },
  {
    id: 93,
    query: "ai/ml",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["artificial intelligence", "machine learning"] },
    category: "semantic",
    notes: "Punctuation-separated acronyms should be understood independently"
  },
  {
    id: 94,
    query: "artifical inteligence",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["artificial intelligence"] },
    category: "semantic",
    notes: "Long typoed topic phrase should expand conservatively"
  },
  {
    id: 95,
    query: "machne learning",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["machine learning"] },
    category: "semantic"
  },
  {
    id: 96,
    query: "database systems",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["database"] },
    category: "semantic"
  },
  {
    id: 97,
    query: "cyber security",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["cybersecurity"] },
    category: "semantic"
  },
  {
    id: 98,
    query: "human compter interaction",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["human computer interaction"] },
    category: "semantic"
  },
  {
    id: 99,
    query: "c++",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["c++ programming"] },
    category: "semantic"
  },
  {
    id: 100,
    query: "software development",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["software engineering"] },
    category: "semantic"
  },
  {
    id: 101,
    query: "philospohy",
    expected_filters: { subject: "PHIL" },
    invariants: { subject: "PHIL" },
    category: "structured",
    notes: "Common adjacent-letter swaps in official subject names should resolve as subject filters"
  },
  {
    id: 102,
    query: "easy online gen ed",
    expected_filters: {
      online: true,
      requirement: anyRequirement(GENERIC_REQUIREMENT_CODES)
    },
    expected_intent: {
      queryTypes: ["requirement", "schedule", "topic"],
    },
    category: "decision"
  },
  {
    id: 103,
    query: "easy cs gened",
    expected_filters: {
      requirement: requirement("CS")
    },
    expected_intent: {
      queryTypes: ["requirement", "topic"],
    },
    category: "decision",
    notes: "CS plus GenEd language should mean the Cultural Studies requirement, not the Computer Science subject"
  },
  {
    id: 114,
    query: "easy cs",
    expected_filters: {
      subject: "CS"
    },
    expected_intent: {
      queryTypes: ["topic"],
    },
    category: "disambiguation",
    notes: "Subjective language stays searchable and does not change the CS subject meaning"
  },
  {
    id: 104,
    query: "class about movies no essays",
    expected_filters: {},
    expected_soft_preferences: { lowWriting: 0.9, topicExpansions: ["film cinema media documentary television pop culture visual culture"] },
    expected_intent: {
      queryTypes: ["topic", "subjective_vibe", "avoidance"],
      negativeTerms: ["writing_heavy", "essays", "papers"],
      warnings: ["writing_evidence_incomplete"],
    },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { level_lte: 500 }
    },
    category: "decision"
  },
  {
    id: 105,
    query: "not math but counts for science",
    expected_filters: { requirement: requirement("NAT"), not: { subjects: ["MATH"] } },
    expected_soft_preferences: { lowMath: 0.86 },
    expected_intent: {
      queryTypes: ["requirement", "avoidance", "subjective_vibe", "degree_progress"],
      negativeTerms: ["math_heavy", "calculus", "statistics", "formal_logic", "quantitative"],
      warnings: ["math_risk_inferred", "student_profile_required"],
    },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { no_subjects: ["MATH"], level_lte: 400 },
      max_graduate_top_k: 0
    },
    category: "decision"
  },
  {
    id: 106,
    query: "chill 3 credit class after 2pm",
    expected_filters: { credits: 3, startAfterMinutes: 840 },
    expected_intent: {
      queryTypes: ["schedule", "topic"],
    },
    category: "decision"
  },
  {
    id: 107,
    query: "does this count for humanities",
    expected_filters: { requirement: requirement("HUM") },
    expected_intent: {
      queryTypes: ["requirement", "degree_progress"],
      warnings: ["student_profile_required"],
    },
    category: "decision"
  },
  {
    id: 108,
    query: "psych but less bio",
    expected_filters: { subject: "PSYC" },
    expected_intent: {
      queryTypes: ["avoidance"],
      negativeTerms: ["biology_heavy", "bio"],
    },
    category: "decision"
  },
  {
    id: 109,
    query: "no prereq writing-light class",
    expected_filters: {},
    expected_soft_preferences: { noListedPrereq: true, lowWriting: 0.9 },
    expected_intent: {
      queryTypes: ["eligibility", "subjective_vibe", "avoidance"],
      negativeTerms: ["prerequisites", "restricted_access", "writing_heavy", "essays", "papers"],
      warnings: ["prereq_evidence_incomplete", "writing_evidence_incomplete"],
    },
    category: "decision"
  },
  {
    id: 110,
    query: "easy US minority no tests",
    expected_filters: { requirement: requirement("US") },
    expected_intent: {
      queryTypes: ["avoidance", "subjective_vibe", "requirement", "topic"],
      negativeTerms: ["exam_heavy", "tests", "exams"],
      warnings: ["exam_evidence_incomplete"],
    },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { requirement: "US", level_lte: 400 },
      max_graduate_top_k: 0
    },
    category: "decision"
  },
  {
    id: 111,
    query: "online 8 week class that counts",
    expected_filters: { online: true, compressedTerm: true },
    expected_intent: {
      queryTypes: ["requirement", "schedule", "degree_progress"],
      warnings: ["student_profile_required"],
    },
    category: "decision"
  },
  {
    id: 112,
    query: "online us minority no exams no essays 8 week",
    expected_filters: { online: true, requirement: requirement("US"), compressedTerm: true },
    expected_soft_preferences: { lowWriting: 0.9, lowExams: 0.88 },
    expected_intent: {
      queryTypes: ["requirement", "schedule", "subjective_vibe", "avoidance"],
      negativeTerms: ["writing_heavy", "essays", "papers", "exam_heavy", "tests", "exams"],
      warnings: ["writing_evidence_incomplete", "exam_evidence_incomplete"],
    },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { requirement: "US", level_lte: 400 },
      max_graduate_top_k: 0
    },
    category: "decision"
  },
  {
    id: 113,
    query: "campus urbana movies",
    expected_filters: {},
    expected_soft_preferences: { topicExpansions: ["film cinema media documentary television pop culture visual culture"] },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { level_lte: 500 }
    },
    category: "unsupported_language",
    notes: "Unsupported campus-scope language remains searchable while the topic still expands"
  },
  {
    id: 115,
    query: "easy science but no math",
    expected_filters: { not: { subjects: ["MATH"] } },
    expected_soft_preferences: { lowMath: 0.86 },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { no_subjects: ["MATH"], level_lte: 400 },
      max_graduate_top_k: 0
    },
    category: "decision",
    notes: "General negation plus cue-less science requirement mapping"
  },
  {
    id: 116,
    query: "social science class",
    expected_filters: { requirement: requirement("SBS") },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { requirement: "SBS", level_lte: 400 }
    },
    category: "structured",
    notes: "Cue-less social science should map to Social & Behavioral Sciences"
  },
  {
    id: 117,
    query: "diversity",
    expected_filters: { requirement: requirement("CS") },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { requirement: "CS", level_lte: 400 }
    },
    category: "structured",
    notes: "Student diversity language maps to the broader Cultural Studies bucket"
  },
  {
    id: 123,
    query: "non western",
    expected_filters: { requirement: requirement("NW") },
    expected_results: {
      non_empty: true,
      top_k: 10,
      all_top_k: { requirement: "NW", level_lte: 400 }
    },
    category: "structured",
    notes: "Canonical student-facing NW should match source attribute_code=1NW rows"
  },
  {
    id: 118,
    query: "is cs 225 hard",
    expected_filters: { subject: "CS", number: "225" },
    expected_results: {
      non_empty: true,
      top_k: 3,
      must_include: [{ subject: "CS", number: "225", titleIncludes: "Data Structures" }]
    },
    category: "edge_case_punctuation",
    notes: "Question-form difficulty words should not become a hard difficulty filter"
  },
  {
    id: 119,
    query: "what's an easy gen ed",
    expected_filters: {
      requirement: anyRequirement(GENERIC_REQUIREMENT_CODES)
    },
    expected_results: {
      non_empty: true,
      top_k: 10,
      max_graduate_top_k: 0
    },
    category: "edge_case_punctuation",
    notes: "Apostrophes must not crash FTS or leak question words"
  },
  {
    id: 120,
    query: "orgo",
    expected_filters: { subject: "CHEM" },
    expected_results: {
      non_empty: true,
      top_k: 10,
      must_include: [{ subject: "CHEM", titleIncludes: "Organic" }],
      all_top_k: { subjects: ["CHEM"] }
    },
    category: "semantic",
    notes: "Maintained student shorthand should route to Chemistry plus organic topic text"
  },
  {
    id: 121,
    query: "diffeq",
    expected_filters: { subject: "MATH" },
    expected_results: {
      non_empty: true,
      top_k: 10,
      must_include: [{ subject: "MATH", titleIncludes: "Differential" }],
      all_top_k: { subjects: ["MATH"] }
    },
    category: "semantic",
    notes: "Maintained student shorthand should route to Math plus differential-equations topic text"
  },
  {
    id: 122,
    query: "physics for non majors",
    expected_filters: { subject: "PHYS" },
    expected_soft_preferences: { nonMajorFriendly: 0.72 },
    expected_results: {
      non_empty: true,
      top_k: 10,
      must_include: [{ subject: "PHYS", number: "100" }],
      max_graduate_top_k: 1
    },
    category: "decision",
    notes: "Soft non-major-friendly intent must affect ranking, not just plan decoration"
  },
];
