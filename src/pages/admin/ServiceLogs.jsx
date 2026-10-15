import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'
import { signedProofUrl } from '../../lib/proofUpload.js'
import { isAdos, keyOf, swabCap } from '../../lib/stats.js'
import AssignMembers from '../../components/AssignMembers.jsx'

// Review queue: a member's hours only count once a log is approved here.
export default function ServiceLogs() {
  const { roster, mentors, orgs, events, allLogs, settings, officerEmail, refresh } = useAdminData()
  const toast = useToast()
  const [view, setView] = useState('pending')
  const [busy, setBusy] = useState(null)
  const [creditEvent, setCreditEvent] = useState('')
  const [creditPick, setCreditPick] = useState([])
  const [creditHours, setCreditHours] = useState('1')
  const [exempt, setExempt] = useState(false)

  const adosEvents = useMemo(
    () => events.filter(isAdos).sort((a, b) => b.event_date.localeCompare(a.event_date)),
    [events],
  )

  const rosterByEmail = useMemo(() => new Map(roster.map((r) => [keyOf(r.email), r])), [roster])
  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  const rows = useMemo(
    () =>
      allLogs
        .filter((l) => (view === 'pending' ? l.status === 'pending' : l.status !== 'pending'))
        .map((l) => {
          const ev = eventsById.get(l.event_id)
          return {
            log: l,
            member: rosterByEmail.get(keyOf(l.member_email))?.full_name || l.member_email,
            event: ev ? `${orgsById.get(ev.org_id)?.name || ev.org_id} — ${fmtDate(ev.event_date)}` : l.event_id,
            metric: ev ? orgsById.get(ev.org_id)?.impact_metric : '',
            ados: isAdos(ev),
          }
        })
        .sort((a, b) =>
          view === 'pending'
            ? (a.log.created_at || '').localeCompare(b.log.created_at || '')
            : (b.log.created_at || '').localeCompare(a.log.created_at || ''),
        ),
    [allLogs, view, eventsById, orgsById, rosterByEmail],
  )
  const pendingCount = allLogs.filter((l) => l.status === 'pending').length

  async function setStatus(ids, status) {
    setBusy(ids.length === 1 ? ids[0] : 'bulk')
    const { error } = await supabase.from('service_logs').update({ status }).in('id', ids)
    setBusy(null)
    if (error) {
      toast('Could not save that.')
      return
    }
    await refresh()
    toast(
      status === 'approved'
        ? `Approved ${ids.length} log${ids.length === 1 ? '' : 's'}.`
        : status === 'declined'
          ? 'Declined.'
          : 'Moved back to pending.',
    )
  }

  // Members who already have a log (any status) for the chosen event can't be
  // credited again from here.
  const alreadyOn = useMemo(
    () => allLogs.filter((l) => l.event_id === creditEvent).map((l) => l.member_email),
    [allLogs, creditEvent],
  )

  async function creditMembers() {
    if (!creditEvent || !creditPick.length) return
    const hrs = Number(creditHours) || 0
    if (hrs <= 0) return
    const cap = swabCap(settings)
    const note = exempt
      ? `Credit ${hrs} hr to ${creditPick.length} member${creditPick.length === 1 ? '' : 's'}, all counting toward their requirement (the ${cap}-hour book-drive cap is overridden)?`
      : `Credit ${hrs} hr to ${creditPick.length} member${creditPick.length === 1 ? '' : 's'}? The ${cap}-hour book-drive cap still applies.`
    if (!window.confirm(note)) return
    setBusy('credit')
    const rows = creditPick.map((email) => ({
      event_id: creditEvent,
      member_email: email,
      hours: hrs,
      status: 'approved',
      credited_by: officerEmail,
      cap_exempt: exempt,
      takeaway: 'Credited by an officer from the book-drive checklist.',
    }))
    const { error } = await supabase.from('service_logs').insert(rows)
    setBusy(null)
    if (error) {
      toast('Could not credit those hours. Has the latest SQL been run?')
      return
    }
    setCreditPick([])
    await refresh()
    toast(`Credited ${rows.length} member${rows.length === 1 ? '' : 's'}.`)
  }

  // Change the hours credited for a log. The member's original request is
  // kept the first time it's changed, so it stays visible and the change is
  // visible to them too.
  async function setHours(log, raw) {
    const next = Math.round(Number(raw) * 2) / 2
    if (!next || next <= 0 || next > 12) {
      toast('Hours must be between 0.5 and 12.')
      await refresh()
      return
    }
    if (next === Number(log.hours)) return
    setBusy(log.id)
    const { error } = await supabase
      .from('service_logs')
      .update({ hours: next, requested_hours: log.requested_hours ?? log.hours })
      .eq('id', log.id)
    setBusy(null)
    if (error) {
      toast('Could not change the hours. Has the latest SQL been run?')
      return
    }
    await refresh()
  }

  async function viewProof(path) {
    try {
      window.open(await signedProofUrl(supabase, path), '_blank', 'noopener')
    } catch {
      toast('Could not open that file.')
    }
  }

  return (
    <>
      <div className="pagehead">
        <h1>Service Logs</h1>
        <p>
          {pendingCount
            ? `${pendingCount} waiting for approval. Hours only count toward a member once approved.`
            : 'Nothing waiting. Hours only count toward a member once approved.'}
        </p>
      </div>

      <div className="tabs" role="tablist">
        <button type="button" className={'tab' + (view === 'pending' ? ' on' : '')} onClick={() => setView('pending')}>
          Pending
          {pendingCount > 0 && <i className="tabcount hot">{pendingCount}</i>}
        </button>
        <button type="button" className={'tab' + (view === 'reviewed' ? ' on' : '')} onClick={() => setView('reviewed')}>
          Reviewed
        </button>
        <button type="button" className={'tab' + (view === 'credit' ? ' on' : '')} onClick={() => setView('credit')}>
          Credit Hours
        </button>
      </div>

      {view === 'credit' && (
        <section style={{ marginTop: 24 }}>
          <p className="note" style={{ marginBottom: 14 }}>
            Check off the members on your book-drive list and credit them without a log. Each
            becomes an approved log and gets a notice next time they sign in.
          </p>
          {adosEvents.length === 0 ? (
            <p className="empty">There are no ADOS book-drive events yet.</p>
          ) : (
            <>
              <div className="fields">
                <div>
                  <label htmlFor="crEvent">Event</label>
                  <select
                    id="crEvent"
                    value={creditEvent}
                    onChange={(e) => {
                      setCreditEvent(e.target.value)
                      setCreditPick([])
                    }}
                  >
                    <option value="">Choose an event</option>
                    {adosEvents.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {orgsById.get(ev.org_id)?.name || ev.org_id} — {fmtDate(ev.event_date)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="crHours">Hours to credit</label>
                  <select id="crHours" value={creditHours} onChange={(e) => setCreditHours(e.target.value)}>
                    {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="vis-opt" style={{ margin: '14px 0' }}>
                <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
                <span>
                  <b>Count all of these hours</b>
                  <small>
                    Override the {swabCap(settings)}-hour book-drive cap, so the full credit counts toward the
                    requirement.
                  </small>
                </span>
              </label>
              {creditEvent && (
                <>
                  <AssignMembers
                    roster={roster}
                    mentors={mentors}
                    selected={creditPick}
                    onChange={setCreditPick}
                    already={alreadyOn}
                  />
                  <div className="formfoot">
                    <button
                      type="button"
                      className="btn"
                      disabled={!creditPick.length || busy === 'credit'}
                      onClick={creditMembers}
                    >
                      Credit {creditPick.length || ''} Member{creditPick.length === 1 ? '' : 's'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {view !== 'credit' && (
      <section style={{ marginTop: 24 }}>
        {rows.length === 0 ? (
          <p className="empty">{view === 'pending' ? 'You are all caught up.' : 'No reviewed logs yet.'}</p>
        ) : (
          <>
            {view === 'pending' && rows.length > 1 && (
              <button
                type="button"
                className="btn ghost sm"
                style={{ marginBottom: 12 }}
                disabled={busy === 'bulk'}
                onClick={() => {
                  if (window.confirm(`Approve all ${rows.length} pending logs?`)) {
                    setStatus(rows.map((r) => r.log.id), 'approved')
                  }
                }}
              >
                Approve All {rows.length}
              </button>
            )}
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Event</th>
                    <th className="n">Hours</th>
                    <th className="n">Reported</th>
                    <th className="wrapok">Takeaway</th>
                    <th>Proof</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ log, member, event, metric, ados }) => (
                    <tr key={log.id}>
                      <td>
                        {member}
                        {log.edited_at && log.status === 'pending' && <em className="cu-pill">Edited</em>}
                      </td>
                      <td>{event}</td>
                      <td className="n">
                        {view === 'pending' ? (
                          <div className="hrs">
                            <input
                              key={`h-${log.id}-${log.hours}`}
                              type="number"
                              min="0.5"
                              max="12"
                              step="0.5"
                              inputMode="decimal"
                              defaultValue={String(log.hours)}
                              disabled={busy === log.id}
                              onBlur={(e) => setHours(log, e.target.value)}
                              aria-label="Hours credited"
                            />
                            {ados && Number(log.hours) > swabCap(settings) && (
                              <button
                                type="button"
                                className="linkbtn small inline"
                                onClick={() => setHours(log, swabCap(settings))}
                              >
                                Cap to {swabCap(settings)}
                              </button>
                            )}
                          </div>
                        ) : (
                          String(log.hours)
                        )}
                        {log.requested_hours != null && Number(log.requested_hours) !== Number(log.hours) && (
                          <small className="soft" style={{ display: 'block' }}>
                            asked for {String(log.requested_hours)}
                          </small>
                        )}
                      </td>
                      <td className="n">
                        {log.quantity == null ? '—' : `${log.quantity}${metric ? ` ${metric.toLowerCase()}` : ''}`}
                      </td>
                      <td className="wrapok">{log.takeaway || '—'}</td>
                      <td>
                        {log.proof_path ? (
                          <button type="button" className="btn ghost sm" onClick={() => viewProof(log.proof_path)}>
                            View
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {view === 'pending' ? (
                          <div className="access">
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy === log.id || busy === 'bulk'}
                              onClick={() => setStatus([log.id], 'approved')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn warn sm"
                              disabled={busy === log.id || busy === 'bulk'}
                              onClick={() => setStatus([log.id], 'declined')}
                            >
                              Decline
                            </button>
                          </div>
                        ) : (
                          <div className="access">
                            <span className={'tag' + (log.status === 'approved' ? ' ok' : ' no')}>
                              {log.status === 'approved' ? 'Approved' : 'Declined'}
                            </span>
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={busy === log.id}
                              onClick={() => setStatus([log.id], 'pending')}
                            >
                              Reopen
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      )}
    </>
  )
}
