export type FeedbackKind =
  | "search_results"
  | "course_result"
  | "score"
  | "external_link"
  | "data_freshness"
  | "copy_confusion"
  | "other";

export type FeedbackIssue =
  | "expected_different_results"
  | "missing_course"
  | "wrong_score"
  | "broken_link"
  | "stale_data"
  | "confusing_copy"
  | "other";

export type FeedbackSubmitDto = {
  kind: FeedbackKind;
  issue: FeedbackIssue;
  page: "search" | "course";
  query?: string;
  courseId?: string;
  subject?: string;
  number?: string;
  term?: string;
  year?: number;
  crn?: string;
  instructorName?: string;
  scoreField?: "quality" | "difficulty" | "gpa" | "rmp";
  expected?: string;
  message?: string;
  anonymousSessionId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type FeedbackResponseDto = {
  id: string;
  status: "accepted";
  received_at: number;
};
