import { describe, expect, it } from 'vitest'
import { describeOutcome, splitBulkResults } from './bulk'

describe('bulk results', () => {
  it('separates rows someone else already decided from rows worth retrying', () => {
    const outcome = splitBulkResults(
      [1, 2, 3, 4],
      [
        { status: 'fulfilled', value: {} },
        { status: 'rejected', reason: { status: 409 } },
        { status: 'rejected', reason: { status: 500 } },
        { status: 'rejected', reason: new TypeError('Failed to fetch') },
      ],
    )
    expect(outcome.succeededIds).toEqual([1])
    expect(outcome.staleIds).toEqual([2])
    expect(outcome.failed).toEqual([
      { id: 3, status: 500 },
      { id: 4, status: 0 },
    ])
  })

  it('says nothing when every row was saved and names the rest otherwise', () => {
    const label = (id: number) => `Row ${id}`
    expect(describeOutcome('approved', { succeededIds: [1, 2], staleIds: [], failed: [] }, label)).toBeNull()
    expect(
      describeOutcome('rejected', { succeededIds: [1], staleIds: [2], failed: [{ id: 3, status: 500 }] }, label),
    ).toBe('Rejected 1 of 3. Already decided by someone else: Row 2. Not saved, still selected to try again: Row 3.')
  })
})
