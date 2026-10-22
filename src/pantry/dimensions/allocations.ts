import { dimensionTags, dimensionValues } from '../dimensions'
import type { Data } from '../core'

/** Control balances retain the complete reviewed source tuple, including Unassigned. */
export function dimensionAmounts(sources: { source: Data; amount: number }[]) {
  const grouped = new Map<string, ReturnType<typeof dimensionTags> & { amount: number }>()
  for (const { source, amount } of sources) {
    const tags = dimensionTags(source), key = JSON.stringify(dimensionValues(tags))
    const previous = grouped.get(key)
    if (previous) previous.amount += amount
    else grouped.set(key, { ...tags, amount })
  }
  return [...grouped.values()].filter(row => row.amount !== 0)
}

/** Attribute new match postings to signed feed contributions after existing postings.
 * Consume contributions in source order; an opposite-direction new item restores
 * that share to the pool. The final item takes remaining offsetting contributions.
 * Every item's net and every source tuple's combined net are preserved exactly. */
export function distributeDimensionAmounts(sources: { source: Data; amount: number }[], amounts: number[]) {
  const pool = dimensionAmounts(sources)
  // Opposite items can cancel even when every source tuple has a zero net.
  if (!pool.length && amounts.length) pool.push({ ...dimensionTags(sources[0].source), amount: 0 })
  const slices = amounts.map(amount => {
    let remaining = amount
    const shares: { source: Data; amount: number }[] = []
    for (const row of pool) {
      if (!remaining || Math.sign(row.amount) !== Math.sign(remaining)) continue
      const used = Math.sign(remaining) * Math.min(Math.abs(row.amount), Math.abs(remaining))
      shares.push({ source: row, amount: used })
      row.amount -= used
      remaining -= used
    }
    if (remaining) {
      const row = pool[0]
      shares.push({ source: row, amount: remaining })
      row.amount -= remaining
    }
    return shares
  })
  if (slices.length) slices[slices.length - 1].push(...pool.map(row => ({ source: row, amount: row.amount })))
  return slices.map(dimensionAmounts)
}
