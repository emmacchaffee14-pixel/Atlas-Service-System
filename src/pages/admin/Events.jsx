import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'
import { computeEventStats, keyOf, mentorName, round } from '../../lib/stats.js'

const NEW_EVENT_INITIAL = { orgId: '', date: '', start: '', end: '', capacity: '0' }

function makeEventId(existingEvents, orgId, date) {
  const mmdd = date.replace(/-/g, '').slice(4)
  const base = `${orgId}-${mmdd}`
  if (!existingEvents.some((e) => e.id === base)) return base
  let n = 2
  while (existingEvents.some((e) => e.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}

export default function Events() {
  const { roster, mentors, orgs, events, signups, logs, refresh } = useAdminData()
  const toast = useToast()
  const [rowBusy, setRowBusy] = useState(null)
  const [newEvent, setNewEvent] = useState(NEW_EVENT_INITIAL)
  const [adding, setAdding] = useState(false)

  async function updateEvent(id, patch) {
    setRowBusy(id)
    const { error } = await supabase.from('events').update(patch).eq('id', id)
    setRowBusy(null)
    if (error) {
      toast('Could not save that change.')
      return
    }
    await refresh()
  }

  async function addEvent(e) {
    e.preventDefault()
    if (!newEvent.orgId || !newEvent.date || !newEvent.start || !newEvent.end) {
      toast('Fill in the partner, date, and both times.')
      return
    }
    setAdding(true)
    const id = makeEventId(events, newEvent.orgId, newEvent.date)
    const { error } = await supabase.from('events').insert({
      id,
      org_id: newEvent.orgId,
      event_date: newEvent.date,
      start_time: newEvent.start,
      end_time: newEvent.end,
      capacity: Number(newEvent.capacity) || 0,
      status: 'open',
    })
    setAdding(false)
    if (error) {
      toast('Could not add that event.')
      return
    }
    setNewEvent(NEW_EVENT_INITIAL)
    await refresh()
    toast('Event added.')
  }

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
                <th>Status</th>
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
              {eventRows.map(({ ev, stats }) => {
                const busy = rowBusy === ev.id
                return (
                  <tr key={ev.id}>
                    <td>
                      <select
                        value={ev.org_id}
                        disabled={busy}
                        style={{ minWidth: 170 }}
                        onChange={(e) => updateEvent(ev.id, { org_id: e.target.value })}
                      >
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="time"
                          value={ev.start_time}
                          disabled={busy}
                          style={{ minWidth: 110 }}
                          onChange={(e) => updateEvent(ev.id, { start_time: e.target.value })}
                        />
                        <input
                          type="time"
                          value={ev.end_time}
                          disabled={busy}
                          style={{ minWidth: 110 }}
                          onChange={(e) => updateEvent(ev.id, { end_time: e.target.value })}
                        />
                      </div>
                    </td>
                    <td>
                      <input
                        type="date"
                        value={ev.event_date}
                        disabled={busy}
                        style={{ minWidth: 150 }}
                        onChange={(e) => updateEvent(ev.id, { event_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={ev.status}
                        disabled={busy}
                        style={{ minWidth: 110 }}
                        onChange={(e) => updateEvent(ev.id, { status: e.target.value })}
                      >
                        <option value="open">Open</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </td>
                    <td className="n">{stats.claimed}</td>
                    <td className="n">
                      <input
                        key={ev.capacity}
                        type="number"
                        min="0"
                        defaultValue={ev.capacity}
                        disabled={busy}
                        style={{ width: 72, textAlign: 'right' }}
                        onBlur={(e) => {
                          const next = Number(e.target.value) || 0
                          if (next !== Number(ev.capacity)) updateEvent(ev.id, { capacity: next })
                        }}
                      />
                    </td>
                    <td className="n">{stats.logsCount}</td>
                    <td className="n">{stats.hours}</td>
                    <td className="n">{stats.reported}</td>
                    <td className="n">{stats.verified}</td>
                    <td className="n">
                      {stats.claimed ? `${Math.round((stats.logsCount / stats.claimed) * 100)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
              <tr className="tot">
                <td>Total</td>
                <td></td>
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
          Verified is the per-event average. Editing capacity, time, date or status here takes
          effect immediately — capacity is still enforced at claim time regardless.
        </p>
      </section>

      <section>
        <div className="plate">
          <h2>Add an Event</h2>
        </div>
        <form className="card" style={{ maxWidth: 'none' }} onSubmit={addEvent}>
          <div className="fields">
            <div>
              <label htmlFor="neOrg">Partner</label>
              <select
                id="neOrg"
                value={newEvent.orgId}
                onChange={(e) => setNewEvent((f) => ({ ...f, orgId: e.target.value }))}
                required
              >
                <option value="">Choose a partner</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="neDate">Date</label>
              <input
                id="neDate"
                type="date"
                required
                value={newEvent.date}
                onChange={(e) => setNewEvent((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="neStart">Start time</label>
              <input
                id="neStart"
                type="time"
                required
                value={newEvent.start}
                onChange={(e) => setNewEvent((f) => ({ ...f, start: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="neEnd">End time</label>
              <input
                id="neEnd"
                type="time"
                required
                value={newEvent.end}
                onChange={(e) => setNewEvent((f) => ({ ...f, end: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="neCap">
                Capacity
                <small>0 means open to the whole cohort</small>
              </label>
              <input
                id="neCap"
                type="number"
                min="0"
                value={newEvent.capacity}
                onChange={(e) => setNewEvent((f) => ({ ...f, capacity: e.target.value }))}
              />
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={adding}>
              Add event
            </button>
          </div>
        </form>
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
