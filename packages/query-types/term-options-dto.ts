import type { SearchTermFilter } from "./search-contract.js";

export const TERM_STATUS_VALUES = [
  "registrable",
  "active",
  "historical",
] as const;

export type TermStatus = (typeof TERM_STATUS_VALUES)[number];

export type SearchTermOptionDto = {
  termId: string;
  term: SearchTermFilter;
  year: number;
  status: TermStatus;
  label: string;
};

export type SearchTermOptionsDto = {
  terms: SearchTermOptionDto[];
  years: number[];
};
