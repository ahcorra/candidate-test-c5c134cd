import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { TimesheetEntry } from '../api/client'
import { fetchTimesheets } from '../api/timesheets'
import { StatusBadge } from '../components/StatusBadge'
import { useAuth } from '../hooks/useAuth'

function sortOldestFirst(entries: TimesheetEntry[]): TimesheetEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date))
}

export default function Approvals() {
  const { isAdmin } = useAuth()
  const entriesQuery = useQuery({
    queryKey: ['timesheets', { status: 'submitted' }],
    queryFn: () => fetchTimesheets({ status: 'submitted' }),
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Pending approvals</h1>
        <p className="text-slate-500 text-sm">Submitted hours waiting for a decision.</p>
      </div>

      {entriesQuery.isLoading ? (
        <p className="text-slate-500 text-sm">Loading submitted hours…</p>
      ) : entriesQuery.isError ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm">
          Failed to load submitted hours. Please refresh the page.
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-10 text-center">
          <p className="text-slate-800 font-medium">Nothing is waiting for approval</p>
          <p className="text-slate-500 text-sm mt-1">
            Submitted hours from your contracts will show up here.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Freelancer</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Hours</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
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
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
