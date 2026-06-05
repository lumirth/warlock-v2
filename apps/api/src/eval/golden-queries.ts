import type { GoldQuery } from './types.js';
import { CORE_GOLDEN_QUERIES } from './golden-queries-core.js';
import { LONG_TAIL_GOLDEN_QUERIES } from './golden-queries-long-tail.js';

export const GOLDEN_QUERIES: GoldQuery[] = [
  ...CORE_GOLDEN_QUERIES,
  ...LONG_TAIL_GOLDEN_QUERIES,
];
