import { describe, expect, it } from 'vitest'
import { splitBulkResults } from './bulk'

describe('bulk results', () => {
  it('keeps the successes and reports the failed ids', () => {
    const outcome = splitBulkResults(
      [1, 2, 3],
      [
        { status: 'fulfilled', value: {} },
        { status: 'rejected', reason: { status: 409 } },
        { status: 'fulfilled', value: {} },
      ],
    )
    expect(outcome.succeededIds).toEqual([1, 3])
    expect(outcome.failed).toEqual([{ id: 2, status: 409 }])
  })
})
