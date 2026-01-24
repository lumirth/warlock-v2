import { describe, it, expect, vi } from 'vitest';
import { resolveInstructor, normalizeGpaToRmpName } from '../matcher.js';
import type { D1Database } from '@cloudflare/workers-types';

describe('matcher service', () => {
  describe('normalizeGpaToRmpName', () => {
    it('converts "Last, First" to "First Last"', () => {
      expect(normalizeGpaToRmpName('Fleck, Margaret')).toBe('Margaret Fleck');
    });

    it('converts "Last, First Middle" to "First Last"', () => {
      expect(normalizeGpaToRmpName('Fleck, Margaret M')).toBe('Margaret Fleck');
    });

    it('handles names without commas', () => {
      expect(normalizeGpaToRmpName('Margaret Fleck')).toBe('Margaret Fleck');
    });

    it('handles empty first name', () => {
      expect(normalizeGpaToRmpName('Fleck, ')).toBe('Fleck');
    });
  });

  describe('resolveInstructor', () => {
    it('resolves a perfect bridge (GPA -> RMP)', async () => {
      const mockFirst = vi.fn();
      const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
      const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
      const mockDb = { prepare: mockPrepare } as unknown as D1Database;

      // Mock GPA result
      mockFirst.mockResolvedValueOnce({
        id: 123,
        instructor: 'Fleck, Margaret M',
        avg_gpa: 3.8
      });

      // Mock RMP result
      mockFirst.mockResolvedValueOnce({
        rmp_id: 'VGVhY2hlci0yMTI3',
        rating: 4.5,
        difficulty: 2.5
      });

      const result = await resolveInstructor(mockDb, {
        subject: 'CS',
        number: '173',
        instructorName: 'Fleck, M'
      });

      expect(result).not.toBeNull();
      expect(result?.fullName).toBe('Margaret Fleck');
      expect(result?.gpaName).toBe('Fleck, Margaret M');
      expect(result?.rmpRating).toBe(4.5);
      expect(result?.avgGpa).toBe(3.8);

      // Verify GPA query
      expect(mockPrepare).toHaveBeenNthCalledWith(1, expect.stringContaining('gpa_stats'));
      expect(mockBind).toHaveBeenNthCalledWith(1, 'CS', '173', 'Fleck, M%');

      // Verify RMP query
      expect(mockPrepare).toHaveBeenNthCalledWith(2, expect.stringContaining('rmp_cache'));
      expect(mockBind).toHaveBeenNthCalledWith(2, 'Margaret Fleck');
    });

    it('returns null if no GPA bridge is found', async () => {
      const mockFirst = vi.fn();
      const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
      const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
      const mockDb = { prepare: mockPrepare } as unknown as D1Database;

      // Mock GPA result (none)
      mockFirst.mockResolvedValueOnce(null);

      const result = await resolveInstructor(mockDb, {
        subject: 'CS',
        number: '173',
        instructorName: 'Unknown'
      });

      expect(result).toBeNull();
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });

    it('resolves GPA bridge even if RMP is missing', async () => {
      const mockFirst = vi.fn();
      const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
      const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
      const mockDb = { prepare: mockPrepare } as unknown as D1Database;

      // Mock GPA result
      mockFirst.mockResolvedValueOnce({
        id: 123,
        instructor: 'Fleck, Margaret M',
        avg_gpa: 3.8
      });

      // Mock RMP result (none)
      mockFirst.mockResolvedValueOnce(null);

      const result = await resolveInstructor(mockDb, {
        subject: 'CS',
        number: '173',
        instructorName: 'Fleck, M'
      });

      expect(result).not.toBeNull();
      expect(result?.fullName).toBe('Margaret Fleck');
      expect(result?.rmpId).toBeUndefined();
      expect(result?.avgGpa).toBe(3.8);
    });
  });
});
