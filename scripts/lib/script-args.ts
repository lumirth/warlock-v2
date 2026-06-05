export function parseNonNegativeInt(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number.parseInt(value, 10);
}

export function parseNonNegativeFloat(value: string | undefined, name: string): number {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return Number.parseFloat(value);
}

export function parseEnumArg<T extends string>(
  value: string | undefined,
  name: string,
  allowed: readonly T[],
): T {
  if (!value || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function endpoint(baseUrl: string, path: string): URL {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
}
