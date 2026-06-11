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
  | "workload"
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
};

export type SearchResponseDto = {
  results: SearchCourseResultDto[];
  meta: SearchMetaDto;
  pagination: {
    /** Exact number of courses matched by the executable retrieval plan. */
    totalResults: number;
    /** Number of top-ranked matches available through bounded pagination. */
    browseableResults: number;
    limit: number;
    offset: number;
    hasMore?: boolean;
    nextOffset?: number | null;
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
