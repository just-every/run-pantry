// Navigation follows the same role boundaries as the native HTTP doors.
export function roleScreen(role: string, path: string, banksLimited = false) {
  if (role === 'owner') return true
  if (role === 'time-only') return path === '/app/time'
  if (role === 'sales' || role === 'payables-clerk') return ['/app/sales', '/app/time', '/app/reports'].some(p => path === p || path.startsWith(p + '/'))
  if (banksLimited) return ['/app/sales', '/app/bank', '/app/time', '/app/reports'].some(p => path === p || path.startsWith(p + '/'))
  return true
}
