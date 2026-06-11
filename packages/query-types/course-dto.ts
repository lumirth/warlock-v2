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
  rawStatus: string | null;
  statusCode: string | null;
  sectionStatusCode: string | null;
};

export type CourseSectionScheduleDto = {
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

export type CourseSectionInstructorsDto = {
  displayName: string;
  rmpRating: number | null;
  avgGpa: number | null;
  stats: InstructorLinkDto[];
};

export type CourseSectionSourceFactsDto = {
  sectionTitle: string | null;
  sectionText: string | null;
  sectionNotes: string | null;
  cappArea: string | null;
};

export type CourseSectionLinksDto = {
  courseExplorerUrl?: string;
};

export type CourseSectionDto = {
  crn: string;
  sectionNumber: string;
  availability: CourseSectionAvailabilityDto;
  schedule: CourseSectionScheduleDto;
  instructors: CourseSectionInstructorsDto;
  sourceFacts: CourseSectionSourceFactsDto;
  links: CourseSectionLinksDto;
};

export type CourseRequirementDto = {
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

export type ResultWarningKind = "historical";

export type ResultWarning = {
  kind: ResultWarningKind;
  message: string;
};

export type ResultExplanation = {
  whyMatched: string[];
  watchOut: string[];
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

export type CourseCatalogDto = {
  courseInfo: string | null;
  degreeAttributes: string | null;
};

export type CourseScheduleNotesDto = {
  classScheduleInfo: string | null;
  dateRangeText: string | null;
};

export type CourseRegistrationDto = {
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
  catalog: CourseCatalogDto;
  scheduleNotes: CourseScheduleNotesDto;
  registration: CourseRegistrationDto;
  requirements: CourseRequirementDto[];
  instructorLinks: Record<string, InstructorLinkDto>;
  links: CourseLinksDto;
};

export type CourseDetailDto = CourseSummaryDto & {
  sections: CourseSectionDto[];
};

export type SearchCourseResultDto = {
  course: CourseSummaryDto;
  matchEvidence?: MatchEvidence[];
  explanation?: ResultExplanation;
  warnings?: ResultWarning[];
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
