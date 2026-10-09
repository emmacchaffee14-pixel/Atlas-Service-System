import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAdminData } from '../context/AdminDataContext.js'
import { fmtDate, fmtTime, weekBounds } from '../lib/format.js'
import { keyOf } from '../lib/stats.js'

// Events in the next two calendar weeks as a plain list: one line per
// event, with anyone who needs a ride named on that line. Ride details
// (mentor, notes) live on Events → Rides.
export default function ComingUp() {
  const { roster, orgs, events, signups } = useAdminData()

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
        const riders = claims
          .filter((s) => s.transportation)
          .map((s) => (rosterByEmail.get(keyOf(s.member_email))?.full_name || s.member_email).split(' ')[0])
        return { ev, org: orgsById.get(ev.org_id), claimed: claims.length, riders }
      })
    return [
      ['This Week', rows.filter((r) => r.ev.event_date <= thisEnd)],
      ['Next Week', rows.filter((r) => r.ev.event_date >= nextStart)],
    ]
  }, [roster, orgs, events, signups])

  return (
    <section>
      <div className="plate">
        <h2>Coming Up</h2>
        <span>
          <Link to="/admin/events?tab=rides">All rides</Link> · <Link to="/admin/events">All events</Link>
        </span>
      </div>
      {groups.map(([label, rows]) => {
        const rides = rows.reduce((n, r) => n + r.riders.length, 0)
        return (
          <div key={label} className="cu-group">
            <h3 className="cu-title">
              {label}
              <span>
                {rows.length} event{rows.length === 1 ? '' : 's'}
                {rides > 0 && ` · ${rides} ride${rides === 1 ? '' : 's'} needed`}
              </span>
            </h3>
            {rows.length === 0 ? (
              <p className="empty">Nothing scheduled.</p>
            ) : (
              <ul className="cu-list">
                {rows.map(({ ev, org, claimed, riders }) => {
                  const cap = Number(ev.capacity) || 0
                  return (
                    <li key={ev.id}>
                      <span className="cu-date">{fmtDate(ev.event_date)}</span>
                      <span className="cu-what">
                        <b>{org?.name || ev.org_id}</b>
                        <small>{fmtTime(ev.start_time)}</small>
                      </span>
                      <span className="cu-fill">{cap ? `${claimed}/${cap}` : `${claimed} in`}</span>
                      {riders.length > 0 && (
                        <span className="cu-ride">
                          <em className="cu-pill">Ride</em> {riders.join(', ')}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}
