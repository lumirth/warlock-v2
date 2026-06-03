export const GENERIC_GENED_CODES = [
  'HUM',
  'NAT',
  'SBS',
  'CS',
  'QR',
  'QR1',
  'QR2',
  'NW',
  'US',
  'WCC',
  'ACP',
] as const;

export function canonicalGenedCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;

  return /^1[A-Z0-9]+$/.test(normalized) ? normalized.slice(1) : normalized;
}

export function canonicalGenedCodes(values: string[] | undefined): string[] {
  const codes = new Set<string>();
  for (const value of values ?? []) {
    const normalized = canonicalGenedCode(value);
    if (normalized) codes.add(normalized);
  }
  return [...codes];
}

export function isGenericAnyGenedFilter(values: string[] | undefined): boolean {
  if (!values?.length) {
    return false;
  }

  const normalized = new Set(canonicalGenedCodes(values));
  return GENERIC_GENED_CODES.every(code => normalized.has(code));
}
