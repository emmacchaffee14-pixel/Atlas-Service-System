import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AssignMembers from '../../components/AssignMembers.jsx'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate, todayISO, weekBounds } from '../../lib/format.js'
import { computeEventStats, keyOf, mentorName, round } from '../../lib/stats.js'

const TABS = [
  ['events', 'Events'],
  ['rides', 'Rides'],
  ['signups', 'Sign-Ups'],
  ['results', 'Results'],
  ['archive', 'Archive'],
  ['add', '+ Add Event'],
]
const TAB_KEYS = TABS.map(([k]) => k)
const NEW_ORG_SENTINEL = '__new__'
const NEW_EVENT_INITIAL = { orgId: '', date: '', start: '', end: '', capacity: '0', location: '', givepulse: '', isPublic: true, assignees: [], nominationId: null }
const NEW_ORG_INITIAL = { name: '', location: '', impactMetric: '', website: '' }

function makeEventId(existingEvents, orgId, date) {
  const mmdd = date.replace(/-/g, '').slice(4)
  const base = `${orgId}-${mmdd}`
  if (!existingEvents.some((e) => e.id === base)) return base
  let n = 2
  while (existingEvents.some((e) => e.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}

function makeOrgId(existingOrgs, name) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'partner'
  if (!existingOrgs.some((o) => o.id === base)) return base
  let n = 2
  while (existingOrgs.some((o) => o.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}

export default function Events() {
  const weekEnd = weekBounds().thisEnd
  const [params, setParams] = useSearchParams()
  const tab = TAB_KEYS.includes(params.get('tab')) ? params.get('tab') : 'events'
  const setTab = (key) => setParams(key === 'events' ? {} : { tab: key }, { replace: true })
  const nominationId = params.get('nomination')

  const { roster, mentors, orgs, events, signups, logs, nominations, refresh } = useAdminData()
  const [assignFor, setAssignFor] = useState(null) // event being assigned to, from the table
  const [assignPick, setAssignPick] = useState([])
  const toast = useToast()
  const [rowBusy, setRowBusy] = useState(null)
  const [newEvent, setNewEvent] = useState(NEW_EVENT_INITIAL)
  const [newOrg, setNewOrg] = useState(NEW_ORG_INITIAL)
  const [adding, setAdding] = useState(false)

  // Arriving from Approve on a nomination: prefill the form once, as a
  // private event with a new partner, so nothing goes public until chosen.
  useEffect(() => {
    if (tab !== 'add' || !nominationId) return
    const n = nominations.find((x) => String(x.id) === nominationId)
    if (!n) return
    setNewEvent((cur) => {
      if (String(cur.nominationId) === nominationId) return cur
      const start = String(n.event_time || '').slice(0, 5)
      let end = ''
      if (start) {
        const [h, m] = start.split(':').map(Number)
        end = `${String((h + 2) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      }
      return {
        ...NEW_EVENT_INITIAL,
        orgId: NEW_ORG_SENTINEL,
        date: n.event_date || '',
        start,
        end,
        capacity: '0',
        isPublic: false,
        assignees: [keyOf(n.member_email)],
        nominationId: n.id,
      }
    })
    setNewOrg({ name: n.org_name || '', location: n.address || '', impactMetric: '', website: n.website || '' })
  }, [tab, nominationId, nominations])

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

  async function archiveEvents(ids, archived) {
    if (!ids.length) return
    setRowBusy('bulk')
    const { error } = await supabase.from('events').update({ archived }).in('id', ids)
    setRowBusy(null)
    if (error) {
      toast(archived ? 'Could not archive.' : 'Could not restore.')
      return
    }
    await refresh()
    toast(archived ? `Archived ${ids.length} event(s).` : 'Event restored.')
  }

  async function addEvent(e) {
    e.preventDefault()
    const creatingOrg = newEvent.orgId === NEW_ORG_SENTINEL
    if (!newEvent.orgId || !newEvent.date || !newEvent.start || !newEvent.end) {
      toast('Fill in the partner, date, and both times.')
      return
    }
    if (creatingOrg && !newOrg.name.trim()) {
      toast('Give the new partner a name.')
      return
    }
    setAdding(true)

    let orgId = newEvent.orgId
    if (creatingOrg) {
      orgId = makeOrgId(orgs, newOrg.name)
      const { error: orgError } = await supabase.from('orgs').insert({
        id: orgId,
        name: newOrg.name.trim(),
        location: newOrg.location || null,
        impact_metric: newOrg.impactMetric || null,
        website: newOrg.website || null,
      })
      if (orgError) {
        setAdding(false)
        toast('Could not create that partner.')
        return
      }
    }

    const id = makeEventId(events, orgId, newEvent.date)
    const { error } = await supabase.from('events').insert({
      id,
      org_id: orgId,
      event_date: newEvent.date,
      start_time: newEvent.start,
      end_time: newEvent.end,
      capacity: Number(newEvent.capacity) || 0,
      location: newEvent.location.trim() || null,
      givepulse_link: newEvent.givepulse.trim() || null,
      is_public: newEvent.isPublic,
      status: 'open',
    })
    if (error) {
      setAdding(false)
      toast('Could not add that event.')
      return
    }
    let assigned = 0
    if (newEvent.assignees.length) {
      const { data, error: assignError } = await supabase.rpc('assign_members', {
        p_event_id: id,
        p_emails: newEvent.assignees,
      })
      if (assignError) toast('Event added, but assigning members failed.')
      else assigned = data
    }
    if (newEvent.nominationId) {
      await supabase
        .from('nominations')
        .update({ status: 'approved', event_id: id })
        .eq('id', newEvent.nominationId)
    }
    setAdding(false)
    setNewEvent(NEW_EVENT_INITIAL)
    setNewOrg(NEW_ORG_INITIAL)
    await refresh()
    toast(
      (creatingOrg ? 'Partner and event added' : 'Event added') +
        (assigned ? ` — ${assigned} member${assigned === 1 ? '' : 's'} assigned.` : '.'),
    )
    if (newEvent.nominationId || assigned) setTab('events')
  }

  async function removeSignup(signup, name, orgName) {
    if (!window.confirm(`Remove ${name} from ${orgName}? They'll be taken off the list and can claim again if it's public.`)) return
    setRowBusy('bulk')
    const { error } = await supabase.from('signups').delete().eq('id', signup.id)
    setRowBusy(null)
    if (error) {
      toast('Could not remove that member.')
      return
    }
    await refresh()
    toast(`${name} removed.`)
  }

  async function assignToExisting() {
    if (!assignFor || !assignPick.length) return
    setRowBusy('bulk')
    const { data, error } = await supabase.rpc('assign_members', {
      p_event_id: assignFor.id,
      p_emails: assignPick,
    })
    setRowBusy(null)
    if (error) {
      toast('Could not assign those members.')
      return
    }
    setAssignFor(null)
    setAssignPick([])
    await refresh()
    toast(`${data} member${data === 1 ? '' : 's'} assigned.`)
  }

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const rosterByEmail = useMemo(() => new Map(roster.map((r) => [keyOf(r.email), r])), [roster])

  const transportationRows = useMemo(
    () =>
      signups
        .filter((s) => s.transportation)
        .map((s) => {
          const event = eventsById.get(s.event_id)
          return { signup: s, event, org: event ? orgsById.get(event.org_id) : null }
        })
        .filter((r) => !r.event?.archived && r.event && r.event.event_date >= todayISO())
        .sort((a, b) => (a.event?.event_date || '').localeCompare(b.event?.event_date || '')),
    [signups, eventsById, orgsById],
  )

  const sortedEvents = useMemo(
    () => [...events].sort((x, y) => (x.event_date || '').localeCompare(y.event_date || '')),
    [events],
  )

  const eventRows = useMemo(
    () => sortedEvents.map((ev) => ({ ev, stats: computeEventStats(ev, { signups, logs }) })),
    [sortedEvents, signups, logs],
  )

  const today = todayISO()
  const activeRows = eventRows.filter(({ ev }) => !ev.archived)
  const archivedRows = eventRows.filter(({ ev }) => ev.archived)
  const completedIds = activeRows.filter(({ ev }) => ev.event_date < today).map(({ ev }) => ev.id)

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

  const signupSections = activeRows.filter(({ ev }) =>
    signups.some((s) => s.event_id === ev.id),
  )

  const tabCounts = {
    rides: transportationRows.length,
    signups: signupSections.length,
    archive: archivedRows.length,
  }

  return (
    <>
      <div className="pagehead">
        <h1>Events</h1>
        <p>Claims, logs and impact per event. Capacity is enforced at claim time.</p>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={'tab' + (tab === key ? ' on' : '')}
            onClick={() => setTab(key)}
          >
            {label}
            {tabCounts[key] > 0 && (
              <i className={'tabcount' + (key === 'rides' ? ' hot' : '')}>{tabCounts[key]}</i>
            )}
          </button>
        ))}
      </div>

      {tab === 'events' && transportationRows.length > 0 && (
        <div className="flag" style={{ marginTop: 18 }}>
          <b>{transportationRows.length} upcoming ride{transportationRows.length === 1 ? '' : 's'} requested.</b>{' '}
          <button type="button" className="linkbtn" onClick={() => setTab('rides')}>
            View rides →
          </button>
        </div>
      )}

      {tab === 'rides' && (
        <section>
          <div className="plate">
            <h2>Needs Transportation</h2>
            <span>{transportationRows.length} upcoming ride{transportationRows.length === 1 ? '' : 's'}</span>
          </div>
          {transportationRows.length === 0 ? (
            <p className="empty">Nobody has asked for a ride yet.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Mentor</th>
                    <th className="wrapok">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {transportationRows.map(({ signup, event, org }) => (
                    <tr key={signup.id} className={event && event.event_date <= weekEnd ? 'urgent-row' : undefined}>
                      <td>{rosterByEmail.get(keyOf(signup.member_email))?.full_name || signup.member_email}</td>
                      <td>{org?.name || event?.org_id || '—'}</td>
                      <td>
                        {event ? fmtDate(event.event_date) : '—'}
                        {event && event.event_date <= weekEnd && <em className="cu-pill">This week</em>}
                      </td>
                      <td>{mentorName(signup.mentor_id, mentors) || '—'}</td>
                      <td className="wrapok">{signup.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === 'events' && (
        <section>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Location</th>
                  <th>Link</th>
                  <th>Spots</th>
                  <th>Status</th>
                  <th>Access</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map(({ ev, stats }) => {
                  const busy = rowBusy === ev.id || rowBusy === 'bulk'
                  const done = ev.event_date < today
                  const org = orgsById.get(ev.org_id)
                  return (
                    <tr key={ev.id} className={done ? 'done' : undefined}>
                      <td>
                        <select
                          value={ev.org_id}
                          disabled={busy}
                          style={{ minWidth: 150 }}
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
                        <input
                          type="date"
                          value={ev.event_date}
                          disabled={busy}
                          onChange={(e) => updateEvent(ev.id, { event_date: e.target.value })}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            type="time"
                            value={ev.start_time}
                            disabled={busy}
                            onChange={(e) => updateEvent(ev.id, { start_time: e.target.value })}
                          />
                          <input
                            type="time"
                            value={ev.end_time}
                            disabled={busy}
                            onChange={(e) => updateEvent(ev.id, { end_time: e.target.value })}
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          key={`loc-${ev.location || ''}`}
                          type="text"
                          defaultValue={ev.location || ''}
                          placeholder={org?.location || 'Location'}
                          disabled={busy}
                          style={{ minWidth: 170 }}
                          onBlur={(e) => {
                            const next = e.target.value.trim()
                            if (next !== (ev.location || '')) updateEvent(ev.id, { location: next || null })
                          }}
                        />
                      </td>
                      <td>
                        <input
                          key={`link-${ev.givepulse_link || ''}`}
                          type="url"
                          defaultValue={ev.givepulse_link || ''}
                          placeholder="Link"
                          disabled={busy}
                          style={{ minWidth: 140 }}
                          onBlur={(e) => {
                            const next = e.target.value.trim()
                            if (next !== (ev.givepulse_link || ''))
                              updateEvent(ev.id, { givepulse_link: next || null })
                          }}
                        />
                      </td>
                      <td>
                        <span className="spots">
                          {stats.claimed} /{' '}
                          <input
                            key={ev.capacity}
                            type="number"
                            min="0"
                            defaultValue={ev.capacity}
                            disabled={busy}
                            title="0 = open to the whole cohort"
                            style={{ width: 64 }}
                            onBlur={(e) => {
                              const next = Number(e.target.value) || 0
                              if (next !== Number(ev.capacity)) updateEvent(ev.id, { capacity: next })
                            }}
                          />
                        </span>
                      </td>
                      <td>
                        <select
                          value={ev.status}
                          disabled={busy}
                          onChange={(e) => updateEvent(ev.id, { status: e.target.value })}
                        >
                          <option value="open">Open</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td>
                        <div className="access">
                          <select
                            value={ev.is_public === false ? 'private' : 'public'}
                            disabled={busy}
                            onChange={(e) => updateEvent(ev.id, { is_public: e.target.value === 'public' })}
                          >
                            <option value="public">Public</option>
                            <option value="private">Private</option>
                          </select>
                          <button
                            className="btn ghost sm"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setAssignFor(ev)
                              setAssignPick([])
                            }}
                          >
                            Assign
                          </button>
                        </div>
                      </td>
                      <td>
                        {done && (
                          <button
                            className="btn ghost sm"
                            type="button"
                            disabled={busy}
                            onClick={() => archiveEvents([ev.id], true)}
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            Changes save as soon as you leave a field. Past events are crossed off — archive them to
            remove them from the member side. Capacity 0 means open to the whole cohort.
          </p>
          {completedIds.length > 0 && (
            <button
              className="btn ghost"
              type="button"
              disabled={rowBusy === 'bulk'}
              onClick={() => archiveEvents(completedIds, true)}
            >
              Archive {completedIds.length} Completed Event{completedIds.length === 1 ? '' : 's'}
            </button>
          )}
        </section>
      )}
      {tab === 'results' && (
        <section>
          <div className="plate">
            <h2>By Event</h2>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Date</th>
                  <th className="n">Claimed</th>
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
                    <td>{fmtDate(ev.event_date)}</td>
                    <td className="n">{stats.claimed}</td>
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
                  <td className="n">{totals.claimed}</td>
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
            Verified is the per-event average. Archived events are included.
          </p>
        </section>
      )}
      {tab === 'archive' && (
        <section>
          <div className="plate">
            <h2>Archive</h2>
            <span>{archivedRows.length} event(s)</span>
          </div>
          {archivedRows.length === 0 ? (
            <p className="empty">Nothing archived yet. Members cannot see archived events.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Partner</th>
                    <th>Date</th>
                    <th className="n">Claimed</th>
                    <th className="n">Logs</th>
                    <th className="n">Hours</th>
                    <th className="n">Verified</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...archivedRows].reverse().map(({ ev, stats }) => (
                    <tr key={ev.id}>
                      <td>{orgsById.get(ev.org_id)?.name || ev.org_id}</td>
                      <td>{fmtDate(ev.event_date)}</td>
                      <td className="n">{stats.claimed}</td>
                      <td className="n">{stats.logsCount}</td>
                      <td className="n">{stats.hours}</td>
                      <td className="n">{stats.verified}</td>
                      <td>
                        <button
                          className="btn ghost sm"
                          type="button"
                          disabled={rowBusy === 'bulk'}
                          onClick={() => archiveEvents([ev.id], false)}
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="note">
            Archived events still count toward impact, partner rollups and each member&rsquo;s hours.
          </p>
        </section>
      )}
      {tab === 'add' && (
        <section>
          <div className="plate">
            <h2>Add an Event</h2>
          </div>
          {newEvent.nominationId && (
            <div className="flag">
              Creating an event from a nomination — details are prefilled and it starts private. Review,
              choose who&rsquo;s on it, and publish only if you want everyone to see it.
            </div>
          )}
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
                  <option value={NEW_ORG_SENTINEL}>+ New partner…</option>
                </select>
              </div>
              {newEvent.orgId === NEW_ORG_SENTINEL && (
                <>
                  <div>
                    <label htmlFor="noName">New partner name</label>
                    <input
                      id="noName"
                      type="text"
                      required
                      value={newOrg.name}
                      onChange={(e) => setNewOrg((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="noLocation">
                      Location
                      <small>Optional</small>
                    </label>
                    <input
                      id="noLocation"
                      type="text"
                      value={newOrg.location}
                      onChange={(e) => setNewOrg((f) => ({ ...f, location: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="noMetric">
                      Impact metric
                      <small>e.g. Meals Cooked</small>
                    </label>
                    <input
                      id="noMetric"
                      type="text"
                      value={newOrg.impactMetric}
                      onChange={(e) => setNewOrg((f) => ({ ...f, impactMetric: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="noWebsite">
                      Website
                      <small>Optional</small>
                    </label>
                    <input
                      id="noWebsite"
                      type="url"
                      value={newOrg.website}
                      onChange={(e) => setNewOrg((f) => ({ ...f, website: e.target.value }))}
                    />
                  </div>
                </>
              )}
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
              <div>
                <label htmlFor="neLoc">
                  Location
                  <small>Optional — overrides the partner&rsquo;s</small>
                </label>
                <input
                  id="neLoc"
                  type="text"
                  value={newEvent.location}
                  onChange={(e) => setNewEvent((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="neGp">
                  Link
                  <small>Optional — if applicable</small>
                </label>
                <input
                  id="neGp"
                  type="url"
                  value={newEvent.givepulse}
                  onChange={(e) => setNewEvent((f) => ({ ...f, givepulse: e.target.value }))}
                />
              </div>
            </div>
            <div className="vis">
              <label className="vis-opt">
                <input
                  type="radio"
                  name="vis"
                  checked={newEvent.isPublic}
                  onChange={() => setNewEvent((f) => ({ ...f, isPublic: true }))}
                />
                <span>
                  <b>Public</b>
                  <small>Every member can see it and claim a spot.</small>
                </span>
              </label>
              <label className="vis-opt">
                <input
                  type="radio"
                  name="vis"
                  checked={!newEvent.isPublic}
                  onChange={() => setNewEvent((f) => ({ ...f, isPublic: false }))}
                />
                <span>
                  <b>Private</b>
                  <small>Only the members you assign see it. Nobody else.</small>
                </span>
              </label>
            </div>
            <h3 className="assign-title">Assign members</h3>
            <AssignMembers
              roster={roster}
              mentors={mentors}
              selected={newEvent.assignees}
              onChange={(assignees) => setNewEvent((f) => ({ ...f, assignees }))}
            />
            <div className="formfoot">
              <button className="btn" type="submit" disabled={adding}>
                Add Event
              </button>
            </div>
          </form>
        </section>
      )}
      {tab === 'results' && (
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
      )}
      {tab === 'signups' && (
        <section>
          <div className="plate">
            <h2>Who Is Signed Up</h2>
          </div>
          {signupSections.length === 0 ? (
            <p className="empty">No spots claimed yet.</p>
          ) : (
            signupSections.map(({ ev }) => {
              const list = signups.filter((s) => s.event_id === ev.id)
              const rides = list.filter((s) => s.transportation).length
              return (
              <details key={ev.id} className="su-event">
                <summary>
                  <b>{orgsById.get(ev.org_id)?.name || ev.org_id}</b>
                  <span>{fmtDate(ev.event_date)}</span>
                  <span className="su-count">
                    {list.length} signed up
                    {rides > 0 && <em className="cu-pill">{rides} need{rides === 1 ? 's' : ''} ride</em>}
                  </span>
                </summary>
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Mentor</th>
                        <th className="wrapok">Notes</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {signups
                        .filter((s) => s.event_id === ev.id)
                        .map((s) => (
                          <tr key={s.id}>
                            <td>
                              {rosterByEmail.get(keyOf(s.member_email))?.full_name || s.member_email}
                              {s.transportation && <em className="cu-pill">Needs ride</em>}
                            </td>
                            <td>{mentorName(s.mentor_id, mentors) || '—'}</td>
                            <td className="wrapok">{s.notes || '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="btn warn sm"
                                disabled={rowBusy === 'bulk'}
                                onClick={() =>
                                  removeSignup(
                                    s,
                                    rosterByEmail.get(keyOf(s.member_email))?.full_name || s.member_email,
                                    orgsById.get(ev.org_id)?.name || ev.org_id,
                                  )
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
              )
            })
          )}
        </section>
      )}

      {assignFor && (
        <div className="cal-overlay" onClick={() => setAssignFor(null)}>
          <div className="cal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="cal-close" aria-label="Close" onClick={() => setAssignFor(null)}>
              &times;
            </button>
            <h3>
              Assign members — {orgsById.get(assignFor.org_id)?.name || assignFor.org_id},{' '}
              {fmtDate(assignFor.event_date)}
            </h3>
            <p className="note">
              {assignFor.is_public === false
                ? 'Private: only assigned members can see this event.'
                : 'Public: assigning puts members on the list without them claiming.'}{' '}
              Each member gets a calendar invite.
            </p>
            <AssignMembers
              roster={roster}
              mentors={mentors}
              selected={assignPick}
              onChange={setAssignPick}
              already={signups.filter((x) => x.event_id === assignFor.id).map((x) => x.member_email)}
            />
            <div className="formfoot">
              <button
                className="btn"
                type="button"
                disabled={!assignPick.length || rowBusy === 'bulk'}
                onClick={assignToExisting}
              >
                Assign {assignPick.length || ''} Member{assignPick.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
