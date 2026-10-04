import { TimesheetWeek } from '../api/timesheets'
import { formatWeekOf } from './dates'
import { formatPounds } from './cost'

export function WeekCostChart({ weeks }: { weeks: TimesheetWeek[] }) {
  const maxCost = Math.max(...weeks.map((week) => Number(week.cost)), 0)

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4" aria-label="Cost waiting by week">
      <h2 className="text-sm font-medium text-slate-700 mb-3">Cost waiting by week</h2>
      <ul className="space-y-2">
        {weeks.map((week) => {
          const cost = Number(week.cost)
          const width = maxCost > 0 ? Math.max((cost / maxCost) * 100, cost > 0 ? 2 : 0) : 0
          return (
            <li key={week.week_start} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="text-slate-600">{formatWeekOf(week.week_start)}</span>
              <span className="h-2 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                <span className="block h-2 rounded-full bg-indigo-600" style={{ width: `${width}%` }} />
              </span>
              <span className="text-right font-medium text-slate-900 tabular-nums">{formatPounds(cost)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
