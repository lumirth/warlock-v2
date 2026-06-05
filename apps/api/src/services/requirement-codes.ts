export const GENERIC_REQUIREMENT_CODES = [
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

export function canonicalRequirementCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;

  return /^1[A-Z0-9]+$/.test(normalized) ? normalized.slice(1) : normalized;
}

export function canonicalRequirementCodes(values: string[] | undefined): string[] {
  const codes = new Set<string>();
  for (const value of values ?? []) {
    const normalized = canonicalRequirementCode(value);
    if (normalized) codes.add(normalized);
  }
  return [...codes];
}

export function isGenericAnyRequirementFilter(values: string[] | undefined): boolean {
  if (!values?.length) {
    return false;
  }

  const normalized = new Set(canonicalRequirementCodes(values));
  return GENERIC_REQUIREMENT_CODES.every(code => normalized.has(code));
}
