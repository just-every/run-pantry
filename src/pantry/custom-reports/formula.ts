import { requireThat } from '../core'
import type { ReportUnit } from './types'

export type FormulaExact = { numerator: bigint; denominator: bigint; dimension: number }
type Exact = FormulaExact
export type FormulaValue = { value: number | null; unit: ReportUnit; exact?: FormulaExact | null }
export type FormulaContext = { row: (id: string) => FormulaValue; account: (id: string) => FormulaValue }
type Node = (context: FormulaContext) => Exact | null

function fraction(numerator: bigint, denominator: bigint, dimension: number): Exact {
  requireThat(denominator !== 0n, 'A formula denominator cannot be zero')
  requireThat(numerator.toString().length <= 4096 && denominator.toString().length <= 4096, 'Formula precision is too large')
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator }
  let a = numerator < 0n ? -numerator : numerator, b = denominator
  while (b) { const remainder = a % b; a = b; b = remainder }
  const divisor = a || 1n
  return { numerator: numerator / divisor, denominator: denominator / divisor, dimension }
}

function decimal(value: string): Exact {
  const [whole, fractional = ''] = value.split('.')
  return fraction(BigInt(whole + fractional), 10n ** BigInt(fractional.length), 0)
}

function reference(value: FormulaValue): Exact | null {
  if (value.exact !== undefined) return value.exact
  if (value.value === null) return null
  requireThat(Number.isFinite(value.value), 'Formula references must be finite')
  if (value.unit === 'money') {
    requireThat(Number.isSafeInteger(value.value), 'Money references must be integer cents')
    return fraction(BigInt(value.value), 1n, 1)
  }
  requireThat(Number.isSafeInteger(Math.round(value.value * 100)), 'Formula reference is too large')
  return fraction(BigInt(Math.round(value.value * 100)), 100n, 0)
}

function arithmetic(left: Exact | null, right: Exact | null, operator: string): Exact | null {
  if (!left || !right) return null
  const { numerator: a, denominator: b, dimension: x } = left
  const { numerator: c, denominator: d, dimension: y } = right
  if (operator === '+' || operator === '-') {
    requireThat(x === y, 'Add or subtract values with the same units')
    return fraction(a * d + (operator === '+' ? c : -c) * b, b * d, x)
  }
  if (operator === '*') return fraction(a * c, b * d, x + y)
  return c === 0n ? null : fraction(a * d, b * c, x - y)
}

/** No JavaScript evaluation. References are row("earlier-id") or account("id").
 * Money references use integer cents. Numeric literals are
 * dimensionless. Percent outputs require explicit * 100; no implicit scaling.
 * Exact rational arithmetic rounds half away from zero only at the result.
 */
export function compileFormula(expression: string, unit: ReportUnit): ((context: FormulaContext) => number | null) & { exact: (context: FormulaContext) => FormulaExact | null } {
  requireThat(typeof expression === 'string' && expression.length > 0 && expression.length <= 2000, 'Formula needs 1–2000 characters')
  requireThat(['money', 'ratio', 'percent'].includes(unit), 'Formula unit is money, ratio or percent')
  const tokens: string[] = []
  const pattern = /\s*(row|account|\d+(?:\.\d{1,8})?|"(?:[^"\\\r\n]|\\["\\])*"|[()+*/,-])/gy
  let position = 0
  while (position < expression.length) {
    if (!expression.slice(position).trim()) break
    pattern.lastIndex = position
    const match = pattern.exec(expression)
    requireThat(match, 'Formula supports numbers, row("id"), account("id"), + - * / and parentheses')
    tokens.push(match[1]); position = pattern.lastIndex
  }
  requireThat(tokens.length <= 400, 'Formula is too complex')
  let index = 0, depth = 0
  const take = (token: string) => { requireThat(tokens[index++] === token, `Expected ${token} in formula`) }
  const atom = (): Node => {
    requireThat(++depth <= 40, 'Formula nesting is too deep')
    const token = tokens[index++]
    let node: Node
    if (token === '+' || token === '-') {
      const next = atom()
      node = context => { const value = next(context); return value && token === '-' ? { ...value, numerator: -value.numerator } : value }
    } else if (token === '(') { node = sum(); take(')') }
    else if (token === 'row' || token === 'account') {
      take('(')
      const quoted = tokens[index++]
      requireThat(quoted?.startsWith('"'), 'Formula references need a quoted ID')
      const id = JSON.parse(quoted) as string
      requireThat(id.length > 0 && id.length <= 200, 'Formula reference ID is invalid')
      take(')')
      node = context => reference(context[token](id))
    } else {
      requireThat(/^\d+(?:\.\d{1,8})?$/.test(token ?? ''), 'Expected a value in formula')
      const value = decimal(token); node = () => value
    }
    depth--; return node
  }
  const product = (): Node => {
    let node = atom()
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++], left = node, right = atom()
      node = context => arithmetic(left(context), right(context), operator)
    }
    return node
  }
  const sum = (): Node => {
    let node = product()
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++], left = node, right = product()
      node = context => arithmetic(left(context), right(context), operator)
    }
    return node
  }
  const result = sum()
  requireThat(index === tokens.length, 'Unexpected text after formula')
  const exact = (context: FormulaContext) => {
    const value = result(context)
    if (value === null) return null
    requireThat(value.dimension === (unit === 'money' ? 1 : 0), `Formula result must have ${unit === 'money' ? 'money' : 'dimensionless'} units`)
    return value
  }
  return Object.assign((context: FormulaContext) => roundFormula(exact(context), unit), { exact })
}

export function roundFormula(value: FormulaExact | null, unit: ReportUnit): number | null {
  if (value === null) return null
  const scale = unit === 'money' ? 1n : 100n
  const magnitude = (value.numerator < 0n ? -value.numerator : value.numerator) * scale
  const rounded = (2n * magnitude + value.denominator) / (2n * value.denominator)
  const signed = Number(rounded) * (value.numerator < 0n ? -1 : 1)
  requireThat(Number.isSafeInteger(signed), 'Formula result is too large')
  return signed / Number(scale)
}

export const exactFormulaValue = (value: FormulaValue): FormulaExact | null => reference(value)
export const addFormulaValues = (left: FormulaExact | null, right: FormulaExact | null) => arithmetic(left, right, '+')

export const evaluateFormula = (expression: string, context: FormulaContext, unit: ReportUnit) => compileFormula(expression, unit)(context)
