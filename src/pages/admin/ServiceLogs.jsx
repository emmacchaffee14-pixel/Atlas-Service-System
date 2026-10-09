import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'
import { signedProofUrl } from '../../lib/proofUpload.js'
import { keyOf } from '../../lib/stats.js'

// Review queue: a member's hours only count once a log is approved here.
export default function ServiceLogs() {
  const { roster, orgs, events, allLogs, refresh } = useAdminData()
  const toast = useToast()
  const [view, setView] = useState('pending')
  const [busy, setBusy] = useState(null)

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
      </div>

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
                  {rows.map(({ log, member, event, metric }) => (
                    <tr key={log.id}>
                      <td>{member}</td>
                      <td>{event}</td>
                      <td className="n">{String(log.hours)}</td>
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
    </>
  )
}
