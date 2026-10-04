import { FormEvent, Fragment, ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { TimesheetEntry } from '../api/client'
import { describeOutcome, splitBulkResults } from '../approvals/bulk'
import { entryCost, formatPounds, totalCost } from '../approvals/cost'
import { formatEntryDate } from '../approvals/dates'
import { WeekCostChart } from '../approvals/WeekCostChart'
import {
  TIMESHEET_PAGE_SIZES,
  TimesheetPage,
  TimesheetPageSize,
  fetchTimesheetPage,
  patchTimesheetEntry,
} from '../api/timesheets'
import { StatusBadge } from '../components/StatusBadge'
import { useAuth } from '../hooks/useAuth'

interface InboxFilters {
  contractId: string
  freelancerId: string
  dateFrom: string
  dateTo: string
}

const emptyFilters: InboxFilters = {
  contractId: '',
  freelancerId: '',
  dateFrom: '',
  dateTo: '',
}

// Only the inbox drops rows optimistically. Other timesheet views refetch once decisions settle.
const INBOX_KEY = ['timesheets', 'inbox'] as const

function sortOldestFirst(entries: TimesheetEntry[]): TimesheetEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id)
}

function groupByDay(entries: TimesheetEntry[]): Array<{ date: string; entries: TimesheetEntry[] }> {
  const groups: Array<{ date: string; entries: TimesheetEntry[] }> = []
  for (const entry of entries) {
    const current = groups[groups.length - 1]
    if (current && current.date === entry.date) current.entries.push(entry)
    else groups.push({ date: entry.date, entries: [entry] })
  }
  return groups
}

function DayCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  label: string
  onChange: () => void
}) {
  const checkboxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      className="accent-indigo-600"
    />
  )
}

function ToggleArrow({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7.2 4.6a.75.75 0 0 1 1.06-.04l5.2 4.8a.75.75 0 0 1 0 1.08l-5.2 4.8a.75.75 0 1 1-1.02-1.1L11.84 10 7.24 5.66a.75.75 0 0 1-.04-1.06z" />
    </svg>
  )
}

function ApproveIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10.5l3 3 7-7" />
    </svg>
  )
}

function RejectIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" d="M6 6l8 8M14 6l-8 8" />
    </svg>
  )
}

const approveCircleClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600/10 text-indigo-700 hover:bg-indigo-600/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-40 disabled:cursor-not-allowed'
const rejectCircleClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600/10 text-red-700 hover:bg-red-600/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed'
const filterFieldClass =
  'mt-1 box-border h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-0 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 [&::-webkit-datetime-edit]:p-0 [&::-webkit-datetime-edit-fields-wrapper]:p-0'
const approveBulkClass =
  'inline-flex items-center gap-1.5 rounded-full bg-indigo-600/10 text-indigo-700 text-sm px-3 py-1.5 hover:bg-indigo-600/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-40 disabled:cursor-not-allowed'
const rejectBulkClass =
  'inline-flex items-center gap-1.5 rounded-full bg-red-600/10 text-red-700 text-sm px-3 py-1.5 hover:bg-red-600/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed'

function visiblePages(currentPage: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }
  const pages: Array<number | 'ellipsis'> = [1]
  const windowStart = Math.max(2, currentPage - 1)
  const windowEnd = Math.min(pageCount - 1, currentPage + 1)
  if (windowStart > 2) pages.push('ellipsis')
  for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) pages.push(pageNumber)
  if (windowEnd < pageCount - 1) pages.push('ellipsis')
  pages.push(pageCount)
  return pages
}

function PageStep({
  label,
  disabled,
  onClick,
  current = false,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  current?: boolean
  children: ReactNode
}) {
  const tone = current
    ? 'bg-indigo-600 text-white font-medium shadow-sm'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:border-slate-100 disabled:text-slate-300 disabled:hover:bg-white'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed ${tone}`}
    >
      {children}
    </button>
  )
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  const pointsLeft = direction === 'left'
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={pointsLeft ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'} />
    </svg>
  )
}

function Chevrons({ direction }: { direction: 'left' | 'right' }) {
  const pointsLeft = direction === 'left'
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={pointsLeft ? 'M11 5.5L6.5 10 11 14.5M15.5 5.5L11 10l4.5 4.5' : 'M9 5.5L13.5 10 9 14.5M4.5 5.5L9 10 4.5 14.5'}
      />
    </svg>
  )
}

function decisionLabel(entry: TimesheetEntry): string {
  return `${entry.freelancer.name} (${formatEntryDate(entry.date)})`
}

function decisionSubject(rows: TimesheetEntry[], ids: number[]): string {
  if (ids.length !== 1) return `${ids.length} timesheets`
  const entry = rows.find((row) => row.id === ids[0])
  if (!entry) return '1 timesheet'
  return decisionLabel(entry)
}

function ConfirmDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.querySelector<HTMLElement>('[data-dialog-focus]')?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-sm font-medium text-slate-900">
          {title}
        </h2>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export default function Approvals() {
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<InboxFilters>(emptyFilters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<TimesheetPageSize>(20)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set())
  const [approveIds, setApproveIds] = useState<number[] | null>(null)
  const [rejectIds, setRejectIds] = useState<number[] | null>(null)
  const [decisionRows, setDecisionRows] = useState<TimesheetEntry[]>([])
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const filtersActive = Object.values(filters).some((value) => value !== '')
  const rangeInvalid = filters.dateFrom !== '' && filters.dateTo !== '' && filters.dateFrom > filters.dateTo

  const decision = useMutation({
    mutationFn: async (input: { ids: number[]; status: 'approved' | 'rejected'; rejectionReason?: string }) => {
      const results = await Promise.allSettled(
        input.ids.map((id) =>
          patchTimesheetEntry(
            id,
            input.status === 'rejected'
              ? { status: 'rejected', rejection_reason: input.rejectionReason }
              : { status: 'approved' },
          ),
        ),
      )
      return splitBulkResults(input.ids, results)
    },
    onMutate: async (input) => {
      setNotice(null)
      await queryClient.cancelQueries({ queryKey: INBOX_KEY })
      const snapshots = queryClient.getQueriesData<TimesheetPage>({ queryKey: INBOX_KEY })
      const removing = new Set(input.ids)
      queryClient.setQueriesData<TimesheetPage>({ queryKey: INBOX_KEY }, (current) => {
        if (!current) return current
        const results = current.results.filter((entry) => !removing.has(entry.id))
        const removed = current.results.length - results.length
        return { ...current, results, count: Math.max(0, current.count - removed) }
      })
      return { snapshots }
    },
    onSuccess: (outcome, input, context) => {
      const lookup = new Map<number, TimesheetEntry>()
      for (const [, snapshot] of context?.snapshots ?? []) {
        for (const entry of snapshot?.results ?? []) lookup.set(entry.id, entry)
      }
      // Put back only rows that can still be decided. A 404 or 409 means someone else got there first.
      const retryIds = new Set(outcome.failed.map((failure) => failure.id))
      if (retryIds.size > 0) {
        for (const [key, snapshot] of context?.snapshots ?? []) {
          const restored = (snapshot?.results ?? []).filter((entry) => retryIds.has(entry.id))
          queryClient.setQueryData<TimesheetPage>(key, (current) => {
            if (!current) return current
            const present = new Set(current.results.map((entry) => entry.id))
            const missing = restored.filter((entry) => !present.has(entry.id))
            return { ...current, results: [...current.results, ...missing], count: current.count + missing.length }
          })
        }
      }
      setNotice(
        describeOutcome(input.status, outcome, (id) => {
          const entry = lookup.get(id)
          return entry ? decisionLabel(entry) : `entry ${id}`
        }),
      )
      // Keep any other selection; rows that failed stay selected so a retry sends only them.
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const id of input.ids) next.delete(id)
        for (const id of retryIds) next.add(id)
        return next
      })
      setApproveIds(null)
      setRejectIds(null)
      setReason('')
    },
    onError: (_error, _input, context) => {
      for (const [key, snapshot] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, snapshot)
      }
      setNotice('The decisions did not finish. The queue has been restored.')
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['timesheets'] })
    },
  })

  const entriesQuery = useQuery({
    queryKey: [...INBOX_KEY, { status: 'submitted', page, pageSize, ...filters }],
    queryFn: () =>
      fetchTimesheetPage({
        status: 'submitted',
        page,
        pageSize,
        contract: filters.contractId ? Number(filters.contractId) : undefined,
        freelancer: filters.freelancerId ? Number(filters.freelancerId) : undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      }),
    enabled: isAdmin && !rangeInvalid,
    placeholderData: keepPreviousData,
  })

  const totalCount = entriesQuery.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  useEffect(() => {
    if (entriesQuery.data && !decision.isPending && page > pageCount) setPage(pageCount)
  }, [entriesQuery.data, decision.isPending, page, pageCount])

  function clearSelection() {
    setSelectedIds(new Set())
    setApproveIds(null)
    setRejectIds(null)
    setNotice(null)
  }

  function askToApprove(rows: TimesheetEntry[]) {
    setRejectIds(null)
    setReason('')
    setDecisionRows(rows)
    setApproveIds(rows.map((row) => row.id))
  }

  function askToReject(rows: TimesheetEntry[]) {
    setApproveIds(null)
    setReason('')
    setDecisionRows(rows)
    setRejectIds(rows.map((row) => row.id))
  }

  function goToPage(nextPage: number) {
    setPage(nextPage)
    clearSelection()
  }

  function changeFilters(update: (current: InboxFilters) => InboxFilters) {
    setFilters(update)
    setPage(1)
    clearSelection()
  }

  // Hiding the nav link is not the authorization check. The API refuses a freelancer.
  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg px-6 py-12 text-center max-w-md">
        <p className="text-slate-800 font-medium">Company admins only</p>
        <p className="text-slate-500 text-sm mt-1">
          Pending approvals are for the company admin on these contracts.
        </p>
      </div>
    )
  }

  const pageData = entriesQuery.data
  const entries = sortOldestFirst(pageData?.results ?? [])
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.id))
  const allVisibleSelected = entries.length > 0 && selectedEntries.length === entries.length
  const contractOptions = pageData?.contracts ?? []
  const freelancerOptions = pageData?.freelancers ?? []
  const weeks = pageData?.weeks ?? []
  const isLoading = entriesQuery.isLoading
  const isError = entriesQuery.isError
  const nothingWaiting = !isLoading && !isError && !filtersActive && totalCount === 0
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, totalCount)

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        for (const entry of entries) next.delete(entry.id)
      } else {
        for (const entry of entries) next.add(entry.id)
      }
      return next
    })
  }

  function toggleOne(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleDayOpen(date: string) {
    setCollapsedDates((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function toggleDay(dayEntries: TimesheetEntry[]) {
    setSelectedIds((current) => {
      const next = new Set(current)
      const allSelected = dayEntries.every((entry) => next.has(entry.id))
      for (const entry of dayEntries) {
        if (allSelected) next.delete(entry.id)
        else next.add(entry.id)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1 flex items-center gap-2">
          Pending approvals
          {!isLoading && !isError && totalCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 approval-pulse" aria-hidden="true" />
              {totalCount} waiting
            </span>
          )}
        </h1>
        <p className="text-slate-500 text-sm">Submitted hours waiting for a decision.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Contract</span>
            <select
              value={filters.contractId}
              onChange={(event) => changeFilters((current) => ({ ...current, contractId: event.target.value }))}
              className={filterFieldClass}
            >
              <option value="">All contracts</option>
              {contractOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Freelancer</span>
            <select
              value={filters.freelancerId}
              onChange={(event) => changeFilters((current) => ({ ...current, freelancerId: event.target.value }))}
              className={filterFieldClass}
            >
              <option value="">All freelancers</option>
              {freelancerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">From</span>
            <input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(event) => changeFilters((current) => ({ ...current, dateFrom: event.target.value }))}
              className={filterFieldClass}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">To</span>
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(event) => changeFilters((current) => ({ ...current, dateTo: event.target.value }))}
              className={filterFieldClass}
            />
          </label>
        </div>
        {rangeInvalid && <p className="mt-3 text-sm text-red-700">From must be on or before To.</p>}
        {filtersActive && (
          <button
            type="button"
            onClick={() => changeFilters(() => emptyFilters)}
            className="mt-3 text-sm text-indigo-600 hover:text-indigo-800"
          >
            Clear filters
          </button>
        )}
      </div>

      <div role="status" aria-live="polite">
        {notice && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{notice}</div>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading submitted hours…</p>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          Failed to load submitted hours. Please refresh the page.
        </div>
      ) : nothingWaiting ? (
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-14 text-center">
          <svg viewBox="0 0 52 52" className="mx-auto mb-5 h-16 w-16 text-indigo-600" aria-hidden="true">
            <circle cx="26" cy="26" r="24" className="fill-indigo-50 stroke-indigo-200" strokeWidth="2" />
            <path
              className="approval-check"
              d="M16 27l7 7 14-16"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength="1"
            />
          </svg>
          <p className="text-slate-900 font-semibold text-lg">You're all caught up</p>
          <p className="text-slate-500 text-sm mt-2 max-w-sm mx-auto">
            Nothing is waiting on you. When a freelancer submits hours, they will land here ready to approve.
          </p>
        </div>
      ) : entries.length === 0 && totalCount > 0 ? (
        <p className="text-slate-500 text-sm">Loading the next submitted hours…</p>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-10 text-center">
          <p className="text-slate-800 font-medium">No rows match these filters</p>
          <button
            type="button"
            onClick={() => changeFilters(() => emptyFilters)}
            className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {weeks.length > 0 && <WeekCostChart weeks={weeks} />}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-sm">
            <p className="text-slate-600 tabular-nums">
              This page <span className="font-medium text-slate-900">{formatPounds(totalCost(entries))}</span>
              {selectedEntries.length > 0 && (
                <>
                  <span className="mx-2 text-slate-300">·</span>
                  Being approved{' '}
                  <span className="font-medium text-slate-900">{formatPounds(totalCost(selectedEntries))}</span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                title="Approve the selected rows on this page"
                aria-label={`Approve ${selectedEntries.length} selected`}
                disabled={decision.isPending || selectedEntries.length === 0}
                onClick={() => askToApprove(selectedEntries)}
                className={approveBulkClass}
              >
                <ApproveIcon />
                {decision.isPending ? 'Saving…' : `Approve ${selectedEntries.length}`}
              </button>
              <button
                type="button"
                title="Reject the selected rows on this page"
                aria-label={`Reject ${selectedEntries.length} selected`}
                disabled={decision.isPending || selectedEntries.length === 0}
                onClick={() => askToReject(selectedEntries)}
                className={rejectBulkClass}
              >
                <RejectIcon />
                {`Reject ${selectedEntries.length}`}
              </button>
            </div>
          </div>
          <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="w-8 px-3 py-2.5 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="accent-indigo-600 align-middle"
                    />
                  </th>
                  <th className="text-left pl-8 pr-4 py-2.5 font-medium text-slate-600">Freelancer</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-600">Hours</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-600">Cost</th>
                  <th className="text-left px-4 py-2.5 font-medium text-slate-600">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {groupByDay(entries).map((group, groupIndex) => {
                  const dateLabel = formatEntryDate(group.date)
                  const collapsed = collapsedDates.has(group.date)
                  const selectedInDay = group.entries.filter((entry) => selectedIds.has(entry.id)).length
                  const allInDaySelected = selectedInDay === group.entries.length
                  const countLabel = group.entries.length === 1 ? '1 timesheet' : `${group.entries.length} timesheets`
                  return (
                    <Fragment key={group.date}>
                      <tr className={groupIndex === 0 ? undefined : 'border-t border-slate-200'}>
                        <td colSpan={6} className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <DayCheckbox
                              checked={allInDaySelected}
                              indeterminate={selectedInDay > 0 && !allInDaySelected}
                              label={`Select all timesheets on ${dateLabel}`}
                              onChange={() => toggleDay(group.entries)}
                            />
                            <button
                              type="button"
                              aria-expanded={!collapsed}
                              aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${dateLabel}`}
                              onClick={() => toggleDayOpen(group.date)}
                              className="inline-flex items-center gap-1.5 rounded text-left font-medium text-slate-800 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              <ToggleArrow open={!collapsed} />
                              {dateLabel}
                              <span className="font-normal text-slate-400 text-xs">{countLabel}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {!collapsed && group.entries.map((entry) => (
                        <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="py-2 pl-9 pr-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${entry.freelancer.name} on ${dateLabel}`}
                              checked={selectedIds.has(entry.id)}
                              onChange={() => toggleOne(entry.id)}
                              className="accent-indigo-600"
                            />
                          </td>
                          <td className="py-2 pl-8 pr-4 text-slate-700">
                            <Link
                              to={`/contracts/${entry.contract}`}
                              className="text-indigo-600 hover:text-indigo-800 font-medium"
                            >
                              {entry.freelancer.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-slate-700 tabular-nums">{entry.hours}h</td>
                          <td className="px-4 py-2 text-slate-700 tabular-nums">{formatPounds(entryCost(entry.hours, entry.daily_rate))}</td>
                          <td className="px-4 py-2">
                            <StatusBadge status={entry.status} pulse />
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                title="Approve"
                                aria-label={`Approve ${entry.freelancer.name} on ${dateLabel}`}
                                disabled={decision.isPending}
                                onClick={() => askToApprove([entry])}
                                className={approveCircleClass}
                              >
                                <ApproveIcon />
                              </button>
                              <button
                                type="button"
                                title="Reject"
                                aria-label={`Reject ${entry.freelancer.name} on ${dateLabel}`}
                                disabled={decision.isPending}
                                onClick={() => askToReject([entry])}
                                className={rejectCircleClass}
                              >
                                <RejectIcon />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
              <p className="text-sm tabular-nums text-slate-600">
                Showing <span className="font-medium text-slate-900">{rangeStart}–{rangeEnd}</span> of {totalCount}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Rows
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value) as TimesheetPageSize)
                      setPage(1)
                      clearSelection()
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {TIMESHEET_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <nav aria-label="Pages" className="inline-flex items-center gap-1">
                  <PageStep label="First page" disabled={page <= 1} onClick={() => goToPage(1)}>
                    <Chevrons direction="left" />
                  </PageStep>
                  <PageStep label="Previous page" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                    <Chevron direction="left" />
                  </PageStep>
                  {visiblePages(page, pageCount).map((pageNumber, index) =>
                    pageNumber === 'ellipsis' ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="inline-flex h-8 min-w-8 items-center justify-center px-1 text-sm text-slate-400"
                      >
                        …
                      </span>
                    ) : (
                      <PageStep
                        key={pageNumber}
                        label={`Page ${pageNumber}`}
                        disabled={false}
                        current={pageNumber === page}
                        onClick={() => goToPage(pageNumber)}
                      >
                        {pageNumber}
                      </PageStep>
                    ),
                  )}
                  <PageStep label="Next page" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>
                    <Chevron direction="right" />
                  </PageStep>
                  <PageStep label="Last page" disabled={page >= pageCount} onClick={() => goToPage(pageCount)}>
                    <Chevrons direction="right" />
                  </PageStep>
                </nav>
              </div>
            </div>
          </div>
        </>
      )}
      {approveIds && (
        <ConfirmDialog title={`Approve ${decisionSubject(decisionRows, approveIds)}?`} onClose={() => setApproveIds(null)}>
          <p className="text-sm text-slate-600">
            This accepts {formatPounds(totalCost(decisionRows))}. Approved hours leave this queue.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              data-dialog-focus
              onClick={() => setApproveIds(null)}
              className="rounded-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={decision.isPending}
              onClick={() => decision.mutate({ ids: approveIds, status: 'approved' })}
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {decision.isPending ? 'Saving…' : `Approve ${approveIds.length}`}
            </button>
          </div>
        </ConfirmDialog>
      )}
      {rejectIds && (
        <ConfirmDialog title={`Reject ${decisionSubject(decisionRows, rejectIds)}?`} onClose={() => setRejectIds(null)}>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              const trimmed = reason.trim()
              if (!trimmed) return
              decision.mutate({ ids: rejectIds, status: 'rejected', rejectionReason: trimmed })
            }}
            className="space-y-3"
          >
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Rejection reason</span>
              <textarea
                data-dialog-focus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                rows={3}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Tell the freelancer why these hours were rejected"
              />
            </label>
            <p className="text-slate-500 text-xs">Nothing is sent until you confirm. The same reason goes with every selected row.</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectIds(null)}
                className="rounded-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={decision.isPending || reason.trim() === ''}
                className="rounded-full bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {decision.isPending ? 'Saving…' : `Reject ${rejectIds.length}`}
              </button>
            </div>
          </form>
        </ConfirmDialog>
      )}
    </div>
  )
}
