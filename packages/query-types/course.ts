export type CourseInstructorDto = {
  name: string;
  rmpRating: number | null;
  rmpDifficulty: number | null;
  rmpUrl?: string | null;
  rmpSearchUrl?: string | null;
  avgGpa: number | null;
  gpaSampleSize: number | null;
  numRatings: number | null;
  wouldTakeAgainPct: number | null;
};

export type CourseSectionMeetingDto = {
  typeCode: string | null;
  typeName: string | null;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  buildingName: string | null;
  roomNumber: string | null;
  dateRangeText: string | null;
  instructors: CourseInstructorDto[];
};

export type CourseSectionAvailabilityStatus =
  | "open"
  | "restricted"
  | "waitlisted"
  | "closed"
  | "cancelled"
  | "unknown";

export type CourseSectionAvailabilityDto = {
  status: CourseSectionAvailabilityStatus;
  label: string;
  statusCode: string | null;
  sectionStatusCode: string | null;
};

export type CourseSectionDto = {
  crn: string;
  sectionNumber: string;
  availability: CourseSectionAvailabilityDto;
  schedule: {
    type: string;
    days: string | null;
    startTime: string | null;
    endTime: string | null;
    location: string;
    dateRangeText: string | null;
    partOfTerm: string | null;
    startDate: string | null;
    endDate: string | null;
    creditHours: string | null;
    meetings: CourseSectionMeetingDto[];
  };
  instructors: CourseInstructorDto[];
  sourceFacts: {
    sectionTitle: string | null;
    sectionText: string | null;
    sectionNotes: string | null;
    cappArea: string | null;
  };
  links: { courseExplorerUrl?: string };
};

export type CourseRequirementDto = {
  categoryId: string;
  categoryName: string | null;
  attributeCode: string | null;
  attributeName: string | null;
};

export type ResultWarning = { kind: "historical"; message: string };
export type CourseRegistrationSummaryDto = {
  total: number;
  open: number;
  restricted: number;
  waitlisted: number;
  closed: number;
  cancelled: number;
  lastSynced: number | null;
};

export type CourseSummaryDto = {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  creditHours: number | null;
  creditHoursText: string | null;
  year: number;
  term: string;
  primaryInstructor: string | null;
  metrics: {
    primaryInstructorRating: number | null;
    avgGpa: number | null;
    gpaSampleSize: number | null;
    qualityScore: number | null;
    instructorDifficultyScore: number | null;
  };
  catalog: { courseInfo: string | null; degreeAttributes: string | null };
  scheduleNotes: { classScheduleInfo: string | null; dateRangeText: string | null };
  registration: { registrationNotes: string | null; approvalCode: string | null };
  registrationSummary?: CourseRegistrationSummaryDto;
  requirements: CourseRequirementDto[];
  links: { courseExplorerUrl?: string };
};

export type CourseDetailDto = CourseSummaryDto & { sections: CourseSectionDto[] };
export type SearchCourseResultDto = {
  course: CourseSummaryDto;
  matchEvidence?: string[];
  warnings?: ResultWarning[];
};
export type CourseDetailResponseDto = { course: CourseDetailDto };

type Group = readonly [string, string, readonly (readonly [string, string])[]];
const TAXONOMY: readonly Group[] = [
  ["COMP1", "Composition I", []],
  ["ACP", "Advanced Composition", []],
  ["CS", "Cultural Studies", [
    ["US", "US Minority Cultures"],
    ["NW", "Non-Western Cultures"],
    ["WCC", "Western/Comparative Cultures"],
  ]],
  ["HUM", "Humanities & the Arts", [
    ["HP", "Historical & Philosophical Perspectives"],
    ["LA", "Literature & the Arts"],
  ]],
  ["NAT", "Natural Sciences & Technology", [
    ["LS", "Life Sciences"],
    ["PS", "Physical Sciences"],
  ]],
  ["QR", "Quantitative Reasoning", [
    ["QR1", "Quantitative Reasoning I"],
    ["QR2", "Quantitative Reasoning II"],
  ]],
  ["SBS", "Social & Behavioral Sciences", [
    ["SS", "Social Sciences"],
  ]],
];

export const GENED_REQUIREMENT_GROUPS = TAXONOMY.map(([code, label, options]) => ({
  code,
  label,
  options: options.map(([optionCode, optionLabel]) => ({ code: optionCode, label: optionLabel })),
}));
export const GENERIC_REQUIREMENT_CODES = TAXONOMY.map(([code]) => code);
const GENED_REQUIREMENT_OPTIONS = TAXONOMY.flatMap(
  ([code, label, options]) => [[code, label], ...options],
);
export const GENED_REQUIREMENT_LABELS = Object.fromEntries(
  GENED_REQUIREMENT_OPTIONS,
) as Record<string, string>;

const CODE_ALIASES: Record<string, string> = { BSC: "SBS", CMP: "COMP1" };
const KNOWN_CODES = new Set(GENED_REQUIREMENT_OPTIONS.map(([code]) => code));

export function canonicalRequirementCode(value?: string | null): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  const code = /^1[A-Z0-9]+$/.test(normalized) ? normalized.slice(1) : normalized;
  return CODE_ALIASES[code] ?? code;
}

export function canonicalRequirementCodes(values?: readonly string[]): string[] {
  return [...new Set((values ?? []).map(canonicalRequirementCode).filter(Boolean))] as string[];
}

export const isKnownRequirementCode = (value?: string | null): boolean => {
  const code = canonicalRequirementCode(value);
  return Boolean(code && KNOWN_CODES.has(code));
};
export const isGenericAnyRequirementFilter = (values?: readonly string[]): boolean => {
  const codes = new Set(canonicalRequirementCodes(values));
  return Boolean(values?.length) && GENERIC_REQUIREMENT_CODES.every((code) => codes.has(code));
};

export const REQUIREMENT_FILTER_MODES = ["single", "any", "all"] as const;
export type RequirementFilterMode = (typeof REQUIREMENT_FILTER_MODES)[number];
export type RequirementFilter = { mode: RequirementFilterMode; codes: string[] };
export function requirementFilter(
  mode: RequirementFilterMode,
  codes: readonly string[],
): RequirementFilter | undefined {
  const normalized = canonicalRequirementCodes(codes);
  return normalized.length ? { mode, codes: normalized } : undefined;
}
export const singleRequirementFilter = (code?: string | null): RequirementFilter | undefined =>
  code ? requirementFilter("single", [code]) : undefined;
export const normalizeRequirementCodes = canonicalRequirementCodes;

const tier = <T extends string>(
  score: number | null | undefined,
  thresholds: readonly [number, T][],
  fallback: T,
): T | null => {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const bounded = Math.min(100, Math.max(0, score));
  return thresholds.find(([minimum]) => bounded >= minimum)?.[1] ?? fallback;
};
export type QualityTierLabel = "Excellent" | "Good" | "Fair" | "Low";
export const getQualityTierLabel = (score?: number | null): QualityTierLabel | null =>
  tier(score, [[85, "Excellent"], [70, "Good"], [50, "Fair"]], "Low");
export type InstructorDifficultyTierLabel = "Lower" | "Moderate" | "Higher";
export const getInstructorDifficultyTierLabel = (
  score?: number | null,
): InstructorDifficultyTierLabel | null => {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return score > 75 ? "Higher" : score > 45 ? "Moderate" : "Lower";
};

export const GENED_DISPLAY_NAME = "GenEd";
export const ANY_GENED_DISPLAY_LABEL = "Any GenEd";
export const formatGenEdDisplayLabel = (codes: readonly string[] | string): string => {
  const normalized = canonicalRequirementCodes(Array.isArray(codes) ? codes : [codes]);
  return normalized.length ? `GenEd ${normalized.join(", ")}` : GENED_DISPLAY_NAME;
};
const requirementParts = (requirement: CourseRequirementDto) => {
  const categoryCode = canonicalRequirementCode(requirement.categoryId);
  const attributeCode = canonicalRequirementCode(requirement.attributeCode);
  return {
    categoryCode,
    attributeCode,
    category: (categoryCode && GENED_REQUIREMENT_LABELS[categoryCode]) || requirement.categoryName || categoryCode,
    attribute: (attributeCode && GENED_REQUIREMENT_LABELS[attributeCode]) || requirement.attributeName || attributeCode,
  };
};
export function courseRequirementLabel(requirement: CourseRequirementDto): string {
  const { categoryCode, attributeCode, category, attribute } = requirementParts(requirement);
  return category && attribute && categoryCode !== attributeCode
    ? `${category}: ${attribute}`
    : attribute ?? category ?? "Course requirement";
}
export function courseRequirementShortLabel(requirement: CourseRequirementDto): string {
  const { categoryCode, attributeCode } = requirementParts(requirement);
  return categoryCode && attributeCode && categoryCode !== attributeCode
    ? `${categoryCode}:${attributeCode}`
    : attributeCode ?? categoryCode ?? courseRequirementLabel(requirement);
}

export type CourseExplorerUrlInput = {
  year: number;
  term: string;
  subject: string;
  number: string;
};
export function buildCourseExplorerCourseUrl(input: CourseExplorerUrlInput): string {
  const parts = [String(input.year), input.term.toLowerCase(), input.subject.toUpperCase(), input.number];
  return `https://courses.illinois.edu/schedule/${parts.map(encodeURIComponent).join("/")}`;
}
export const buildCourseExplorerSectionUrl = (
  input: CourseExplorerUrlInput & { crn: string },
): string => buildCourseExplorerCourseUrl(input);
export const buildRmpProfessorUrl = (id?: string | null): string | null =>
  id && /^\d+$/.test(id)
    ? `https://www.ratemyprofessors.com/professor/${encodeURIComponent(id)}`
    : null;
export const buildRmpSearchUrl = (name?: string | null): string | null => {
  const query = name?.trim();
  return query
    ? `https://www.ratemyprofessors.com/search/professors/1112?q=${encodeURIComponent(query)}`
    : null;
};
