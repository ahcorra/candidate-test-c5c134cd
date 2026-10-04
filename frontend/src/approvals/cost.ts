// Pence for one row, rounded half up, so every total equals the sum of the rows shown.
function entryPence(hours: string, dailyRate: string): number {
  const hundredthsOfAnHour = Math.round(Number(hours) * 100)
  const rateInPence = Math.round(Number(dailyRate) * 100)
  if (!Number.isFinite(hundredthsOfAnHour) || !Number.isFinite(rateInPence)) {
    return 0
  }
  return Math.round((hundredthsOfAnHour * rateInPence) / 800)
}

export function entryCost(hours: string, dailyRate: string): number {
  return entryPence(hours, dailyRate) / 100
}

export function totalCost(entries: Array<{ hours: string; daily_rate: string }>): number {
  return entries.reduce((sum, entry) => sum + entryPence(entry.hours, entry.daily_rate), 0) / 100
}

export function formatPounds(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}£${grouped}.${fraction}`
}
