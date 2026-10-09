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

function isoOf(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function todayISO() {
  return isoOf(new Date())
}

// Weeks run Monday–Sunday. "This week" starts today (days already gone are
// not "coming up"); "next week" is the following Monday through Sunday.
export function weekBounds(now = new Date()) {
  const dow = (now.getDay() + 6) % 7 // Monday = 0
  const thisSun = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dow))
  const nextMon = new Date(thisSun.getFullYear(), thisSun.getMonth(), thisSun.getDate() + 1)
  const nextSun = new Date(thisSun.getFullYear(), thisSun.getMonth(), thisSun.getDate() + 7)
  return { today: isoOf(now), thisEnd: isoOf(thisSun), nextStart: isoOf(nextMon), nextEnd: isoOf(nextSun) }
}
