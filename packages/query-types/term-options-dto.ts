import type { SearchTermFilter } from "./search-contract.js";

export const TERM_OPTION_STATUS_VALUES = [
  "registrable",
  "active",
  "historical",
] as const;

export type TermOptionStatus = (typeof TERM_OPTION_STATUS_VALUES)[number];

export type SearchTermOptionDto = {
  termId: string;
  term: SearchTermFilter;
  year: number;
  status: TermOptionStatus;
  label: string;
};

export type SearchTermOptionsDto = {
  terms: SearchTermOptionDto[];
  years: number[];
};
