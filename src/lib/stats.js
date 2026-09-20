export function round(n) {
  return Math.round(n * 10) / 10
}

export function keyOf(email) {
  return String(email || '').trim().toLowerCase()
}

export function reqHours(settings) {
  return settings?.hour_requirement != null ? Number(settings.hour_requirement) : 3
}

export function swabCap(settings) {
  return settings?.swab_cap != null ? Number(settings.swab_cap) : 1
}

export function isAdos(event) {
  return event?.org_id === 'ados'
}

export function groupOf(mentorId, mentors) {
  return mentors.find((m) => m.id === mentorId)?.group_name || ''
}

export function mentorName(mentorId, mentors) {
  return mentors.find((m) => m.id === mentorId)?.name || ''
}

// Mirrors the prototype's stats(email): total/countable hours, book-drive
// hours, claims and whether the semester requirement is met.
export function computeMemberStats(email, { logs, signups, eventsById, settings }) {
  const k = keyOf(email)
  const mine = logs.filter((l) => keyOf(l.member_email) === k)
  let total = 0
  let swab = 0
  mine.forEach((l) => {
    const h = Number(l.hours) || 0
    total += h
    if (isAdos(eventsById.get(l.event_id))) swab += h
  })
  const countable = round(total - Math.max(0, swab - swabCap(settings)))
  return {
    total: round(total),
    swab: round(swab),
    countable,
    logsCount: mine.length,
    claims: signups.filter((s) => keyOf(s.member_email) === k).length,
    met: countable >= reqHours(settings),
  }
}

// Mirrors the prototype's evStats(ev): claimed/capacity, logs, hours,
// reported (sum of every answer) vs verified (per-event average).
export function computeEventStats(event, { signups, logs }) {
  const claims = signups.filter((s) => s.event_id === event.id)
  const eventLogs = logs.filter((l) => l.event_id === event.id)
  let hours = 0
  let reported = 0
  let qn = 0
  eventLogs.forEach((l) => {
    hours += Number(l.hours) || 0
    if (l.quantity != null && l.quantity !== '') {
      reported += Number(l.quantity) || 0
      qn++
    }
  })
  return {
    claimed: claims.length,
    capacity: Number(event.capacity) || 0,
    logsCount: eventLogs.length,
    hours: round(hours),
    reported,
    verified: qn ? Math.round(reported / qn) : 0,
  }
}
