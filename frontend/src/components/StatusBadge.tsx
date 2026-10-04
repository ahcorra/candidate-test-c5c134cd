const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  active: 'bg-indigo-100 text-indigo-800',
  closed: 'bg-slate-100 text-slate-500',
}

export function StatusBadge({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium capitalize ${pulse ? 'rounded-full' : 'rounded'} ${cls}`}>
      {pulse && (
        <span className="h-1.5 w-1.5 rounded-full bg-current approval-pulse" aria-hidden="true" />
      )}
      {status}
    </span>
  )
}
