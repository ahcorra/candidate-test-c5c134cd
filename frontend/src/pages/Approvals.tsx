import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { TimesheetEntry } from '../api/client'
import { splitBulkResults } from '../approvals/bulk'
import { entryCost, formatPounds, totalCost } from '../approvals/cost'
import { fetchTimesheets, patchTimesheetEntry } from '../api/timesheets'
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
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<InboxFilters>(emptyFilters)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [rejectIds, setRejectIds] = useState<number[] | null>(null)
  const [reason, setReason] = useState('')
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const filtersActive = Object.values(filters).some((value) => value !== '')

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
      setFailureMessage(null)
      await queryClient.cancelQueries({ queryKey: ['timesheets'] })
      const snapshots = queryClient.getQueriesData<TimesheetEntry[]>({ queryKey: ['timesheets'] })
      const removing = new Set(input.ids)
      queryClient.setQueriesData<TimesheetEntry[]>({ queryKey: ['timesheets'] }, (current) =>
        current?.filter((entry) => !removing.has(entry.id)),
      )
      return { snapshots }
    },
    onSuccess: (outcome, _input, context) => {
      const lookup = new Map<number, TimesheetEntry>()
      for (const [, snapshot] of context?.snapshots ?? []) {
        for (const entry of snapshot ?? []) lookup.set(entry.id, entry)
      }
      if (outcome.failed.length > 0) {
        const failedIds = new Set(outcome.failed.map((item) => item.id))
        for (const [key, snapshot] of context?.snapshots ?? []) {
          const restored = (snapshot ?? []).filter((entry) => failedIds.has(entry.id))
          queryClient.setQueryData<TimesheetEntry[]>(key, (current) => {
            const present = new Set((current ?? []).map((entry) => entry.id))
            return [...(current ?? []), ...restored.filter((entry) => !present.has(entry.id))]
          })
        }
        const details = outcome.failed.map((item) => {
          const entry = lookup.get(item.id)
          const label = entry ? `${entry.freelancer.name} on ${entry.date}` : `entry ${item.id}`
          return `${label} (HTTP ${item.status || 'error'})`
        })
        setFailureMessage(`Some rows were not updated: ${details.join('; ')}.`)
        setSelectedIds(new Set(outcome.failed.map((item) => item.id)))
        return
      }
      setFailureMessage(null)
      setRejectIds(null)
      setReason('')
      setSelectedIds(new Set())
    },
    onError: (_error, _input, context) => {
      for (const [key, snapshot] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, snapshot)
      }
      setFailureMessage('The approval request did not finish. The queue has been restored.')
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['timesheets'] })
    },
  })

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
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={decision.isPending || selectedEntries.length === 0}
                onClick={() =>
                  decision.mutate({
                    ids: selectedEntries.map((entry) => entry.id),
                    status: 'approved',
                  })
                }
                className="bg-indigo-600 text-white text-sm px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {decision.isPending ? 'Saving…' : `Approve ${selectedEntries.length}`}
              </button>
              <button
                type="button"
                disabled={decision.isPending || selectedEntries.length === 0}
                onClick={() => {
                  setReason('')
                  setRejectIds(selectedEntries.map((entry) => entry.id))
                }}
                className="border border-red-300 text-red-700 text-sm px-4 py-2 rounded hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Reject {selectedEntries.length}
              </button>
            </div>
          </div>
          {failureMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
              {failureMessage}
            </div>
          )}
          {rejectIds && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                const trimmed = reason.trim()
                if (!trimmed) return
                decision.mutate({ ids: rejectIds, status: 'rejected', rejectionReason: trimmed })
              }}
              className="bg-white border border-slate-200 rounded-lg p-4 space-y-3"
            >
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Rejection reason</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  rows={3}
                  className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Tell the freelancer why these hours were rejected"
                />
              </label>
              <p className="text-slate-400 text-xs">The same reason is sent with every selected row.</p>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={decision.isPending || reason.trim() === ''}
                  className="bg-red-600 text-white text-sm px-4 py-2 rounded hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Reject {rejectIds.length}
                </button>
                <button
                  type="button"
                  onClick={() => setRejectIds(null)}
                  className="text-sm text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
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
                  <th className="px-4 py-3" />
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
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={decision.isPending}
                        onClick={() => decision.mutate({ ids: [entry.id], status: 'approved' })}
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-medium disabled:opacity-50 mr-3"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={decision.isPending}
                        onClick={() => {
                          setReason('')
                          setRejectIds([entry.id])
                        }}
                        className="text-red-600 hover:text-red-800 text-xs font-medium disabled:opacity-50"
                      >
                        Reject
                      </button>
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
