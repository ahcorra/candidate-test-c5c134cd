import { describe, expect, it } from 'vitest'
import { entryCost, formatPounds, totalCost } from './cost'

describe('entry cost', () => {
  it('prices 8 hours at a 600 pound day as 600', () => {
    expect(entryCost('8.0', '600.00')).toBe(600)
  })

  it('scales a partial day', () => {
    expect(entryCost('4', '600')).toBe(300)
  })

  it('totals an empty selection as 0', () => {
    expect(totalCost([])).toBe(0)
  })

  it('groups thousands in a pound amount', () => {
    expect(formatPounds(10225)).toBe('£10,225.00')
    expect(formatPounds(450)).toBe('£450.00')
  })
})
