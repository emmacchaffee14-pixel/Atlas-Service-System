import { useMemo } from 'react'
import { useMemberData } from '../../context/MemberDataContext.js'
import { fmtDate, fmtTimeRange } from '../../lib/format.js'
import { computeMemberStats, groupOf, keyOf, mentorName, reqHours, round, swabCap } from '../../lib/stats.js'

export default function Standing() {
  const { orgs, events, signups, logs, mentors, me, settings, myEmail } = useMemberData()

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  const stats = useMemo(
    () => computeMemberStats(myEmail, { logs, signups, eventsById, settings }),
    [myEmail, logs, signups, eventsById, settings],
  )
  const req = reqHours(settings)
  const cap = swabCap(settings)

  const myClaims = useMemo(
    () => signups.filter((s) => keyOf(s.member_email) === keyOf(myEmail)),
    [signups, myEmail],
  )
  const myLogs = useMemo(
    () => logs.filter((l) => keyOf(l.member_email) === keyOf(myEmail)),
    [logs, myEmail],
  )

  const figs = [
    ['Hours logged', stats.total, false],
    ['Counting toward requirement', stats.countable, false],
    ['Still needed', Math.max(0, round(req - stats.countable)), stats.countable < req],
    ['Upcoming spots claimed', stats.claims, false],
  ]

  const mentorLabel = me?.mentor_id
    ? `Mentor: ${mentorName(me.mentor_id, mentors)}${
        groupOf(me.mentor_id, mentors) ? '  ·  ' + groupOf(me.mentor_id, mentors) : '  ·  group not named yet'
      }`
    : 'No mentor on file yet. Choose one the next time you claim a spot.'

  return (
    <>
      <div className="pagehead">
        <h1>My Standing</h1>
        <p>
          {req} hours are required this semester. At most {cap} may come from the book drive.
        </p>
      </div>

      <section>
        <div className="figs">
          {figs.map(([label, value, warn]) => (
            <div className={'fig' + (warn ? ' warn' : '')} key={label}>
              <b>{value}</b>
              <span>{label}</span>
            </div>
          ))}
        </div>
        {stats.met ? (
          <div className="flag ok" style={{ marginTop: 16 }}>
            You have met the requirement for the semester.
          </div>
        ) : stats.swab > cap ? (
          <div className="flag" style={{ marginTop: 16 }}>
            You logged {stats.swab} book-drive hours but only {cap} counts. Serve at another
            partner to make up the rest.
          </div>
        ) : null}
        <p className="note" style={{ marginTop: 12 }}>
          {mentorLabel}
        </p>
      </section>

      <section>
        <div className="plate">
          <h2>Spots You Have Claimed</h2>
        </div>
        {myClaims.length === 0 ? (
          <p className="empty">Nothing claimed yet. Open Opportunities to pick a slot.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Transportation</th>
                </tr>
              </thead>
              <tbody>
                {myClaims.map((s) => {
                  const ev = eventsById.get(s.event_id)
                  if (!ev) return null
                  const org = orgsById.get(ev.org_id)
                  return (
                    <tr key={s.id}>
                      <td>{org?.name || ev.org_id}</td>
                      <td>{fmtDate(ev.event_date)}</td>
                      <td>{fmtTimeRange(ev.start_time, ev.end_time)}</td>
                      <td>{s.transportation ? 'Yes' : 'No'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="plate">
          <h2>Service You Have Logged</h2>
        </div>
        {myLogs.length === 0 ? (
          <p className="empty">No hours logged yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="n">Hours</th>
                  <th>Impact Metric</th>
                  <th className="n">Reported</th>
                </tr>
              </thead>
              <tbody>
                {myLogs.map((l) => {
                  const ev = eventsById.get(l.event_id)
                  const org = ev ? orgsById.get(ev.org_id) : null
                  return (
                    <tr key={l.id}>
                      <td>{ev ? `${org?.name || ev.org_id} — ${fmtDate(ev.event_date)}` : l.event_id}</td>
                      <td className="n">{String(l.hours)}</td>
                      <td>{org?.impact_metric || '—'}</td>
                      <td className="n">{l.quantity == null ? '' : String(l.quantity)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
