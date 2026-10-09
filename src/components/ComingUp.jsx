import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAdminData } from '../context/AdminDataContext.js'
import { fmtDate, fmtTimeRange, weekBounds } from '../lib/format.js'
import { keyOf, mentorName } from '../lib/stats.js'

// Events in the next two calendar weeks, soonest first, with anyone who
// asked for a ride called out under each one.
export default function ComingUp() {
  const { roster, mentors, orgs, events, signups } = useAdminData()

  const groups = useMemo(() => {
    const { today, thisEnd, nextStart, nextEnd } = weekBounds()
    const orgsById = new Map(orgs.map((o) => [o.id, o]))
    const rosterByEmail = new Map(roster.map((r) => [keyOf(r.email), r]))
    const rows = events
      .filter((e) => !e.archived && e.status !== 'cancelled')
      .filter((e) => e.event_date >= today && e.event_date <= nextEnd)
      .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time))
      .map((ev) => {
        const claims = signups.filter((s) => s.event_id === ev.id)
        const rides = claims
          .filter((s) => s.transportation)
          .map((s) => ({
            id: s.id,
            name: rosterByEmail.get(keyOf(s.member_email))?.full_name || s.member_email,
            mentor: mentorName(s.mentor_id, mentors),
            notes: s.notes,
          }))
        return { ev, org: orgsById.get(ev.org_id), claimed: claims.length, rides }
      })
    return [
      ['This Week', rows.filter((r) => r.ev.event_date <= thisEnd)],
      ['Next Week', rows.filter((r) => r.ev.event_date >= nextStart)],
    ]
  }, [roster, mentors, orgs, events, signups])

  const rideTotal = groups.reduce((n, [, rows]) => n + rows.reduce((m, r) => m + r.rides.length, 0), 0)

  return (
    <section>
      <div className="plate">
        <h2>Coming Up</h2>
        <span>{rideTotal ? `${rideTotal} ride${rideTotal === 1 ? '' : 's'} needed` : 'No rides requested'}</span>
      </div>
      {groups.map(([label, rows]) => (
        <div key={label} className="cu-group">
          <h3>{label}</h3>
          {rows.length === 0 ? (
            <p className="empty">Nothing scheduled.</p>
          ) : (
            rows.map(({ ev, org, claimed, rides }) => {
              const cap = Number(ev.capacity) || 0
              return (
                <div key={ev.id} className={`cu-event${rides.length ? ' rides' : ''}`}>
                  <div className="cu-head">
                    <b>{org?.name || ev.org_id}</b>
                    <span>
                      {fmtDate(ev.event_date)} · {fmtTimeRange(ev.start_time, ev.end_time)}
                    </span>
                    <span>{cap ? `${claimed} of ${cap} claimed` : `${claimed} signed up`}</span>
                  </div>
                  {rides.length > 0 && (
                    <div className="cu-rides">
                      <strong>Needs ride ({rides.length})</strong>
                      <ul>
                        {rides.map((r) => (
                          <li key={r.id}>
                            {r.name}
                            {r.mentor && <small> · {r.mentor}</small>}
                            {r.notes && <small> — {r.notes}</small>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      ))}
      <p className="note">
        Full ride list and the archive live on <Link to="/admin/events">Events</Link>.
      </p>
    </section>
  )
}
