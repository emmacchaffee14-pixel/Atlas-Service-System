export function fmtDate(iso) {
  if (!iso) return ''
  const parts = String(iso).split('-')
  if (parts.length !== 3) return iso
  const [y, m, d] = parts.map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// Events are wall-clock times in Athens, GA — always Eastern, never stored
// with a timezone. Renders "5:30 PM" from a `time` column's "17:30" / "17:30:00".
export function fmtTime(hhmm) {
  if (!hhmm) return ''
  const [h, m] = String(hhmm).split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

export function fmtTimeRange(start, end) {
  if (!start || !end) return ''
  return `${fmtTime(start)}–${fmtTime(end)} EST`
}
