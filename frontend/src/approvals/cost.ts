export function entryCost(hours: string, dailyRate: string): number {
  const parsedHours = Number(hours)
  const parsedRate = Number(dailyRate)
  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedRate)) {
    return 0
  }
  return (parsedHours * parsedRate) / 8
}

export function totalCost(entries: Array<{ hours: string; daily_rate: string }>): number {
  return entries.reduce((sum, entry) => sum + entryCost(entry.hours, entry.daily_rate), 0)
}

export function formatPounds(amount: number): string {
  const [whole, fraction] = amount.toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `£${grouped}.${fraction}`
}
