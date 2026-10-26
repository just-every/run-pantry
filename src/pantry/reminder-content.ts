import { longDay, optionalText, requireThat, usd, type Data } from './core'

const FIELDS = ['customer', 'business', 'invoice', 'due_date', 'balance', 'link']

export function reminderDays(raw: unknown): number[] {
  const days = (typeof raw === 'string' ? raw.split(/[,\s]+/).filter(Boolean) : Array.isArray(raw) ? raw : []).map(Number)
  requireThat(days.length <= 8 && days.every(d => Number.isInteger(d) && d >= -60 && d <= 120), 'Reminder days are whole numbers from -60 to 120, at most eight')
  return [...new Set(days)].sort((a, b) => a - b)
}

export function reminderWording(raw: unknown, label: string, max: number, current: string) {
  if (raw === undefined) return current
  const value = optionalText(raw, label, max)
  requireThat(label !== 'Reminder subject' || !/[\r\n]/.test(value), 'Reminder subject must be one line')
  const rest = value.replace(/\{\{([a-z_]+)\}\}/g, (_, field) => {
    requireThat(FIELDS.includes(field), `Unknown reminder field: ${field}`)
    return ''
  })
  requireThat(!rest.includes('{{') && !rest.includes('}}'), 'Use a supported reminder merge field')
  return value
}

export function renderReminder(value: string, inv: Data, business: string, customer: string, link: string) {
  const fields: Record<string, string> = { customer, business, invoice: inv.number, due_date: longDay(inv.due_date), balance: usd(inv.open_cents), link }
  return value.replace(/\{\{([a-z_]+)\}\}/g, (_, field) => fields[field])
}

export function customerReminderDays(customer: Data, defaults: number[]) {
  return customer.reminder_days === null || customer.reminder_days === undefined ? defaults : JSON.parse(customer.reminder_days) as number[]
}
