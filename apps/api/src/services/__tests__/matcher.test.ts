import { describe, it, expect, vi } from 'vitest';
import { resolveInstructor, normalizeToRmpCacheName } from '../matcher.js';
import type { D1Database } from '@cloudflare/workers-types';

describe('matcher service', () => {
  describe('normalizeToRmpCacheName', () => {
    it('converts "Last, First" to "Last, F"', () => {
      expect(normalizeToRmpCacheName('Fleck, Margaret')).toBe('Fleck, M');
    });

    it('converts "Last, First Middle" to "Last, F"', () => {
      expect(normalizeToRmpCacheName('Fleck, Margaret M')).toBe('Fleck, M');
    });

    it('handles names without commas', () => {
      expect(normalizeToRmpCacheName('Margaret Fleck')).toBe('Margaret Fleck');
    });

    it('handles empty first name', () => {
      expect(normalizeToRmpCacheName('Fleck, ')).toBe('Fleck');
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
      expect(result?.fullName).toBe('Fleck, M');
      expect(result?.gpaName).toBe('Fleck, Margaret M');
      expect(result?.rmpRating).toBe(4.5);
      expect(result?.avgGpa).toBe(3.8);

      // Verify GPA query
      expect(mockPrepare).toHaveBeenNthCalledWith(1, expect.stringContaining('gpa_stats'));
      expect(mockBind).toHaveBeenNthCalledWith(1, 'CS', '173', 'Fleck, M%');

      // Verify RMP query
      expect(mockPrepare).toHaveBeenNthCalledWith(2, expect.stringContaining('rmp_cache'));
      expect(mockBind).toHaveBeenNthCalledWith(2, 'Fleck, M');
    });

    it('falls back to direct RMP match if GPA bridge is missing', async () => {
      const mockFirst = vi.fn();
      const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
      const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
      const mockDb = { prepare: mockPrepare } as unknown as D1Database;

      // Mock GPA result (none)
      mockFirst.mockResolvedValueOnce(null);

      // Mock RMP result (found)
      mockFirst.mockResolvedValueOnce({
        rmp_id: 'VGVhY2hlci0zMDcyMzEz',
        rating: 4.2,
        difficulty: 3.0
      });

      const result = await resolveInstructor(mockDb, {
        subject: 'CS',
        number: '173',
        instructorName: 'Evans, C'
      });

      expect(result).not.toBeNull();
      expect(result?.fullName).toBe('Evans, C');
      expect(result?.rmpId).toBe('VGVhY2hlci0zMDcyMzEz');
      expect(result?.rmpRating).toBe(4.2);
      expect(result?.gpaId).toBeUndefined();

      expect(mockPrepare).toHaveBeenCalledTimes(2);
    });

    it('returns null if both GPA and RMP matches are missing', async () => {
      const mockFirst = vi.fn();
      const mockBind = vi.fn().mockReturnValue({ first: mockFirst });
      const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
      const mockDb = { prepare: mockPrepare } as unknown as D1Database;

      // Mock GPA result (none)
      mockFirst.mockResolvedValueOnce(null);
      // Mock RMP result (none)
      mockFirst.mockResolvedValueOnce(null);

      const result = await resolveInstructor(mockDb, {
        subject: 'CS',
        number: '173',
        instructorName: 'Unknown'
      });

      expect(result).toBeNull();
      expect(mockPrepare).toHaveBeenCalledTimes(2);
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
      expect(result?.fullName).toBe('Fleck, M');
      expect(result?.rmpId).toBeUndefined();
      expect(result?.avgGpa).toBe(3.8);
    });
  });
});
