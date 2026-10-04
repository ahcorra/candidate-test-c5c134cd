export interface BulkFailure {
  id: number
  status: number
}

export interface BulkOutcome {
  succeededIds: number[]
  failed: BulkFailure[]
}

export function splitBulkResults(
  ids: number[],
  results: PromiseSettledResult<unknown>[],
): BulkOutcome {
  const succeededIds: number[] = []
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
    failed.push({ id, status })
  })
  return { succeededIds, failed }
}
