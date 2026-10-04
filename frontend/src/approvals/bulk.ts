export interface BulkFailure {
  id: number
  status: number
}

export interface BulkOutcome {
  succeededIds: number[]
  // 404 or 409: someone else decided the row first, so it is no longer waiting.
  staleIds: number[]
  // Anything else, including a network error (status 0). These rows can be tried again.
  failed: BulkFailure[]
}

const ALREADY_DECIDED = new Set([404, 409])

export function splitBulkResults(
  ids: number[],
  results: PromiseSettledResult<unknown>[],
): BulkOutcome {
  const succeededIds: number[] = []
  const staleIds: number[] = []
  const failed: BulkFailure[] = []
  results.forEach((result, index) => {
    const id = ids[index]
    if (result.status === 'fulfilled') {
      succeededIds.push(id)
      return
    }
    const reason = result.reason
    const status =
      reason !== null &&
      typeof reason === 'object' &&
      'status' in reason &&
      typeof reason.status === 'number'
        ? reason.status
        : 0
    if (ALREADY_DECIDED.has(status)) staleIds.push(id)
    else failed.push({ id, status })
  })
  return { succeededIds, staleIds, failed }
}

export function describeOutcome(
  decision: 'approved' | 'rejected',
  outcome: BulkOutcome,
  label: (id: number) => string,
): string | null {
  const saved = outcome.succeededIds.length
  const total = saved + outcome.staleIds.length + outcome.failed.length
  if (saved === total) return null
  const parts = [`${decision === 'approved' ? 'Approved' : 'Rejected'} ${saved} of ${total}.`]
  if (outcome.staleIds.length > 0) {
    parts.push(`Already decided by someone else: ${outcome.staleIds.map(label).join(', ')}.`)
  }
  if (outcome.failed.length > 0) {
    parts.push(`Not saved, still selected to try again: ${outcome.failed.map((failure) => label(failure.id)).join(', ')}.`)
  }
  return parts.join(' ')
}
