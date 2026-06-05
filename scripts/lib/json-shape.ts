export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function recordsFromArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is JsonRecord => item !== null)
    : [];
}

export function numericOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function positiveNumber(value: number | null): boolean {
  return typeof value === 'number' && value > 0;
}

export function positiveOrFallback(value: number | null, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback;
}
