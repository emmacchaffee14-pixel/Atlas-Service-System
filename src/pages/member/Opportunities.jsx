import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMemberData } from '../../context/MemberDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate, fmtTimeRange } from '../../lib/format.js'
import { keyOf } from '../../lib/stats.js'

export default function Opportunities() {
  const { orgs, events, signups, myEmail, refresh } = useMemberData()
  const toast = useToast()
  const [busyId, setBusyId] = useState(null)

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const active = useMemo(
    () =>
      events
        .filter((e) => e.status !== 'cancelled')
        .sort((x, y) => (x.event_date || '').localeCompare(y.event_date || '')),
    [events],
  )

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

  return (
    <>
      <div className="pagehead">
        <h1>Service Opportunities</h1>
        <p>Pick a slot and it is yours. Capacity is real {'—'} when a list is full, it is full.</p>
      </div>

      <section>
        {active.length === 0 ? (
          <p className="empty">No events scheduled yet.</p>
        ) : (
          active.map((ev) => {
            const org = orgsById.get(ev.org_id) || {}
            const claims = signups.filter((s) => s.event_id === ev.id)
            const capacity = Number(ev.capacity) || 0
            const unlimited = capacity === 0
            const mine = claims.some((c) => keyOf(c.member_email) === keyOf(myEmail))
            const full = !unlimited && claims.length >= capacity

            return (
              <div className="entry" key={ev.id}>
                <div>
                  <h3>
                    {org.name || ev.org_id} {'—'} {fmtDate(ev.event_date)}
                  </h3>
                  <div className="where">
                    <b>{fmtTimeRange(ev.start_time, ev.end_time)}</b>{' '}
                    {org.location || 'Location to be confirmed'}
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
                  {org.givepulse_code && (
                    <div className="givep">
                      {org.givepulse_code === 'TBD' ? (
                        'A GivePulse registration is required for this partner — code coming soon.'
                      ) : (
                        <>
                          Also register on GivePulse with code {org.givepulse_code}
                          {org.givepulse_link && (
                            <>
                              {' '}
                              &middot;{' '}
                              <a href={org.givepulse_link} target="_blank" rel="noopener noreferrer">
                                open GivePulse
                              </a>
                            </>
                          )}
                        </>
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
                  {mine ? (
                    <button
                      className="btn warn"
                      disabled={busyId === ev.id}
                      onClick={() => releaseSlot(ev, org.name || ev.org_id)}
                    >
                      Give up my spot
                    </button>
                  ) : full ? (
                    <button className="btn" disabled>
                      Full
                    </button>
                  ) : (
                    <Link className="btn" to={`/member/signup/${ev.id}`}>
                      Claim a spot
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
          })
        )}
      </section>
    </>
  )
}
