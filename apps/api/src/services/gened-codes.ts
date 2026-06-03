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

export function isGenericAnyGenedFilter(values: string[] | undefined): boolean {
  if (!values?.length) {
    return false;
  }

  const normalized = new Set(values.map(value => value.toUpperCase()));
  return GENERIC_GENED_CODES.every(code => normalized.has(code));
}
