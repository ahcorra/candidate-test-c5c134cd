function parseIsoDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null
  }
  return parsed
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatCalendarDate(parsed: Date, includeYear: boolean): string {
  const weekday = weekdays[parsed.getDay()]
  const month = months[parsed.getMonth()]
  const label = `${weekday} ${parsed.getDate()} ${month}`
  return includeYear ? `${label} ${parsed.getFullYear()}` : label
}

export function formatWeekOf(isoDate: string): string {
  const parsed = parseIsoDate(isoDate)
  if (!parsed) return isoDate
  const month = months[parsed.getMonth()]
  return `Week of ${parsed.getDate()} ${month}`
}

export function formatEntryDate(isoDate: string, today: Date = new Date()): string {
  const parsed = parseIsoDate(isoDate)
  if (!parsed) return isoDate

  const dayDifference = Math.round((startOfDay(parsed) - startOfDay(today)) / 86_400_000)
  if (dayDifference === 0) return 'Today'
  if (dayDifference === -1) return 'Yesterday'
  return formatCalendarDate(parsed, parsed.getFullYear() !== today.getFullYear())
}
