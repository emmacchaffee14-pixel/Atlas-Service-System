import { useMemo } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { fmtDate, fmtTimeRange } from '../../lib/format.js'
import { computeEventStats, keyOf, mentorName, round } from '../../lib/stats.js'

export default function Events() {
  const { roster, mentors, orgs, events, signups, logs } = useAdminData()

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const rosterByEmail = useMemo(() => new Map(roster.map((r) => [keyOf(r.email), r])), [roster])

  const sortedEvents = useMemo(
    () => [...events].sort((x, y) => (x.event_date || '').localeCompare(y.event_date || '')),
    [events],
  )

  const eventRows = useMemo(
    () => sortedEvents.map((ev) => ({ ev, stats: computeEventStats(ev, { signups, logs }) })),
    [sortedEvents, signups, logs],
  )

  const totals = eventRows.reduce(
    (t, { stats }) => ({
      claimed: t.claimed + stats.claimed,
      capacity: t.capacity + stats.capacity,
      logsCount: t.logsCount + stats.logsCount,
      hours: t.hours + stats.hours,
      reported: t.reported + stats.reported,
      verified: t.verified + stats.verified,
    }),
    { claimed: 0, capacity: 0, logsCount: 0, hours: 0, reported: 0, verified: 0 },
  )

  const partnerRows = useMemo(() => {
    const by = new Map()
    eventRows.forEach(({ ev, stats }) => {
      if (!by.has(ev.org_id)) by.set(ev.org_id, { n: 0, logsCount: 0, hours: 0, verified: 0 })
      const agg = by.get(ev.org_id)
      agg.n++
      agg.logsCount += stats.logsCount
      agg.hours += stats.hours
      agg.verified += stats.verified
    })
    return [...by.entries()].map(([orgId, agg]) => ({ org: orgsById.get(orgId), orgId, agg }))
  }, [eventRows, orgsById])

  const signupSections = eventRows.filter(({ ev }) =>
    signups.some((s) => s.event_id === ev.id),
  )

  return (
    <>
      <div className="pagehead">
        <h1>Events</h1>
        <p>Claims, logs and impact per event. Capacity is enforced at claim time.</p>
      </div>

      <section>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Time</th>
                <th>Date</th>
                <th className="n">Claimed</th>
                <th className="n">Cap</th>
                <th className="n">Logs</th>
                <th className="n">Hours</th>
                <th className="n">Reported</th>
                <th className="n">Verified</th>
                <th className="n">Show Rate</th>
              </tr>
            </thead>
            <tbody>
              {eventRows.map(({ ev, stats }) => (
                <tr key={ev.id}>
                  <td>{orgsById.get(ev.org_id)?.name || ev.org_id}</td>
                  <td>{fmtTimeRange(ev.start_time, ev.end_time)}</td>
                  <td>{fmtDate(ev.event_date)}</td>
                  <td className="n">{stats.claimed}</td>
                  <td className="n">{stats.capacity ? stats.capacity : 'open'}</td>
                  <td className="n">{stats.logsCount}</td>
                  <td className="n">{stats.hours}</td>
                  <td className="n">{stats.reported}</td>
                  <td className="n">{stats.verified}</td>
                  <td className="n">
                    {stats.claimed ? `${Math.round((stats.logsCount / stats.claimed) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
              <tr className="tot">
                <td>Total</td>
                <td></td>
                <td></td>
                <td className="n">{totals.claimed}</td>
                <td className="n">{totals.capacity}</td>
                <td className="n">{totals.logsCount}</td>
                <td className="n">{round(totals.hours)}</td>
                <td className="n">{totals.reported}</td>
                <td className="n">{totals.verified}</td>
                <td className="n">
                  {totals.claimed ? `${Math.round((totals.logsCount / totals.claimed) * 100)}%` : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note">
          Reported adds up every member&rsquo;s answer, which double-counts a shared group total.
          Verified is the per-event average.
        </p>
      </section>

      <section>
        <div className="plate">
          <h2>Partners</h2>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Partner</th>
                <th>Impact Metric</th>
                <th className="n">Events</th>
                <th className="n">Logs</th>
                <th className="n">Hours</th>
                <th className="n">Verified Impact</th>
              </tr>
            </thead>
            <tbody>
              {partnerRows.map(({ org, orgId, agg }) => (
                <tr key={orgId}>
                  <td>
                    {org?.website ? (
                      <a href={org.website} target="_blank" rel="noopener noreferrer">
                        {org.name || orgId}
                      </a>
                    ) : (
                      org?.name || orgId
                    )}
                  </td>
                  <td>{org?.impact_metric || '—'}</td>
                  <td className="n">{agg.n}</td>
                  <td className="n">{agg.logsCount}</td>
                  <td className="n">{round(agg.hours)}</td>
                  <td className="n">{agg.verified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="plate">
          <h2>Who Is Signed Up</h2>
        </div>
        {signupSections.length === 0 ? (
          <p className="empty">No spots claimed yet.</p>
        ) : (
          signupSections.map(({ ev }) => (
            <div key={ev.id} style={{ marginBottom: 16 }}>
              <h3>
                {orgsById.get(ev.org_id)?.name || ev.org_id} {'—'} {fmtDate(ev.event_date)}
              </h3>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Mentor</th>
                      <th>Transportation</th>
                      <th className="wrapok">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signups
                      .filter((s) => s.event_id === ev.id)
                      .map((s) => (
                        <tr key={s.id}>
                          <td>{rosterByEmail.get(keyOf(s.member_email))?.full_name || s.member_email}</td>
                          <td>{mentorName(s.mentor_id, mentors) || '—'}</td>
                          <td>{s.transportation ? 'Yes' : 'No'}</td>
                          <td className="wrapok">{s.notes || '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  )
}
