import { useMemo } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { fmtDate } from '../../lib/format.js'
import { computeEventStats, computeMemberStats, reqHours, round, swabCap } from '../../lib/stats.js'

const LEGEND = [
  ['met', 'Requirement met'],
  ['part', 'Hours logged, short'],
  ['sig', 'Signed up, nothing logged'],
  ['', 'No activity'],
]

export default function Dashboard() {
  const { settings, roster, mentors, orgs, events, signups, logs, nominations } = useAdminData()

  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  const memberStats = useMemo(
    () =>
      roster.map((m) => ({
        member: m,
        stats: computeMemberStats(m.email, { logs, signups, eventsById, settings }),
      })),
    [roster, logs, signups, eventsById, settings],
  )

  const met = memberStats.filter((r) => r.stats.met).length
  const n = roster.length
  const req = reqHours(settings)
  const cap = swabCap(settings)

  const totalHours = round(logs.reduce((sum, l) => sum + (Number(l.hours) || 0), 0))
  const served = memberStats.filter((r) => r.stats.total > 0).length
  const pendingNoms = nominations.filter((x) => (x.status || 'pending') === 'pending').length

  const issues = []
  const noMentor = roster.filter((m) => !m.mentor_id).length
  if (noMentor) {
    issues.push(
      `${noMentor} of ${roster.length} members have no mentor assigned, so group reporting is incomplete. Fix it under Groups.`,
    )
  }
  const noGroup = mentors.filter((m) => !m.group_name).length
  if (noGroup) issues.push(`${noGroup} of ${mentors.length} mentors have no group name yet.`)
  events.forEach((ev) => {
    const s = computeEventStats(ev, { signups, logs })
    if (s.capacity && s.logsCount > s.claimed) {
      const org = orgs.find((o) => o.id === ev.org_id)
      issues.push(
        `${org?.name || ev.org_id} — ${fmtDate(ev.event_date)} has more logs (${s.logsCount}) than claimed spots (${s.claimed}).`,
      )
    }
  })
  const overCap = memberStats.filter((r) => r.stats.swab > cap).length
  if (overCap) issues.push(`${overCap} member(s) logged more book-drive hours than the cap allows.`)
  orgs.forEach((o) => {
    if (o.active !== false && o.givepulse_code === 'TBD') {
      issues.push(`${o.name} still needs its GivePulse code.`)
    }
  })

  return (
    <>
      <div className="pagehead">
        <h1>Cohort Dashboard</h1>
        {settings?.semester && <p>{settings.semester}</p>}
      </div>

      <section>
        <div className="plate">
          <h2>Membership Standing</h2>
        </div>
        <p className="note">
          {n ? `${met} of ${n} members eligible · ${Math.round((met / n) * 100)}% of roster` : 'No roster loaded'}
        </p>
        <div className="muster">
          {memberStats.map(({ member, stats }) => {
            const s = stats.met ? 'met' : stats.total > 0 ? 'part' : stats.claims > 0 ? 'signed' : 'none'
            return (
              <div
                key={member.email}
                className="mk"
                data-s={s}
                title={`${member.full_name} — ${stats.countable} of ${req} hours`}
              />
            )
          })}
        </div>
        <div className="legend">
          {LEGEND.map(([cls, label]) => (
            <span key={label} className={cls || undefined}>
              <i />
              {label}
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className="plate">
          <h2>Program Totals</h2>
        </div>
        <div className="figs">
          {[
            ['Hours logged', totalHours],
            ['Service logs', logs.length],
            ['Spots claimed', signups.length],
            ['Members who served', served],
            ['Meeting requirement', met],
            ['Nominations waiting', pendingNoms],
          ].map(([label, value]) => (
            <div className="fig" key={label}>
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="plate">
          <h2>Needs Attention</h2>
        </div>
        {issues.length === 0 ? (
          <div className="flag ok">Nothing needs attention.</div>
        ) : (
          issues.map((issue) => (
            <div className="flag" key={issue}>
              {issue}
            </div>
          ))
        )}
      </section>
    </>
  )
}
