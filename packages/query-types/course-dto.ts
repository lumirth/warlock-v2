export type InstructorLinkDto = {
  instructorName: string | null;
  rmpRating: number | null;
  rmpDifficulty: number | null;
  rmpId: string | null;
  rmpUrl?: string | null;
  rmpSearchUrl?: string | null;
  avgGpa: number | null;
  medianGpa: number | null;
  gpaSampleSize: number | null;
  numRatings: number | null;
  wouldTakeAgainPct: number | null;
  topTags: string[] | null;
  department: string | null;
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
  instructorNames: string[];
  instructors: InstructorLinkDto[];
};

export type CourseSectionDto = {
  crn: string;
  sectionNumber: string;
  status: string;
  type: string;
  days: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  instructor: string;
  instructorRmp: number | null;
  instructorGpa: number | null;
  instructorStats: InstructorLinkDto[];
  sectionTitle: string | null;
  statusCode: string | null;
  sectionStatusCode: string | null;
  sectionText: string | null;
  sectionNotes: string | null;
  cappArea: string | null;
  dateRangeText: string | null;
  partOfTerm: string | null;
  startDate: string | null;
  endDate: string | null;
  creditHours: string | null;
  meetings: CourseSectionMeetingDto[];
  courseExplorerUrl?: string;
};

export type CourseGenedDto = {
  categoryId: string;
  categoryName: string | null;
  attributeCode: string | null;
  attributeName: string | null;
};

export type MatchEvidenceKind =
  | "course_code"
  | "subject"
  | "number"
  | "crn"
  | "title"
  | "requirement"
  | "schedule"
  | "delivery"
  | "instructor"
  | "alias"
  | "workload"
  | "topic"
  | "semantic"
  | "keyword"
  | "quality"
  | "term";

export type MatchEvidenceSource =
  | "filter"
  | "query"
  | "keyword"
  | "semantic"
  | "alias"
  | "signal"
  | "metadata"
  | "term";

export type MatchEvidenceWeight = "hard" | "soft" | "rank";

export type MatchEvidence = {
  kind: MatchEvidenceKind;
  label: string;
  value?: string;
  source: MatchEvidenceSource;
  weight: MatchEvidenceWeight;
};

export type ResultWarningKind = "historical" | "cached" | "stale" | "partial";

export type ResultWarning = {
  kind: ResultWarningKind;
  message: string;
};

export type SectionMatchDto = {
  crn: string;
  sectionNumber: string;
  evidence: MatchEvidence[];
};

export type ResultExplanation = {
  whyMatched: string[];
  watchOut: string[];
  matchedChips: string[];
  confidence: {
    score: number;
    label: "high" | "medium" | "low" | "uncertain";
    reasons: string[];
  };
};

export type CourseMetricsDto = {
  primaryInstructorRating: number | null;
  avgGpa: number | null;
  medianGpa: number | null;
  gpaSampleSize: number | null;
  qualityScore: number | null;
  workloadScore: number | null;
};

export type CourseRegistrationDto = {
  courseInfo: string | null;
  degreeAttributes: string | null;
  classScheduleInfo: string | null;
  dateRangeText: string | null;
  registrationNotes: string | null;
  approvalCode: string | null;
};

export type CourseLinksDto = {
  courseExplorerUrl?: string;
};

export type CourseSummaryDto = {
  id: string;
  subject: string;
  number: string;
  title: string;
  description: string | null;
  creditHours: number | null;
  year: number;
  term: string;
  primaryInstructor: string | null;
  metrics: CourseMetricsDto;
  registration: CourseRegistrationDto;
  requirements: CourseGenedDto[];
  instructorLinks: Record<string, InstructorLinkDto>;
  links: CourseLinksDto;
};

export type CourseDetailDto = CourseSummaryDto & {
  sections: CourseSectionDto[];
};

export type SearchCourseMetadataDto = {
  score?: number;
  semanticRank?: number;
  keywordRank?: number;
  historical?: boolean;
};

export type SearchCourseResultDto = {
  course: CourseSummaryDto;
  search?: SearchCourseMetadataDto;
  matchEvidence?: MatchEvidence[];
  explanation?: ResultExplanation;
  warnings?: ResultWarning[];
  sectionMatches?: SectionMatchDto[];
};

export type CourseDetailCacheDto = {
  cached?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  ageSeconds?: number;
  fetchedAt?: number;
  termStatus?: string;
};

export type CourseDetailResponseDto = {
  course: CourseDetailDto;
  cache?: CourseDetailCacheDto;
};
