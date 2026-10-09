import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMemberData } from '../../context/MemberDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate, fmtTime, fmtTimeRange, todayISO } from '../../lib/format.js'
import { keyOf } from '../../lib/stats.js'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function iso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Month grid as weeks of 7 cells; cells outside the month are null.
function buildMonth(year, month) {
  const lead = new Date(year, month, 1).getDay()
  const days = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export default function Opportunities() {
  const { orgs, events, signups, myEmail, refresh } = useMemberData()
  const toast = useToast()
  const [busyId, setBusyId] = useState(null)
  const [openId, setOpenId] = useState(null)

  // "Today" is read from the clock, and re-checked every minute so the
  // marker moves at midnight without a reload.
  const [today, setToday] = useState(todayISO)
  useEffect(() => {
    const t = setInterval(() => setToday(todayISO()), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const [ty, tm] = today.split('-').map(Number)
  const [view, setView] = useState({ y: ty, m: tm - 1 })

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const active = useMemo(
    () =>
      events
        .filter((e) => e.status !== 'cancelled')
        .sort(
          (x, y) =>
            (x.event_date || '').localeCompare(y.event_date || '') ||
            (x.start_time || '').localeCompare(y.start_time || ''),
        ),
    [events],
  )
  const byDate = useMemo(() => {
    const map = new Map()
    active.forEach((e) => {
      if (!map.has(e.event_date)) map.set(e.event_date, [])
      map.get(e.event_date).push(e)
    })
    return map
  }, [active])

  const weeks = useMemo(() => buildMonth(view.y, view.m), [view])
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const monthPrefix = iso(view.y, view.m, 1).slice(0, 7)
  const monthEvents = active.filter((e) => e.event_date.startsWith(monthPrefix))
  const isThisMonth = view.y === ty && view.m === tm - 1

  function shift(delta) {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  function stateOf(ev) {
    const claims = signups.filter((s) => s.event_id === ev.id)
    const capacity = Number(ev.capacity) || 0
    const mine = claims.some((c) => keyOf(c.member_email) === keyOf(myEmail))
    const full = capacity > 0 && claims.length >= capacity
    return mine ? 'mine' : full ? 'full' : 'open'
  }

  function chipLabel(ev) {
    const org = orgsById.get(ev.org_id)
    return org?.name || ev.org_id
  }

  async function releaseSlot(ev, orgName) {
    const sure = window.confirm(
      `Give up your spot at ${orgName} — ${fmtDate(ev.event_date)}?\n\n` +
        'Do not do this within 48 hours of the event — text the service chair instead.',
    )
    if (!sure) return
    setBusyId(ev.id)
    const { error } = await supabase
      .from('signups')
      .delete()
      .eq('event_id', ev.id)
      .eq('member_email', myEmail)
    setBusyId(null)
    if (error) {
      toast('Could not release that spot.')
      return
    }
    await refresh()
    toast('Spot released.')
  }

  const openEvent = openId ? active.find((e) => e.id === openId) : null

  useEffect(() => {
    if (!openEvent) return
    const onKey = (e) => e.key === 'Escape' && setOpenId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openEvent])

  return (
    <>
      <div className="pagehead">
        <h1>Service Opportunities</h1>
        <p>Pick a day, pick an event, claim your spot. Capacity is real {'—'} when a list is full, it is full.</p>
      </div>

      <section>
        {active.length === 0 ? (
          <p className="empty">No events scheduled yet.</p>
        ) : (
          <>
            <div className="cal-bar">
              <button type="button" className="btn ghost sm" onClick={() => shift(-1)} aria-label="Previous month">
                ‹
              </button>
              <h2>{monthLabel}</h2>
              <button type="button" className="btn ghost sm" onClick={() => shift(1)} aria-label="Next month">
                ›
              </button>
              {!isThisMonth && (
                <button type="button" className="btn ghost sm" onClick={() => setView({ y: ty, m: tm - 1 })}>
                  Today
                </button>
              )}
            </div>

            <div className="cal" role="grid" aria-label={monthLabel}>
              {DOW.map((d) => (
                <div className="cal-dow" key={d}>
                  {d}
                </div>
              ))}
              {weeks.flat().map((day, i) => {
                if (!day) return <div className="cal-cell empty" key={`e${i}`} />
                const key = iso(view.y, view.m, day)
                const list = byDate.get(key) || []
                const isToday = key === today
                return (
                  <div
                    className={'cal-cell' + (isToday ? ' today' : '') + (key < today ? ' past' : '')}
                    key={key}
                  >
                    <span className="cal-num">
                      {day}
                      {isToday && <em>Today</em>}
                    </span>
                    {list.map((ev) => (
                      <button
                        type="button"
                        key={ev.id}
                        className={`cal-chip ${stateOf(ev)}`}
                        onClick={() => setOpenId(ev.id)}
                        title={`${chipLabel(ev)} · ${fmtTimeRange(ev.start_time, ev.end_time)}`}
                      >
                        <span>{fmtTime(ev.start_time)}</span> {chipLabel(ev)}
                        {stateOf(ev) === 'full' && <strong className="cal-fulltag">Full</strong>}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className="cal-key">
              <span className="cal-chip open">Open</span>
              <span className="cal-chip full">Full</span>
            </div>

            <div className="cal-agenda">
              <h3>{monthLabel}</h3>
              {monthEvents.length === 0 ? (
                <p className="empty">Nothing scheduled this month.</p>
              ) : (
                monthEvents.map((ev) => (
                  <button type="button" key={ev.id} className="cal-row" onClick={() => setOpenId(ev.id)}>
                    <b>{fmtDate(ev.event_date)}</b>
                    <span>
                      {chipLabel(ev)} · {fmtTime(ev.start_time)}
                    </span>
                    <i className={`cal-chip ${stateOf(ev)}`}>
                      {{ mine: "You're on it", full: 'Full', open: 'Open' }[stateOf(ev)]}
                    </i>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {openEvent && (
        <div className="cal-overlay" onClick={() => setOpenId(null)}>
          <div
            className="cal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Event details"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="cal-close" aria-label="Close" onClick={() => setOpenId(null)}>
              &times;
            </button>
            <EventCard
              ev={openEvent}
              org={orgsById.get(openEvent.org_id) || {}}
              claims={signups.filter((s) => s.event_id === openEvent.id)}
              myEmail={myEmail}
              past={openEvent.event_date < today}
              busy={busyId === openEvent.id}
              onRelease={releaseSlot}
            />
          </div>
        </div>
      )}
    </>
  )
}

function EventCard({ ev, org, claims, myEmail, past, busy, onRelease }) {
  const capacity = Number(ev.capacity) || 0
  const unlimited = capacity === 0
  const mine = claims.some((c) => keyOf(c.member_email) === keyOf(myEmail))
  const full = !unlimited && claims.length >= capacity
  const gpLink = ev.givepulse_link || org.givepulse_link

  return (
    <div className="entry cal-entry">
      <div>
        <h3>
          {org.name || ev.org_id} {'—'} {fmtDate(ev.event_date)}
        </h3>
        <div className="where">
          <b>{fmtTimeRange(ev.start_time, ev.end_time)}</b>{' '}
          {ev.location || org.location || 'Location to be confirmed'}
        </div>
        {org.description && <p className="desc">{org.description}</p>}
        {org.impact_metric && <div className="where">Counts toward: {org.impact_metric}</div>}
        {org.website && (
          <a
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            href={org.website}
            target="_blank"
            rel="noopener noreferrer"
          >
            Visit website
          </a>
        )}
        {org.directions && <p className="desc" style={{ whiteSpace: 'pre-line' }}>{org.directions}</p>}
        {org.givepulse_code && (
          <div className="givep">
            {org.givepulse_code === 'TBD' ? (
              <strong>A GivePulse registration is required for {org.name} — code coming soon.</strong>
            ) : (
              <strong>
                Also register with {org.name} on GivePulse:{' '}
                {gpLink ? (
                  <a href={gpLink} target="_blank" rel="noopener noreferrer">
                    Register on GivePulse
                  </a>
                ) : (
                  'Register on GivePulse'
                )}
                <br />
                Code: {org.givepulse_code}
              </strong>
            )}
          </div>
        )}
      </div>

      <div className="slotside">
        {!unlimited && capacity <= 14 && (
          <div className="pips">
            {Array.from({ length: capacity }).map((_, i) => {
              const claim = claims[i]
              let cls = 'pip'
              if (claim && keyOf(claim.member_email) === keyOf(myEmail)) cls = 'pip mine'
              else if (claim) cls = 'pip on'
              return <span className={cls} key={i} />
            })}
          </div>
        )}
        <span className={'cnt' + (full && !mine ? ' full' : '')}>
          {unlimited
            ? 'Open to every member'
            : mine
              ? 'You are on this list'
              : full
                ? `Full — ${capacity} of ${capacity}`
                : `${capacity - claims.length} of ${capacity} open`}
        </span>
        {past ? (
          <button className="btn" disabled>
            This event has passed
          </button>
        ) : mine ? (
          <button className="btn warn" disabled={busy} onClick={() => onRelease(ev, org.name || ev.org_id)}>
            Give Up My Spot
          </button>
        ) : full ? (
          <button className="btn" disabled>
            Full
          </button>
        ) : (
          <Link className="btn" to={`/member/signup/${ev.id}`}>
            Claim a Spot
          </Link>
        )}
      </div>

      <div className="roster">
        {unlimited ? `${claims.length} attending` : 'Who is going'}
        {(claims.length > 0 || !unlimited) && (
          <ol>
            {claims.map((c) => (
              <li key={c.id}>
                {c.member_name || c.member_email}
                {keyOf(c.member_email) === keyOf(myEmail) ? ' (you)' : ''}
              </li>
            ))}
            {!unlimited &&
              Array.from({ length: Math.max(0, capacity - claims.length) }).map((_, i) => (
                <li className="open" key={`open-${i}`}>
                  open
                </li>
              ))}
          </ol>
        )}
      </div>
    </div>
  )
}
