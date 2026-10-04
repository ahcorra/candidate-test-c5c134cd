import { api, TimesheetEntry } from './client'

export function fetchTimesheets(params?: {
  status?: string
  contract?: number
  freelancer?: number
  dateFrom?: string
  dateTo?: string
}): Promise<TimesheetEntry[]> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.contract !== undefined) qs.set('contract', String(params.contract))
  if (params?.freelancer !== undefined) qs.set('freelancer', String(params.freelancer))
  if (params?.dateFrom) qs.set('date_from', params.dateFrom)
  if (params?.dateTo) qs.set('date_to', params.dateTo)
  const query = qs.toString() ? `?${qs}` : ''
  return api.get(`/api/timesheets/${query}`)
}

export function createTimesheetEntry(data: {
  contract: number
  date: string
  hours: number | string
}): Promise<TimesheetEntry> {
  return api.post('/api/timesheets/', data)
}

export function patchTimesheetEntry(
  id: number,
  data: { status: string; rejection_reason?: string }
): Promise<TimesheetEntry> {
  return api.patch(`/api/timesheets/${id}/`, data)
}
