import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMemberData } from '../../context/MemberDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate, fmtTimeRange } from '../../lib/format.js'
import { PROOF_ACCEPT, signedProofUrl, uploadProof, validateProofFile } from '../../lib/proofUpload.js'
import Ring from '../../components/Ring.jsx'
import { computeMemberStats, groupOf, keyOf, mentorName, reqHours, round, swabCap } from '../../lib/stats.js'

export default function Standing() {
  const { orgs, allEvents: events, signups, logs, mentors, me, settings, myEmail, refresh } = useMemberData()
  const toast = useToast()
  const [openingId, setOpeningId] = useState(null)

  const [editing, setEditing] = useState(null)
  const [edit, setEdit] = useState({ hours: '1', quantity: '', takeaway: '', saving: false })

  function openEdit(l) {
    setEditing(l)
    setEdit({
      hours: String(l.hours),
      quantity: l.quantity == null ? '' : String(l.quantity),
      takeaway: l.takeaway || '',
      saving: false,
    })
  }

  async function saveEdit(e) {
    e.preventDefault()
    if (!editing) return
    setEdit((f) => ({ ...f, saving: true }))
    const { data, error } = await supabase.rpc('edit_log', {
      p_log_id: editing.id,
      p_hours: Number(edit.hours),
      p_quantity: edit.quantity === '' ? null : Number(edit.quantity),
      p_takeaway: edit.takeaway,
    })
    if (error || !data) {
      setEdit((f) => ({ ...f, saving: false }))
      toast('Could not save that. Try again.')
      return
    }
    setEditing(null)
    await refresh()
    toast('Saved. An officer will review it.')
  }

  async function withdraw(l) {
    if (!window.confirm('Withdraw this log? It will be removed and you can file a new one.')) return
    setOpeningId(l.id)
    const { data, error } = await supabase.rpc('withdraw_log', { p_log_id: l.id })
    setOpeningId(null)
    if (error || data == null) {
      toast('Could not withdraw that.')
      return
    }
    if (data) supabase.storage.from('service-proofs').remove([data])
    await refresh()
    toast('Log withdrawn.')
  }

  const fileRef = useRef(null)
  const [replaceFor, setReplaceFor] = useState(null)

  // Swap the proof file on a pending or declined log; it goes back to review.
  async function replaceProof(file) {
    const log = replaceFor
    setReplaceFor(null)
    if (!file || !log) return
    const problem = validateProofFile(file)
    if (problem) {
      toast(problem)
      return
    }
    setOpeningId(log.id)
    try {
      const path = await uploadProof(supabase, myEmail, file)
      const { data, error } = await supabase.rpc('resubmit_log', { p_log_id: log.id, p_proof_path: path })
      if (error || !data) throw error || new Error('refused')
      // Best effort: remove the file it replaced (own folder only).
      if (log.proof_path) supabase.storage.from('service-proofs').remove([log.proof_path])
      await refresh()
      toast('New file sent. An officer will review it.')
    } catch {
      toast('Could not replace that file. Try again.')
    } finally {
      setOpeningId(null)
    }
  }

  async function viewProof(logId, path) {
    setOpeningId(logId)
    try {
      const url = await signedProofUrl(supabase, path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      toast('Could not open that file.')
    } finally {
      setOpeningId(null)
    }
  }

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  // Only approved logs count; pending ones are shown but not credited.
  const stats = useMemo(
    () =>
      computeMemberStats(myEmail, {
        logs: logs.filter((l) => (l.status ?? 'approved') === 'approved'),
        signups,
        eventsById,
        settings,
      }),
    [myEmail, logs, signups, eventsById, settings],
  )
  const req = reqHours(settings)
  const cap = swabCap(settings)

  const myClaims = useMemo(
    () => signups.filter((s) => keyOf(s.member_email) === keyOf(myEmail)),
    [signups, myEmail],
  )
  const editingEvent = editing ? eventsById.get(editing.event_id) : null
  const editingOrg = editingEvent ? orgsById.get(editingEvent.org_id) : null
  const myLogs = useMemo(
    () => logs.filter((l) => keyOf(l.member_email) === keyOf(myEmail)),
    [logs, myEmail],
  )

  const pendingHours = round(
    logs
      .filter((l) => keyOf(l.member_email) === keyOf(myEmail) && l.status === 'pending')
      .reduce((t, l) => t + (Number(l.hours) || 0), 0),
  )
  const figs = [
    ['Hours approved', stats.total, false],
    ...(pendingHours ? [['Awaiting approval', pendingHours, false]] : []),
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
        <div className="hero">
          <Ring
            value={stats.countable}
            max={req}
            big={`${stats.countable}/${req}`}
            sub="hours counted"
          />
          <div className="hero-side">
            <p className="hero-line">
              {stats.met ? (
                <>You&rsquo;re all set for the semester.</>
              ) : (
                <>
                  <b>{Math.max(0, round(req - stats.countable))}</b> more hour
                  {round(req - stats.countable) === 1 ? '' : 's'} to go.
                </>
              )}
            </p>
            <div className="figs mini">
              {figs
                .filter(([label]) => label !== 'Counting toward requirement')
                .map(([label, value, warn]) => (
                  <div className={'fig' + (warn ? ' warn' : '')} key={label}>
                    <b>{value}</b>
                    <span>{label}</span>
                  </div>
                ))}
            </div>
          </div>
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
          <ul className="mlist">
            {myClaims.map((s) => {
              const ev = eventsById.get(s.event_id)
              if (!ev) return null
              const org = orgsById.get(ev.org_id)
              return (
                <li key={s.id}>
                  <div className="mlist-main">
                    <b>{org?.name || ev.org_id}</b>
                    <span>
                      {fmtDate(ev.event_date)} · {fmtTimeRange(ev.start_time, ev.end_time)}
                    </span>
                  </div>
                  {s.transportation && <span className="tag">Ride requested</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="plate">
          <h2>Service You Have Logged</h2>
          <Link to="/member/log" className="btn sm">
            Log Service
          </Link>
        </div>
        {myLogs.length === 0 ? (
          <p className="empty">No hours logged yet.</p>
        ) : (
          <ul className="mlist logs">
            {myLogs.map((l) => {
              const ev = eventsById.get(l.event_id)
              const org = ev ? orgsById.get(ev.org_id) : null
              const editable = l.status === 'pending' || l.status === 'declined'
              const busy = openingId === l.id
              return (
                <li key={l.id}>
                  <div className="mlist-row">
                    <div className="mlist-main">
                      <b>{ev ? org?.name || ev.org_id : l.event_id}</b>
                      <span>
                        {ev ? fmtDate(ev.event_date) + ' · ' : ''}
                        {String(l.hours)} hr{Number(l.hours) === 1 ? '' : 's'}
                        {l.quantity != null && org?.impact_metric
                          ? ` · ${l.quantity} ${org.impact_metric.toLowerCase()}`
                          : ''}
                      </span>
                    </div>
                    <span className={'tag' + (l.status === 'approved' ? ' ok' : l.status === 'declined' ? ' no' : '')}>
                      {l.status === 'approved' ? 'Approved' : l.status === 'declined' ? 'Declined' : 'Pending'}
                    </span>
                  </div>
                  {l.status === 'declined' && (
                    <p className="mlist-note">Declined. Fix what was wrong and resubmit, or withdraw it.</p>
                  )}
                  {l.status === 'pending' && l.edited_at && <p className="mlist-note">Edited — waiting for review.</p>}
                  <div className="mlist-actions">
                    {l.proof_path && (
                      <button className="btn ghost sm" disabled={busy} onClick={() => viewProof(l.id, l.proof_path)}>
                        View File
                      </button>
                    )}
                    {editable && (
                      <>
                        <button className="btn ghost sm" disabled={busy} onClick={() => openEdit(l)}>
                          Edit
                        </button>
                        <button
                          className="btn ghost sm"
                          disabled={busy}
                          onClick={() => {
                            setReplaceFor(l)
                            fileRef.current?.click()
                          }}
                        >
                          {l.status === 'declined' ? 'Resubmit File' : 'Replace File'}
                        </button>
                        <button className="btn warn sm" disabled={busy} onClick={() => withdraw(l)}>
                          Withdraw
                        </button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {editing && (
        <div className="cal-overlay sheet" onClick={() => setEditing(null)}>
          <form
            className="cal-card"
            role="dialog"
            aria-modal="true"
            aria-label="Edit service log"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveEdit}
          >
            <button type="button" className="cal-close" aria-label="Close" onClick={() => setEditing(null)}>
              &times;
            </button>
            <h3>Edit Your Log</h3>
            <p className="note">Saving sends it back to an officer for review.</p>
            <div className="fields">
              <div>
                <label htmlFor="edHours">Hours served</label>
                <select
                  id="edHours"
                  value={edit.hours}
                  onChange={(e) => setEdit((f) => ({ ...f, hours: e.target.value }))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="edQty">
                  {editingOrg?.impact_metric ? `How many ${editingOrg.impact_metric.toLowerCase()}?` : 'How many?'}
                  <small>
                    {editingEvent?.impact_mode === 'sum'
                      ? 'Only what you personally brought or donated.'
                      : 'Report the group total if you worked as a group.'}
                  </small>
                </label>
                <input
                  id="edQty"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={edit.quantity}
                  onChange={(e) => setEdit((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="span2">
                <label htmlFor="edTake">Takeaway</label>
                <textarea
                  id="edTake"
                  rows="3"
                  value={edit.takeaway}
                  onChange={(e) => setEdit((f) => ({ ...f, takeaway: e.target.value }))}
                />
              </div>
            </div>
            <div className="formfoot">
              <button className="btn" type="submit" disabled={edit.saving}>
                Save &amp; Resubmit
              </button>
            </div>
          </form>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={PROOF_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          replaceProof(e.target.files?.[0] || null)
          e.target.value = ''
        }}
      />
    </>
  )
}
