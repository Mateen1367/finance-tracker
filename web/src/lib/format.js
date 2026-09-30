let symbol = '$'

export function setCurrencySymbol(value) {
  symbol = value || '$'
}

export function money(value, { signed = false, whole = false } = {}) {
  const n = Number(value) || 0
  const digits = whole ? 0 : 2
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const sign = n < -0.004 ? '−' : signed && n > 0.004 ? '+' : ''
  return `${sign}${symbol}${body}`
}

export function compactMoney(value) {
  const n = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (n >= 1e6) return `${sign}${symbol}${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${sign}${symbol}${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return `${sign}${symbol}${Math.round(n)}`
}

export function parseDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d || 1)
}

export function isoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function currentMonth() {
  return isoDate().slice(0, 7)
}

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number)
  return isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7)
}

export function monthLabel(month, { short = false } = {}) {
  return parseDate(`${month}-01`).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: 'numeric' })
}

export function daysUntil(iso) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((parseDate(iso) - today) / 86400000)
}

export function dayLabel(iso) {
  const diff = daysUntil(iso)
  if (diff === 0) return 'Today'
  if (diff === -1) return 'Yesterday'
  if (diff === 1) return 'Tomorrow'
  const d = parseDate(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
}

export function shortDate(iso) {
  return parseDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function relativeDays(iso) {
  const diff = daysUntil(iso)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff > 1) return `in ${diff} days`
  if (diff === -1) return 'yesterday'
  return `${-diff} days ago`
}

export function timeAgo(isoDateTime) {
  if (!isoDateTime) return 'never'
  const minutes = Math.round((Date.now() - new Date(isoDateTime).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} days ago`
}

export function greeting(name) {
  const hour = new Date().getHours()
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return name ? `${part}, ${name}` : part
}
