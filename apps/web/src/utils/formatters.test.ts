import { describe, expect, it } from 'vitest'
import { formatTime } from './formatters'

describe('formatTime', () => {
  it.each([
    ['09:00', '9:00 AM'],
    ['0900', '9:00 AM'],
    ['9:00', '9:00 AM'],
    ['0005', '12:05 AM'],
    ['1230', '12:30 PM'],
  ])('formats valid time %s', (input, expected) => {
    expect(formatTime(input)).toBe(expected)
  })

  it.each(['09:00:00', '9a00', '126x', '2360', '2400'])(
    'returns malformed time %s unchanged',
    (input) => {
      expect(formatTime(input)).toBe(input)
    }
  )
})
