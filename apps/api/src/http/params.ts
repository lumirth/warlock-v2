export type ParsedParam<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseBoundedIntParam(
  raw: string | undefined,
  name: string,
  options: { min: number; max: number; defaultValue?: number }
): ParsedParam<number> {
  if (raw === undefined || raw === '') {
    if (options.defaultValue !== undefined) {
      return { ok: true, value: options.defaultValue };
    }
    return { ok: false, error: `${name} is required` };
  }

  if (!/^-?\d+$/.test(raw)) {
    return { ok: false, error: `${name} must be an integer` };
  }

  const value = Number.parseInt(raw, 10);
  if (value < options.min || value > options.max) {
    return { ok: false, error: `${name} must be between ${options.min} and ${options.max}` };
  }

  return { ok: true, value };
}

export function parseEnumParam<T extends string>(
  raw: string,
  name: string,
  allowed: readonly T[]
): ParsedParam<T> {
  if ((allowed as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as T };
  }
  return { ok: false, error: `${name} must be one of: ${allowed.join(', ')}` };
}

export function parseSubjectParam(raw: string): ParsedParam<string> {
  const subject = raw.trim().toUpperCase();
  if (/^[A-Z]{2,4}$/.test(subject)) {
    return { ok: true, value: subject };
  }
  return { ok: false, error: 'subject must be a 2-4 letter subject code' };
}

export function parseCourseNumberParam(raw: string): ParsedParam<string> {
  const number = raw.trim();
  if (/^\d{3}[A-Z]?$/.test(number)) {
    return { ok: true, value: number };
  }
  return { ok: false, error: 'number must be a 3 digit catalog number with optional suffix' };
}
