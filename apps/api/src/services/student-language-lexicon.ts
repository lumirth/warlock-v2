import {
  GENED_REQUIREMENT_OPTIONS,
  type SearchLevelFilter,
} from "@uiuc-course-search/query-types";
import type {
  SearchIntentKind,
  SearchPlanWarning,
  SearchPlanWarningKind,
  SearchSoftPreferences,
} from "./search-planner-types.js";

type StudentLanguageIntentRule = {
  queryTypes: SearchIntentKind[];
  patterns: RegExp[];
  removePatterns?: RegExp[];
  negativeTerms?: string[];
  softPreferences?: Partial<SearchSoftPreferences>;
  warnings?: SearchPlanWarning[];
};

type StudentShorthandRule = {
  pattern: RegExp;
  subject: string;
  expansion: string;
  confidence: number;
};

type ContextualRequirementRule = {
  code: string;
  pattern: RegExp;
  confidence: number;
};

type PositiveNoNotAlias = {
  pattern: RegExp;
  type: "workload";
  value: "easy";
} | {
  pattern: RegExp;
  type: "status";
  value: "open";
};

type StudentLanguageAliasKind =
  | "requirement"
  | "delivery"
  | "status"
  | "workload"
  | "days"
  | "time";

type StudentLanguageAliasEntry = {
  kind: StudentLanguageAliasKind;
  canonical: string;
  aliases: string[];
  requiresCue?: boolean;
};

export const REQUIREMENT_CUES = [
  "gen ed",
  "gened",
  "requirement",
  "gen-ed",
  "category",
];

const NON_REQUIREMENT_ALIAS_ENTRIES: StudentLanguageAliasEntry[] = [
  { kind: "time", canonical: "early", aliases: ["early morning", "early"] },
  { kind: "time", canonical: "morning", aliases: ["morning", "before noon", "before lunch"] },
  { kind: "time", canonical: "midday", aliases: ["midday", "mid day", "around noon"] },
  { kind: "time", canonical: "afternoon", aliases: ["afternoon", "after noon", "after lunch"] },
  { kind: "time", canonical: "evening", aliases: ["evening", "night", "after 5"] },
  { kind: "workload", canonical: "easy", aliases: ["easy", "simple", "chill", "low workload", "grade booster", "gpa booster", "easy a", "not hard"] },
  { kind: "workload", canonical: "hard", aliases: ["hard", "difficult", "challenging", "tough"] },
  { kind: "status", canonical: "open", aliases: ["open", "available", "has seats", "not full", "no waitlist"] },
  { kind: "status", canonical: "closed", aliases: ["closed", "full", "waitlist"] },
  { kind: "delivery", canonical: "true", aliases: ["online", "remote", "virtual", "asynchronous", "async"] },
  { kind: "delivery", canonical: "false", aliases: ["in person", "in-person", "on campus", "face to face"] },
  { kind: "days", canonical: "MWF", aliases: ["mwf", "monday wednesday friday", "mon wed fri", "m w f"] },
  { kind: "days", canonical: "TR", aliases: ["tr", "tuesday thursday", "tue thu", "tue thur", "t r", "tuth"] },
  { kind: "days", canonical: "MW", aliases: ["mw", "monday wednesday", "mon wed"] },
  { kind: "days", canonical: "WF", aliases: ["wf", "wednesday friday", "wed fri"] },
];

const DIRECT_REQUIREMENT_ALIAS_CODES = new Set([
  "HUM",
  "NAT",
  "SBS",
  "QR",
  "QR1",
  "QR2",
  "NW",
  "US",
  "WCC",
  "ACP",
]);

const DIRECT_REQUIREMENT_CODE_ONLY = new Set(["COMP1"]);

const EXPLICIT_AMBIGUOUS_REQUIREMENT_CODES = new Set(["CS", "PS"]);

const CUE_ONLY_REQUIREMENT_ALIASES: Readonly<Record<string, ReadonlySet<string>>> = {
  NAT: new Set(["science"]),
};

export const STUDENT_LANGUAGE_ALIAS_ENTRIES: StudentLanguageAliasEntry[] = [
  ...NON_REQUIREMENT_ALIAS_ENTRIES,
  ...buildRequirementAliasEntries(),
];

export const SUBJECT_REQUIREMENT_CONFLICTS = new Set(["CS", "PS"]);

export const FUZZY_SUBJECT_NAME_BLOCKLIST = new Set([
  "science",
  "sciences",
  "natural science",
  "natural sciences",
  "social science",
  "social sciences",
  "behavioral science",
  "behavioral sciences",
  "writing",
  "diversity",
  "culture",
  "cultural",
  "race",
  "ethnicity",
]);

export const LEVEL_KEYWORDS_HARD: Record<string, SearchLevelFilter> = {
  advanced: 400,
  upper: 400,
  graduate: 500,
  grad: 500,
};

export const LEVEL_KEYWORDS_SOFT: Record<string, SearchLevelFilter> = {
  intro: 100,
  introductory: 100,
  beginner: 100,
  freshman: 100,
  "first year": 100,
};

function buildRequirementAliasEntries(): StudentLanguageAliasEntry[] {
  return GENED_REQUIREMENT_OPTIONS.flatMap((option) => {
    const code = option.code.toLowerCase();
    const canonicalAliases = unique([code, option.label.toLowerCase(), ...option.aliases]);
    const entries: StudentLanguageAliasEntry[] = [{
      kind: "requirement",
      canonical: option.code,
      aliases: canonicalAliases,
      requiresCue: true,
    }];

    if (DIRECT_REQUIREMENT_ALIAS_CODES.has(option.code)) {
      entries.push({
        kind: "requirement",
        canonical: option.code,
        aliases: canonicalAliases.filter(
          (alias) => !CUE_ONLY_REQUIREMENT_ALIASES[option.code]?.has(alias),
        ),
      });
    } else if (DIRECT_REQUIREMENT_CODE_ONLY.has(option.code)) {
      entries.push({
        kind: "requirement",
        canonical: option.code,
        aliases: [code],
      });
    } else if (EXPLICIT_AMBIGUOUS_REQUIREMENT_CODES.has(option.code)) {
      entries.push({
        kind: "requirement",
        canonical: option.code,
        aliases: [
          `${code} requirement`,
          `${code} gen ed`,
          `${code} gened`,
        ],
      });
    }

    return entries;
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export const STOP_PHRASES = [
  "gen ed",
  "gened",
  "requirement",
  "gen-ed",
  "only",
  "booster",
  "count",
  "counts",
  "week",
  "weeks",
  "what should i take",
  "what can i take",
  "what is",
  "what's",
  "whats",
  "which is",
  "which are",
  "how is",
  "how are",
  "is",
  "are",
  "was",
  "were",
  "and",
  "but",
  "or",
  "that",
  "for",
  "with",
  "without",
  "no",
  "not",
  "avoid",
  "avoiding",
];

export const NEGATION_TARGET_STOP_WORDS = new Set([
  "and",
  "but",
  "or",
  "then",
  "with",
  "for",
  "that",
  "which",
  "who",
  "what",
  "class",
  "classes",
  "course",
  "courses",
  "gen",
  "ed",
  "requirement",
  "requirements",
]);

export const NEGATED_SUBJECT_ALIASES: Record<string, string> = {
  math: "MATH",
  mathematics: "MATH",
  calculus: "MATH",
  stats: "STAT",
  stat: "STAT",
  statistics: "STAT",
  "computer science": "CS",
  "comp sci": "CS",
  compsci: "CS",
  chem: "CHEM",
  chemistry: "CHEM",
  orgo: "CHEM",
  ochem: "CHEM",
  biology: "MCB",
  bio: "MCB",
  physics: "PHYS",
};

export const WORKLOAD_NEGATION_TERMS = new Set([
  "essay",
  "essays",
  "paper",
  "papers",
  "writing",
  "writing heavy",
  "writing-heavy",
  "reading",
  "reading heavy",
  "reading-heavy",
  "exam",
  "exams",
  "test",
  "tests",
  "lab",
  "labs",
  "coding",
  "programming",
  "group project",
  "group projects",
]);

export const STUDENT_SHORTHAND_RULES: StudentShorthandRule[] = [
  {
    pattern: /\b(?:orgo|ochem|organic\s+chem(?:istry)?)\b/gi,
    subject: "CHEM",
    expansion: "organic chemistry",
    confidence: 0.86,
  },
  {
    pattern: /\b(?:diff\s*eq|diffeq|differential\s+equations?)\b/gi,
    subject: "MATH",
    expansion: "differential equations",
    confidence: 0.84,
  },
  {
    pattern: /\b(?:compsci|comp\s+sci)\b/gi,
    subject: "CS",
    expansion: "computer science",
    confidence: 0.9,
  },
  {
    pattern: /\bmacroecon(?:omics)?\b/gi,
    subject: "ECON",
    expansion: "macroeconomics",
    confidence: 0.84,
  },
  {
    pattern: /\bmicroecon(?:omics)?\b/gi,
    subject: "ECON",
    expansion: "microeconomics",
    confidence: 0.84,
  },
];

export const CONTEXTUAL_REQUIREMENT_RULES: ContextualRequirementRule[] = [
  {
    code: "SBS",
    pattern: /\b(?:social\s+(?:and\s+behavioral\s+)?sciences?|behavioral\s+sciences?|social\s+science\s+(?:class|course|requirement|gen\s*-?\s*ed|requirement))\b/gi,
    confidence: 0.86,
  },
  {
    code: "NAT",
    pattern: /\b(?:natural\s+sciences?|nat\s+sci|science\s+(?:class|course|requirement|gen\s*-?\s*ed|requirement)|(?:easy|chill|need|counts?\s+for|fulfills?)\s+science)\b/gi,
    confidence: 0.84,
  },
  {
    code: "ACP",
    pattern: /\b(?:advanced\s+composition|adv\s+comp|writing\s+(?:requirement|intensive|gen\s*-?\s*ed|requirement))\b/gi,
    confidence: 0.86,
  },
  {
    code: "CS",
    pattern: /\b(?:cultural\s+studies|diversity|race\s+and\s+ethnicity|race|ethnicity|other\s+cultures|culture\s+class|cultural\s+requirement)\b/gi,
    confidence: 0.78,
  },
];

export const POSITIVE_NO_NOT_ALIASES: PositiveNoNotAlias[] = [
  { pattern: /\bnot\s+hard\b/gi, type: "workload", value: "easy" },
  { pattern: /\bnot\s+full\b/gi, type: "status", value: "open" },
  { pattern: /\bno\s+waitlist\b/gi, type: "status", value: "open" },
];

export const GENERIC_INTENT_PATTERNS = [
  /\bi\s+(?:need|want|am looking for|m looking for)\b/gi,
  /\b(?:need|want|looking for)\b/gi,
  /\b(?:a|an|the)\b/gi,
  /\b(?:does|this)\b/gi,
  /\bcounts?\s+for\b/gi,
  /\b(?:that|which)\s+counts?\b/gi,
  /\b(?:class|classes|course|courses)\b/gi,
  /\b(?:please|show me|find me)\b/gi,
];

export const REQUIREMENT_PATTERNS = [
  /\bgen\s*-?\s*ed\b/i,
  /\brequirements?\b/i,
  /\bcounts?\s+for\b/i,
  /\bthat\s+counts?\b/i,
  /\bcounts?\b/i,
  /\bfulfills?\b/i,
  /\bdouble\s+count/i,
  /\btwo\s+requirements?\b/i,
];

export const GENERIC_REQUIREMENT_PATTERNS = [
  /\bgen\s*-?\s*ed\b/i,
  /\bgened\b/i,
];

export const STUDENT_PROFILE_PATTERNS = [
  /\bcounts?\s+for\b/i,
  /\bcounts?\s+for\s+something\b/i,
  /\bthat\s+counts?\b/i,
  /\bdouble\s+count/i,
  /\btwo\s+requirements?\b/i,
  /\bwhat\s+(?:do\s+)?i\s+need\b/i,
  /\bwhat\s+(?:am\s+)?i\s+missing\b/i,
  /\bdegree\s+(?:audit|progress|requirements?)\b/i,
];

export const COMPARISON_PATTERNS = [
  /\blike\s+[A-Z]{2,4}\s*\d{3}\b/i,
  /\bsimilar\s+to\b/i,
];

export const COMPRESSED_TERM_PATTERNS = [
  /\b8\s*-?\s*week\b/i,
  /\beight\s*-?\s*week\b/i,
  /\bfirst\s+half\b/i,
  /\bsecond\s+half\b/i,
];

export const NON_MAJOR_PATTERNS = [
  /\bnon[-\s]?majors?\b/i,
  /\bfor\s+non[-\s]?majors?\b/i,
  /\bfreshman\b/i,
];

export const ASYNC_PATTERNS = [
  /\basync(?:hronous)?\b/i,
  /\bself[-\s]?paced\b/i,
];

export const STUDENT_LANGUAGE_INTENT_RULES: StudentLanguageIntentRule[] = [
  {
    queryTypes: ["avoidance", "subjective_vibe"],
    patterns: [/\bno\s+(?:essays?|papers?|writing)\b/i, /\bnot\s+writing\s+heavy\b/i, /\b(?:low|light|writing[-\s]+light)\s+writing\b/i, /\bwriting[-\s]+light\b/i],
    negativeTerms: ["writing_heavy", "essays", "papers"],
    softPreferences: { lowWriting: 0.9 },
    warnings: [warning("writing_evidence_incomplete", "Essay and writing workload evidence is incomplete for many courses.", 0.78)],
  },
  {
    queryTypes: ["avoidance", "subjective_vibe"],
    patterns: [/\bno\s+(?:exams?|tests?|midterms?|finals?)\b/i, /\blow\s+exam\b/i],
    negativeTerms: ["exam_heavy", "tests", "exams"],
    softPreferences: { lowExams: 0.88 },
    warnings: [warning("exam_evidence_incomplete", "Exam workload evidence usually comes from syllabi or student reports, not catalog text.", 0.74)],
  },
  {
    queryTypes: ["avoidance", "subjective_vibe"],
    patterns: [/\bnot\s+math(?:[-\s]+heavy)?\b/i, /\bno\s+math\b/i, /\bi\s+hate\s+math\b/i, /\blow\s+math\b/i],
    negativeTerms: ["math_heavy", "calculus", "statistics", "formal_logic", "quantitative"],
    softPreferences: { lowMath: 0.86 },
    warnings: [warning("math_risk_inferred", "Math-heavy risk is inferred from course language and requirements until syllabus evidence is available.", 0.72)],
  },
  {
    queryTypes: ["eligibility"],
    patterns: [/\bno\s+(?:listed\s+)?prereq(?:uisite)?s?\b/i, /\bwithout\s+prereq(?:uisite)?s?\b/i],
    negativeTerms: ["prerequisites", "restricted_access"],
    softPreferences: { noListedPrereq: true },
    warnings: [warning("prereq_evidence_incomplete", "Prerequisite and restriction text can be incomplete or term-specific.", 0.7)],
  },
  {
    queryTypes: ["subjective_vibe"],
    patterns: [/\b(?:easy|chill|gpa\s+booster|grade\s+booster|easy\s+a|low\s+workload)\b/i],
    softPreferences: { lowWorkload: 0.84 },
    warnings: [warning("workload_evidence_incomplete", "Workload is estimated from scores and available evidence, not guaranteed.", 0.72)],
  },
  {
    queryTypes: ["subjective_vibe"],
    patterns: [/\b(?:fun|interesting|cool)\b/i],
    softPreferences: { fun: 0.55 },
  },
  {
    queryTypes: ["avoidance"],
    patterns: [/\bless\s+bio(?:logy)?\b/i, /\bnot\s+bio(?:logy)?(?:[-\s]+heavy)?\b/i, /\bno\s+bio(?:logy)?\b/i],
    negativeTerms: ["biology_heavy", "bio"],
  },
  {
    queryTypes: ["avoidance"],
    patterns: [/\bno\s+group\s+projects?\b/i, /\bavoid\s+group\s+projects?\b/i],
    negativeTerms: ["group_projects"],
    warnings: [warning("workload_evidence_incomplete", "Group-project evidence usually requires syllabi or student reports.", 0.68)],
  },
  {
    queryTypes: ["subjective_vibe"],
    patterns: [/\blow\s+reading\b/i, /\bminimal\s+reading\b/i],
    negativeTerms: ["reading_heavy"],
    softPreferences: { lowReading: 0.78 },
    warnings: [warning("workload_evidence_incomplete", "Reading workload evidence is incomplete for many courses.", 0.68)],
  },
];

function warning(
  kind: SearchPlanWarningKind,
  message: string,
  confidence: number,
): SearchPlanWarning {
  return { kind, message, confidence };
}
