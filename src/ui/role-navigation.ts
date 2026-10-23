// Navigation follows the same role boundaries as the native HTTP doors.
export function roleScreen(role: string, path: string, banksLimited = false) {
  if (role === 'owner') return true
  if (path === '/app/currency') return false
  if (path === '/app/collections') return false
  if (role === 'time-only') return path === '/app/time'
  if (path === '/app/search') return true
  if (role === 'sales' || role === 'payables-clerk') return ['/app/sales', '/app/time', '/app/reports'].some(p => path === p || path.startsWith(p + '/'))
  if (banksLimited) return ['/app/sales', '/app/bank', '/app/time', '/app/reports'].some(p => path === p || path.startsWith(p + '/'))
  return true
}

export function customReportsOnly(actor: Record<string, any>) {
  return actor.role !== 'owner' && (['sales', 'payables-clerk', 'time-only'].includes(actor.role) || actor.policy?.bankAccounts != null)
}
