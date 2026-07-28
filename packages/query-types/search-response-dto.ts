import type { SearchCourseResultDto } from "./course-dto.js";
import type { SearchRequestDto } from "./search-contract.js";

export type SearchChipType =
  | "courseCode"
  | "crn"
  | "subject"
  | "instructor"
  | "days"
  | "time"
  | "level"
  | "levelBoost"
  | "credits"
  | "online"
  | "status"
  | "instructorDifficulty"
  | "requirement"
  | "term"
  | "partOfTerm"
  | "negation"
  | "semantic";

export type SearchMetaDto = {
  /**
   * Lossless executable continuation request. Clients may send this request back
   * for sort, pagination, and refresh operations without reinterpreting server
   * planning state.
   */
  nextRequest: SearchRequestDto;
  /**
   * Display-oriented interpretation of the request after natural-language
   * planning. This may intentionally drop executable text and is not a
   * continuation request.
   */
  interpretedRequest: SearchRequestDto;
  ui: SearchUiPlanDto;
  retrieval?: {
    /** True when one or more retrieval lanes failed and the response is partial. */
    degraded: boolean;
    /**
     * True when an attribute sort includes semantic matches. Semantic recall is
     * bounded, so the requested attribute only orders the retrieved match
     * window rather than every potentially relevant course in the catalog.
     */
    sortLimitedToRetrievedWindow?: boolean;
  };
};

export type SearchResponseDto = {
  results: SearchCourseResultDto[];
  meta: SearchMetaDto;
  pagination: {
    /** Exact union count for the retrieval lanes that completed successfully. */
    totalResults: number;
    /** False when `totalResults` excludes one or more failed retrieval lanes. */
    countIsComplete?: boolean;
    /** Number of top-ranked matches available through bounded pagination. */
    browseableResults: number;
    limit: number;
    offset: number;
    hasMore?: boolean;
    nextOffset?: number | null;
    /**
     * Describes the bounded pre-hydration window. `totalResults` remains the
     * exact match count even when only the strongest candidates are hydrated.
     */
    candidateWindow?: {
      retrievedCandidates: number;
      hydrationLimit: number;
      truncated: boolean;
    };
  };
};

export type SearchChipDto = {
  id: string;
  type: SearchChipType;
  label: string;
  value: string;
  removeRequest: SearchRequestDto;
};

export type SearchAmbiguityActionDto = {
  id: string;
  term: string;
  label: string;
  nextRequest: SearchRequestDto;
};

export type SearchUiPlanDto = {
  chips: SearchChipDto[];
  ambiguityActions: SearchAmbiguityActionDto[];
};
