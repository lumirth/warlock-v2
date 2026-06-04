import type {
  DecisionQueryType,
  HintType,
  RetrievalLane,
  SearchPlanAssumption,
  SearchPlanWarning,
  SearchPlanWarningKind,
  SearchSoftPreferences,
} from "@uiuc-course-search/query-types/search-planner";

export type StudentLanguageRescueRule = {
  queryTypes: DecisionQueryType[];
  patterns: RegExp[];
  removePatterns?: RegExp[];
  negativeTerms?: string[];
  softPreferences?: Partial<SearchSoftPreferences>;
  assumptions?: SearchPlanAssumption[];
  warnings?: SearchPlanWarning[];
};

export type StudentShorthandRule = {
  pattern: RegExp;
  subject: string;
  expansion: string;
  confidence: number;
};

export type ContextualGenedRule = {
  code: string;
  pattern: RegExp;
  confidence: number;
};

export type PositiveNoNotAlias = {
  pattern: RegExp;
  type: Extract<HintType, "difficulty" | "status">;
  value: "easy" | "open";
};

export type StudentLanguageAliasKind =
  | "gened"
  | "delivery"
  | "status"
  | "difficulty"
  | "days"
  | "time";

export type StudentLanguageAliasEntry = {
  kind: StudentLanguageAliasKind;
  canonical: string;
  aliases: string[];
  requiresCue?: boolean;
};

export const GENED_CUES = [
  "gen ed",
  "gened",
  "gen-ed",
  "requirement",
  "category",
];

export const STUDENT_LANGUAGE_ALIAS_ENTRIES: StudentLanguageAliasEntry[] = [
  { kind: "time", canonical: "early", aliases: ["early morning", "early"] },
  { kind: "time", canonical: "morning", aliases: ["morning", "before noon", "before lunch"] },
  { kind: "time", canonical: "midday", aliases: ["midday", "mid day", "around noon"] },
  { kind: "time", canonical: "afternoon", aliases: ["afternoon", "after noon", "after lunch"] },
  { kind: "time", canonical: "evening", aliases: ["evening", "night", "after 5"] },
  { kind: "difficulty", canonical: "easy", aliases: ["easy", "simple", "chill", "low workload", "grade booster", "gpa booster", "easy a", "not hard"] },
  { kind: "difficulty", canonical: "hard", aliases: ["hard", "difficult", "challenging", "tough"] },
  { kind: "status", canonical: "open", aliases: ["open", "available", "has seats", "not full", "no waitlist"] },
  { kind: "status", canonical: "closed", aliases: ["closed", "full", "waitlist"] },
  { kind: "delivery", canonical: "true", aliases: ["online", "remote", "virtual", "asynchronous", "async"] },
  { kind: "delivery", canonical: "false", aliases: ["in person", "in-person", "on campus", "face to face"] },
  { kind: "days", canonical: "MWF", aliases: ["mwf", "monday wednesday friday", "mon wed fri", "m w f"] },
  { kind: "days", canonical: "TR", aliases: ["tr", "tuesday thursday", "tue thu", "tue thur", "t r", "tuth"] },
  { kind: "days", canonical: "MW", aliases: ["mw", "monday wednesday", "mon wed"] },
  { kind: "days", canonical: "WF", aliases: ["wf", "wednesday friday", "wed fri"] },
  { kind: "gened", canonical: "HUM", aliases: ["humanities", "humanities and the arts", "arts"], requiresCue: true },
  { kind: "gened", canonical: "NAT", aliases: ["natural sciences", "nat sci", "science"], requiresCue: true },
  { kind: "gened", canonical: "PS", aliases: ["physical sciences", "physical"], requiresCue: true },
  { kind: "gened", canonical: "SBS", aliases: ["social sciences", "behavioral sciences", "social and behavioral"], requiresCue: true },
  { kind: "gened", canonical: "CS", aliases: ["cultural studies"], requiresCue: true },
  { kind: "gened", canonical: "QR", aliases: ["quantitative reasoning", "quantitative", "quant"], requiresCue: true },
  { kind: "gened", canonical: "NW", aliases: ["non western", "non-western", "nonwestern"], requiresCue: true },
  { kind: "gened", canonical: "US", aliases: ["us minority", "minority cultures"], requiresCue: true },
  { kind: "gened", canonical: "WCC", aliases: ["western comparative", "western"], requiresCue: true },
  { kind: "gened", canonical: "ACP", aliases: ["advanced composition", "adv comp", "writing intensive"], requiresCue: true },
  { kind: "gened", canonical: "HUM", aliases: ["hum", "humanities", "humanities and the arts"] },
  { kind: "gened", canonical: "NAT", aliases: ["nat", "nat sci", "natural sciences"] },
  { kind: "gened", canonical: "PS", aliases: ["ps gened", "ps gen ed", "physical sciences"] },
  { kind: "gened", canonical: "SBS", aliases: ["sbs", "social sciences", "behavioral sciences", "social and behavioral"] },
  { kind: "gened", canonical: "CS", aliases: ["cs gened", "cs gen ed", "cultural studies"] },
  { kind: "gened", canonical: "QR", aliases: ["qr", "quantitative reasoning"] },
  { kind: "gened", canonical: "QR1", aliases: ["qr1", "qr 1"] },
  { kind: "gened", canonical: "QR2", aliases: ["qr2", "qr 2"] },
  { kind: "gened", canonical: "NW", aliases: ["nw", "non western", "non-western"] },
  { kind: "gened", canonical: "US", aliases: ["us minority", "minority cultures"] },
  { kind: "gened", canonical: "WCC", aliases: ["wcc", "western comparative"] },
  { kind: "gened", canonical: "ACP", aliases: ["acp", "advanced composition", "writing intensive"] },
];

export const GENED_SYNONYMS: Record<string, string[]> = {
  CMP: ["comp 1", "composition", "writing", "rhet 105", "freshman comp", "comp1"],
  ACP: ["adv comp", "advanced composition", "advanced comp", "writing intensive", "cll"],
  HUM: ["humanities", "humanities and the arts", "arts"],
  HP: ["historical", "philosophical", "history", "philosophy", "historical perspectives"],
  LA: ["literature", "lit", "literature and the arts"],
  NAT: ["nat sci", "natural sciences", "science", "natural sciences and technology"],
  PS: ["physical sciences", "physical"],
  LS: ["life sciences", "life sci", "bio", "biology"],
  SBS: ["social science", "behavioral science", "social and behavioral", "social", "behavioral"],
  SS: ["soc sci"],
  BSC: ["psych", "psychology"],
  CS: ["cultural studies", "cultural"],
  NW: ["non-western", "non western", "nonwestern"],
  US: ["us minority", "minority cultures", "us minority cultures"],
  WCC: ["western", "comparative", "western comparative"],
  QR: ["quantitative", "quant", "quantitative reasoning"],
  QR1: ["qr1", "qr 1", "quant 1", "quantitative reasoning 1", "qri"],
  QR2: ["qr2", "qr 2", "quant 2", "quantitative reasoning 2", "qrii"],
};

export const GENED_LOOKUP: Record<string, string> = Object.entries(
  GENED_SYNONYMS,
).reduce<Record<string, string>>((lookup, [code, synonyms]) => {
  lookup[code.toLowerCase()] = code;
  for (const synonym of synonyms) {
    lookup[synonym.toLowerCase()] = code;
  }
  return lookup;
}, {});

export const SUBJECT_GENED_CONFLICTS = new Set(["CS", "PS"]);

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

export const LEVEL_KEYWORDS_HARD: Record<string, number> = {
  advanced: 400,
  upper: 400,
  graduate: 500,
  grad: 500,
};

export const LEVEL_KEYWORDS_SOFT: Record<string, number> = {
  intro: 100,
  introductory: 100,
  beginner: 100,
  freshman: 100,
  "first year": 100,
};

export const STOP_PHRASES = [
  "gen ed",
  "gened",
  "gen-ed",
  "section",
  "sections",
  "class",
  "classes",
  "course",
  "courses",
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
  "gened",
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

export const CONTEXTUAL_GENED_RULES: ContextualGenedRule[] = [
  {
    code: "SBS",
    pattern: /\b(?:social\s+(?:and\s+behavioral\s+)?sciences?|behavioral\s+sciences?|social\s+science\s+(?:class|course|requirement|gen\s*-?\s*ed|gened))\b/gi,
    confidence: 0.86,
  },
  {
    code: "NAT",
    pattern: /\b(?:natural\s+sciences?|nat\s+sci|science\s+(?:class|course|requirement|gen\s*-?\s*ed|gened)|(?:easy|chill|need|counts?\s+for|fulfills?)\s+science)\b/gi,
    confidence: 0.84,
  },
  {
    code: "ACP",
    pattern: /\b(?:advanced\s+composition|adv\s+comp|writing\s+(?:requirement|intensive|gen\s*-?\s*ed|gened))\b/gi,
    confidence: 0.86,
  },
  {
    code: "CS",
    pattern: /\b(?:cultural\s+studies|diversity|race\s+and\s+ethnicity|race|ethnicity|other\s+cultures|culture\s+class|cultural\s+requirement)\b/gi,
    confidence: 0.78,
  },
];

export const POSITIVE_NO_NOT_ALIASES: PositiveNoNotAlias[] = [
  { pattern: /\bnot\s+hard\b/gi, type: "difficulty", value: "easy" },
  { pattern: /\bnot\s+full\b/gi, type: "status", value: "open" },
  { pattern: /\bno\s+waitlist\b/gi, type: "status", value: "open" },
];

export const GENERIC_DECISION_PATTERNS = [
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

export const GENERIC_GENED_PATTERNS = [
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

export const HELP_PATTERNS = [
  /\bhow\s+do\s+i\b/i,
  /\bwhat\s+should\s+i\s+take\b/i,
  /\bhow\s+to\b/i,
  /\bhelp\b/i,
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

export const STUDENT_LANGUAGE_RESCUE_RULES: StudentLanguageRescueRule[] = [
  {
    queryTypes: ["avoidance", "subjective_vibe"],
    patterns: [/\bno\s+(?:essays?|papers?|writing)\b/i, /\bnot\s+writing\s+heavy\b/i, /\b(?:low|light|writing[-\s]+light)\s+writing\b/i, /\bwriting[-\s]+light\b/i],
    negativeTerms: ["writing_heavy", "essays", "papers"],
    softPreferences: { lowWriting: 0.9 },
    assumptions: [assumption("low_writing", "Low writing preferred", 0.82)],
    warnings: [warning("writing_evidence_incomplete", "Essay and writing workload evidence is incomplete for many courses.", 0.78)],
  },
  {
    queryTypes: ["avoidance", "subjective_vibe"],
    patterns: [/\bno\s+(?:exams?|tests?|midterms?|finals?)\b/i, /\blow\s+exam\b/i],
    negativeTerms: ["exam_heavy", "tests", "exams"],
    softPreferences: { lowExams: 0.88 },
    assumptions: [assumption("low_exams", "Low exam load preferred", 0.78)],
    warnings: [warning("exam_evidence_incomplete", "Exam workload evidence usually comes from syllabi or student reports, not catalog text.", 0.74)],
  },
  {
    queryTypes: ["avoidance", "subjective_vibe"],
    patterns: [/\bnot\s+math(?:[-\s]+heavy)?\b/i, /\bno\s+math\b/i, /\bi\s+hate\s+math\b/i, /\blow\s+math\b/i],
    negativeTerms: ["math_heavy", "calculus", "statistics", "formal_logic", "quantitative"],
    softPreferences: { lowMath: 0.86 },
    assumptions: [assumption("low_math", "Avoid math-heavy courses", 0.78)],
    warnings: [warning("math_risk_inferred", "Math-heavy risk is inferred from course language and requirements until syllabus evidence is available.", 0.72)],
  },
  {
    queryTypes: ["eligibility"],
    patterns: [/\bno\s+(?:listed\s+)?prereq(?:uisite)?s?\b/i, /\bwithout\s+prereq(?:uisite)?s?\b/i],
    negativeTerms: ["prerequisites", "restricted_access"],
    softPreferences: { noListedPrereq: true },
    assumptions: [assumption("no_listed_prereq", "No listed prerequisite preferred", 0.82)],
    warnings: [warning("prereq_evidence_incomplete", "Prerequisite and restriction text can be incomplete or term-specific.", 0.7)],
  },
  {
    queryTypes: ["subjective_vibe"],
    patterns: [/\b(?:easy|chill|gpa\s+booster|grade\s+booster|easy\s+a|low\s+workload)\b/i],
    softPreferences: { lowWorkload: 0.84 },
    assumptions: [assumption("low_workload", "Low workload preferred", 0.82)],
    warnings: [warning("workload_evidence_incomplete", "Workload is estimated from scores and available evidence, not guaranteed.", 0.72)],
  },
  {
    queryTypes: ["subjective_vibe"],
    patterns: [/\b(?:fun|interesting|cool)\b/i],
    softPreferences: { fun: 0.55 },
    assumptions: [assumption("fun_or_interesting", "Fun or interesting topic preferred", 0.52)],
  },
  {
    queryTypes: ["avoidance"],
    patterns: [/\bless\s+bio(?:logy)?\b/i, /\bnot\s+bio(?:logy)?(?:[-\s]+heavy)?\b/i, /\bno\s+bio(?:logy)?\b/i],
    negativeTerms: ["biology_heavy", "bio"],
    softPreferences: { lowBiology: 0.72 },
    assumptions: [assumption("low_biology", "Avoid biology-heavy courses", 0.68)],
  },
  {
    queryTypes: ["avoidance"],
    patterns: [/\bno\s+group\s+projects?\b/i, /\bavoid\s+group\s+projects?\b/i],
    negativeTerms: ["group_projects"],
    softPreferences: { lowGroupWork: 0.8 },
    assumptions: [assumption("avoid_group_projects", "Avoid group projects", 0.76)],
    warnings: [warning("workload_evidence_incomplete", "Group-project evidence usually requires syllabi or student reports.", 0.68)],
  },
  {
    queryTypes: ["subjective_vibe"],
    patterns: [/\blow\s+reading\b/i, /\bminimal\s+reading\b/i],
    negativeTerms: ["reading_heavy"],
    softPreferences: { lowReading: 0.78 },
    assumptions: [assumption("low_reading", "Low reading load preferred", 0.72)],
    warnings: [warning("workload_evidence_incomplete", "Reading workload evidence is incomplete for many courses.", 0.68)],
  },
];

export function lanesForDecisionQueryTypes(
  queryTypes: Set<DecisionQueryType>,
): RetrievalLane[] {
  const lanes = new Set<RetrievalLane>();
  if (queryTypes.has("exact_course")) lanes.add("exact");
  if (queryTypes.has("topic") || queryTypes.has("requirement") || queryTypes.has("comparison")) lanes.add("official_text");
  if (queryTypes.has("requirement") || queryTypes.has("degree_progress")) lanes.add("requirement");
  if (queryTypes.has("schedule")) lanes.add("structured_section");
  if (queryTypes.has("subjective_vibe") || queryTypes.has("avoidance")) lanes.add("student_language_alias");
  if (queryTypes.has("topic") || queryTypes.has("comparison")) lanes.add("topic_semantic");
  if (queryTypes.has("subjective_vibe") || queryTypes.has("avoidance") || queryTypes.has("eligibility")) lanes.add("workload_evidence");
  if (queryTypes.has("help_or_how_to") || queryTypes.has("degree_progress")) lanes.add("help_path");
  return Array.from(lanes);
}

function assumption(kind: string, label: string, confidence: number): SearchPlanAssumption {
  return { kind, label, confidence, source: "rule" };
}

function warning(
  kind: SearchPlanWarningKind,
  message: string,
  confidence: number,
): SearchPlanWarning {
  return { kind, message, confidence };
}
