import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import ComingUp from '../../components/ComingUp.jsx'
import { fmtDate } from '../../lib/format.js'
import { computeEventStats, computeMemberStats, reqHours, round, swabCap } from '../../lib/stats.js'

const STANDING = [
  ['met', 'Requirement met'],
  ['part', 'Hours logged, short'],
  ['signed', 'Signed up, nothing logged'],
  ['none', 'No activity'],
]

export default function Dashboard() {
  const { settings, roster, mentors, orgs, events, signups, logs, nominations } = useAdminData()

  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  // Officers and admins run the cohort but aren't held to the service-hour
  // requirement themselves, so they're left out of member-facing stats here.
  const memberRoster = useMemo(() => roster.filter((m) => !m.is_officer), [roster])

  const memberStats = useMemo(
    () =>
      memberRoster.map((m) => ({
        member: m,
        stats: computeMemberStats(m.email, { logs, signups, eventsById, settings }),
      })),
    [memberRoster, logs, signups, eventsById, settings],
  )

  const met = memberStats.filter((r) => r.stats.met).length
  const counts = { met: 0, part: 0, signed: 0, none: 0 }
  memberStats.forEach(({ stats }) => {
    counts[stats.met ? 'met' : stats.total > 0 ? 'part' : stats.claims > 0 ? 'signed' : 'none']++
  })
  const n = memberRoster.length
  const req = reqHours(settings)
  const cap = swabCap(settings)

  const totalHours = round(logs.reduce((sum, l) => sum + (Number(l.hours) || 0), 0))
  const served = memberStats.filter((r) => r.stats.total > 0).length
  const pendingNoms = nominations.filter((x) => (x.status || 'pending') === 'pending').length

  // The year-end headline numbers CLAUDE.md describes ("books donated",
  // "meals cooked") — verified impact (per-event average, never the raw
  // reported sum), rolled up by metric so two partners sharing a metric
  // land in one figure instead of two separate partner rows.
  const impactByMetric = useMemo(() => {
    const by = new Map()
    events.forEach((ev) => {
      const org = orgs.find((o) => o.id === ev.org_id)
      const metric = (org?.impact_metric || '').trim()
      if (!metric) return
      const stats = computeEventStats(ev, { signups, logs })
      if (!stats.verified) return
      const key = metric.toLowerCase()
      if (!by.has(key)) by.set(key, { metric, verified: 0, partners: new Set() })
      const agg = by.get(key)
      agg.verified += stats.verified
      agg.partners.add(org?.name || ev.org_id)
    })
    return [...by.values()].sort((a, b) => b.verified - a.verified)
  }, [events, orgs, signups, logs])

  const mentorProgress = useMemo(
    () =>
      mentors
        .map((m) => {
          const mine = memberStats.filter((r) => r.member.mentor_id === m.id)
          return {
            id: m.id,
            name: m.name,
            group: m.group_name,
            total: mine.length,
            met: mine.filter((r) => r.stats.met).length,
            avg: mine.length ? round(mine.reduce((t, r) => t + r.stats.countable, 0) / mine.length) : 0,
          }
        })
        .filter((g) => g.total > 0)
        .sort((a, b) => b.met / b.total - a.met / a.total || a.name.localeCompare(b.name)),
    [mentors, memberStats],
  )

  // Dismissals are a per-device convenience, keyed by the message text — if
  // the underlying numbers change the message changes and it comes back.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('atlas-dismissed-issues') || '[]')
    } catch {
      return []
    }
  })
  function saveDismissed(next) {
    setDismissed(next)
    try {
      localStorage.setItem('atlas-dismissed-issues', JSON.stringify(next))
    } catch {
      // Not persisting is fine — it just reappears next visit.
    }
  }

  const issues = []
  if (pendingNoms) issues.push(`${pendingNoms} nomination${pendingNoms === 1 ? '' : 's'} waiting on review.`)
  const noMentor = memberRoster.filter((m) => !m.mentor_id).length
  if (noMentor) {
    issues.push(
      `${noMentor} of ${memberRoster.length} members have no mentor assigned, so group reporting is incomplete. Fix it under Groups.`,
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
    // A registration link is enough to point members at GivePulse — only
    // flag a TBD code when there's no link on the partner or any of its events.
    const hasLink = o.givepulse_link || events.some((e) => e.org_id === o.id && e.givepulse_link)
    if (o.active !== false && o.givepulse_code === 'TBD' && !hasLink) {
      issues.push(`${o.name} still needs its GivePulse code.`)
    }
  })

  const visibleIssues = issues.filter((i) => !dismissed.includes(i))

  return (
    <>
      <div className="pagehead">
        <h1>Cohort Dashboard</h1>
        {settings?.semester && <p>{settings.semester}</p>}
      </div>

      <ComingUp />

      <section>
        <div className="plate">
          <h2>Membership Standing</h2>
          <span>{n ? `${n} members` : 'No roster loaded'}</span>
        </div>
        <p className="hero-line">
          <b>{met}</b> of {n} have completed {req} service hours
          {n ? ` (${Math.round((met / n) * 100)}%)` : ''}
        </p>
        <div className="stackbar" role="img" aria-label="Standing breakdown">
          {STANDING.map(([key, label]) =>
            counts[key] ? (
              <i key={key} className={`seg ${key}`} style={{ flexGrow: counts[key] }} title={`${label}: ${counts[key]}`} />
            ) : null,
          )}
        </div>
        <div className="stat-legend">
          {STANDING.map(([key, label]) => (
            <span key={key}>
              <i className={`seg ${key}`} />
              <b>{counts[key]}</b> {label}
            </span>
          ))}
        </div>
        <div className="statline">
          {[
            ['Hours logged', totalHours],
            ['Spots claimed', signups.length],
            ['Members who served', served],
            ['Service logs', logs.length],
          ].map(([label, value]) => (
            <div key={label}>
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
        {mentorProgress.length > 0 && (
          <details className="mapwrap">
            <summary>Progress by mentor group</summary>
            <div className="bars flat">
              {mentorProgress.map((g) => (
                <div className="barrow" key={g.id}>
                  <div className="barname">
                    <b>{g.name}</b>
                    {g.group && <small>{g.group}</small>}
                  </div>
                  <div className="bartrack" title={`${g.met} of ${g.total} met`}>
                    <i style={{ width: `${g.total ? (g.met / g.total) * 100 : 0}%` }} />
                  </div>
                  <div className="barval">
                    <b>{g.met}</b>/{g.total}
                    <small>avg {g.avg} hrs</small>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section>
        <div className="plate">
          <h2>Impact This Semester</h2>
        </div>
        {impactByMetric.length === 0 ? (
          <p className="empty">No verified impact yet — it fills in once service logs report a quantity.</p>
        ) : (
          <>
            <div className="figs">
              {impactByMetric.map((agg) => (
                <div
                  className="fig"
                  key={agg.metric}
                  title={[...agg.partners].join(', ')}
                >
                  <b>{agg.verified}</b>
                  <span>{agg.metric}</span>
                </div>
              ))}
            </div>
            <p className="note">
              Verified impact only — the per-event average, not the raw sum of every member&rsquo;s
              answer. Hover a figure to see which partners feed it.
            </p>
          </>
        )}
      </section>

      <section>
        <div className="plate">
          <h2>Needs Attention</h2>
        </div>
        {visibleIssues.length === 0 ? (
          <div className="flag ok">Nothing needs attention.</div>
        ) : (
          visibleIssues.map((issue) => (
            <div className="flag flag-row" key={issue}>
              <span>{issue}</span>
              <button
                type="button"
                className="flag-x"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => saveDismissed([...dismissed, issue])}
              >
                &times;
              </button>
            </div>
          ))
        )}
        {issues.length > visibleIssues.length && (
          <button type="button" className="linkbtn" onClick={() => saveDismissed([])}>
            Show {issues.length - visibleIssues.length} dismissed
          </button>
        )}
      </section>
    </>
  )
}
