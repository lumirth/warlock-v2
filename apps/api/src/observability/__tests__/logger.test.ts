import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorFields, logger } from '../logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('structured logger', () => {
  it('emits structured JSON and redacts sensitive field names', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.info('test.event', {
      runId: 'run-1',
      token: 'secret-token-value',
      rawQuery: 'student search text',
      subjectCount: 12,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(payload).toMatchObject({
      level: 'info',
      event: 'test.event',
      runId: 'run-1',
      token: '[redacted]',
      rawQuery: '[redacted]',
      subjectCount: 12,
    });
    expect(payload.timestamp).toEqual(expect.any(String));
  });

  it('normalizes thrown errors without stack traces', () => {
    const fields = errorFields(new TypeError('nope'));

    expect(fields).toEqual({
      errorName: 'TypeError',
      errorMessage: 'nope',
    });
  });
});
