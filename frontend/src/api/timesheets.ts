import { api, TimesheetEntry } from './client'

export interface TimesheetWeek {
  week_start: string
  cost: string
}

export interface TimesheetFilterOption {
  id: number
  name: string
}

export interface TimesheetPage {
  count: number
  page: number
  pageSize: number
  results: TimesheetEntry[]
  weeks: TimesheetWeek[]
  contracts: TimesheetFilterOption[]
  freelancers: TimesheetFilterOption[]
}

export const TIMESHEET_PAGE_SIZES = [20, 50, 100] as const
export type TimesheetPageSize = (typeof TIMESHEET_PAGE_SIZES)[number]

interface TimesheetQuery {
  status?: string
  contract?: number
  freelancer?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: TimesheetPageSize
}

interface TimesheetPageResponse {
  count: number
  page: number
  page_size: number
  results: TimesheetEntry[]
  weeks: TimesheetWeek[]
  contracts: TimesheetFilterOption[]
  freelancers: TimesheetFilterOption[]
}

function timesheetQuery(params?: TimesheetQuery): string {
  const search = new URLSearchParams()
  if (params?.status) search.set('status', params.status)
  if (params?.contract !== undefined) search.set('contract', String(params.contract))
  if (params?.freelancer !== undefined) search.set('freelancer', String(params.freelancer))
  if (params?.dateFrom) search.set('date_from', params.dateFrom)
  if (params?.dateTo) search.set('date_to', params.dateTo)
  if (params?.page !== undefined) search.set('page', String(params.page))
  if (params?.pageSize !== undefined) search.set('page_size', String(params.pageSize))
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function fetchTimesheetPage(params?: TimesheetQuery): Promise<TimesheetPage> {
  const body = await api.get<TimesheetPageResponse>(`/api/timesheets/${timesheetQuery(params)}`)
  return {
    count: body.count,
    page: body.page,
    pageSize: body.page_size,
    results: body.results,
    weeks: body.weeks,
    contracts: body.contracts,
    freelancers: body.freelancers,
  }
}

export async function fetchAllTimesheets(params?: Omit<TimesheetQuery, 'page' | 'pageSize'>): Promise<TimesheetEntry[]> {
  const pageSize: TimesheetPageSize = 100
  const firstPage = await fetchTimesheetPage({ ...params, page: 1, pageSize })
  const entries = [...firstPage.results]
  const pageCount = Math.ceil(firstPage.count / pageSize)
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    const nextPage = await fetchTimesheetPage({ ...params, page: pageNumber, pageSize })
    entries.push(...nextPage.results)
  }
  return entries
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
