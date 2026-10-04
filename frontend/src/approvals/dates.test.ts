import { describe, expect, it } from 'vitest'
import { formatEntryDate, formatWeekOf } from './dates'

const today = new Date(2026, 9, 4)

describe('entry date', () => {
  it('formats the same day as today', () => {
    expect(formatEntryDate('2026-10-04', today)).toBe('Today')
  })

  it('formats the previous day as yesterday', () => {
    expect(formatEntryDate('2026-10-03', today)).toBe('Yesterday')
  })

  it('formats another day this year with the weekday', () => {
    expect(formatEntryDate('2026-10-02', today)).toBe('Fri 2 Oct')
  })

  it('includes the year when the entry is from another year', () => {
    expect(formatEntryDate('2025-10-02', today)).toBe('Thu 2 Oct 2025')
  })

  it('leaves a value that is not a date unchanged', () => {
    expect(formatEntryDate('not-a-date', today)).toBe('not-a-date')
  })

  it('formats a week from its monday', () => {
    expect(formatWeekOf('2026-09-28')).toBe('Week of 28 Sep')
  })
})
