import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { TimesheetEntry } from '../api/client'
import { entryCost, formatPounds, totalCost } from '../approvals/cost'
import { fetchTimesheets } from '../api/timesheets'
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

function sortOldestFirst(entries: TimesheetEntry[]): TimesheetEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date))
}

function uniqueOptions(entries: TimesheetEntry[], kind: 'contract' | 'freelancer'): Array<[string, string]> {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    if (kind === 'contract') {
      seen.set(String(entry.contract), entry.freelancer.name)
    } else {
      seen.set(String(entry.freelancer.id), entry.freelancer.name)
    }
  }
  return [...seen.entries()].sort((left, right) => left[1].localeCompare(right[1]))
}

export default function Approvals() {
  const { isAdmin } = useAuth()
  const [filters, setFilters] = useState<InboxFilters>(emptyFilters)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const filtersActive = Object.values(filters).some((value) => value !== '')

  const optionsQuery = useQuery({
    queryKey: ['timesheets', { status: 'submitted' }],
    queryFn: () => fetchTimesheets({ status: 'submitted' }),
    enabled: isAdmin,
  })

  const entriesQuery = useQuery({
    queryKey: ['timesheets', { status: 'submitted', ...filters }],
    queryFn: () =>
      fetchTimesheets({
        status: 'submitted',
        contract: filters.contractId ? Number(filters.contractId) : undefined,
        freelancer: filters.freelancerId ? Number(filters.freelancerId) : undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      }),
    enabled: isAdmin,
  })

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

  const entries = sortOldestFirst(entriesQuery.data ?? [])
  const selectedEntries = entries.filter((entry) => selectedIds.has(entry.id))
  const allVisibleSelected = entries.length > 0 && selectedEntries.length === entries.length
  const optionSource = optionsQuery.data ?? []
  const isLoading = optionsQuery.isLoading || entriesQuery.isLoading
  const isError = optionsQuery.isError || entriesQuery.isError
  const nothingWaiting = !isLoading && !isError && (optionsQuery.data?.length ?? 0) === 0

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Pending approvals</h1>
        <p className="text-slate-500 text-sm">Submitted hours waiting for a decision.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Contract</span>
            <select
              value={filters.contractId}
              onChange={(event) => setFilters((current) => ({ ...current, contractId: event.target.value }))}
              className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All contracts</option>
              {uniqueOptions(optionSource, 'contract').map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Freelancer</span>
            <select
              value={filters.freelancerId}
              onChange={(event) => setFilters((current) => ({ ...current, freelancerId: event.target.value }))}
              className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All freelancers</option>
              {uniqueOptions(optionSource, 'freelancer').map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">From</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
              className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">To</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
              className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>
        {filtersActive && (
          <button
            type="button"
            onClick={() => setFilters(emptyFilters)}
            className="mt-3 text-sm text-indigo-600 hover:text-indigo-800"
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-500 text-sm">Loading submitted hours…</p>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm">
          Failed to load submitted hours. Please refresh the page.
        </div>
      ) : nothingWaiting ? (
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-10 text-center">
          <p className="text-slate-800 font-medium">Nothing is waiting for approval</p>
          <p className="text-slate-500 text-sm mt-1">
            Submitted hours from your contracts will show up here.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-10 text-center">
          <p className="text-slate-800 font-medium">No rows match these filters</p>
          <button
            type="button"
            onClick={() => setFilters(emptyFilters)}
            className="mt-2 text-sm text-indigo-600 hover:text-indigo-800"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-slate-600">
              Queue total <span className="font-medium text-slate-900">{formatPounds(totalCost(entries))}</span>
              <span className="mx-2 text-slate-300">·</span>
              Being approved{' '}
              <span className="font-medium text-slate-900">{formatPounds(totalCost(selectedEntries))}</span>
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible rows"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Freelancer</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Hours</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Cost</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${entry.freelancer.name} on ${entry.date}`}
                        checked={selectedIds.has(entry.id)}
                        onChange={() => toggleOne(entry.id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{entry.date}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <Link
                        to={`/contracts/${entry.contract}`}
                        className="text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        {entry.freelancer.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{entry.hours}h</td>
                    <td className="px-4 py-3 text-slate-700">{formatPounds(entryCost(entry.hours, entry.daily_rate))}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
