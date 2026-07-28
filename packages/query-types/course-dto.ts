export type CourseInstructorDto = {
  name: string;
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
  instructors: CourseInstructorDto[];
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
  | "instructor_difficulty"
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

export type CourseMetricsDto = {
  primaryInstructorRating: number | null;
  avgGpa: number | null;
  medianGpa: number | null;
  gpaSampleSize: number | null;
  qualityScore: number | null;
  instructorDifficultyScore: number | null;
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

export type CourseRegistrationSummaryDto = {
  total: number;
  open: number;
  restricted: number;
  waitlisted: number;
  closed: number;
  cancelled: number;
  unknown: number;
  /**
   * Oldest section-sync Unix timestamp included in this summary. Null means
   * there are no sections or at least one included section has unknown age.
   */
  lastSynced: number | null;
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
  /** Exact numeric value only when the official catalog states one value. */
  creditHours: number | null;
  /** Official catalog wording, including ranges and variable-credit language. */
  creditHoursText: string | null;
  year: number;
  term: string;
  primaryInstructor: string | null;
  metrics: CourseMetricsDto;
  catalog: CourseCatalogDto;
  scheduleNotes: CourseScheduleNotesDto;
  registration: CourseRegistrationDto;
  registrationSummary?: CourseRegistrationSummaryDto;
  requirements: CourseRequirementDto[];
  links: CourseLinksDto;
};

export type CourseDetailDto = CourseSummaryDto & {
  sections: CourseSectionDto[];
};

export type SearchCourseResultDto = {
  course: CourseSummaryDto;
  matchEvidence?: MatchEvidence[];
  warnings?: ResultWarning[];
};

export type CourseDetailCacheDto = {
  cached?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  ageSeconds?: number | null;
  fetchedAt?: number | null;
  termStatus?: string;
};

export type CourseDetailResponseDto = {
  course: CourseDetailDto;
  cache?: CourseDetailCacheDto;
};
