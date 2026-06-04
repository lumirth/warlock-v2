type LogLevel = 'info' | 'warn' | 'error';
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

const REDACTED_KEY_PATTERN = /(authorization|token|secret|password|cookie|query|sql|params)/i;

function redactFields(fields: LogFields = {}): Record<string, string | number | boolean | null> {
  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sanitized[key] = REDACTED_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }

  return sanitized;
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  const payload = {
    ...redactFields(fields),
    level,
    event,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(payload);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(event: string, fields?: LogFields): void {
    emit('info', event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    emit('warn', event, fields);
  },
  error(event: string, fields?: LogFields): void {
    emit('error', event, fields);
  },
};

export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return { errorMessage: String(error) };
}

export function createRunId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
