import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtDate } from '../lib/format.js'
import { supabase } from '../lib/supabaseClient.js'

const SHOWN_KEY = 'atlas-notices-shown'

function shownThisSession() {
  try {
    return sessionStorage.getItem(SHOWN_KEY) === '1'
  } catch {
    return false
  }
}

// Pop-up on login: log decisions the member hasn't seen, plus reminders to
// log service for events they signed up for that have already happened.
// Shown once per browser session; reminders come back next login until the
// log is filed, decisions until the member has acknowledged them.
export default function MemberNotices({ decisions, reminders, label, refresh }) {
  const [open, setOpen] = useState(() => !shownThisSession())
  if (!open || (decisions.length === 0 && reminders.length === 0)) return null

  async function close() {
    setOpen(false)
    try {
      sessionStorage.setItem(SHOWN_KEY, '1')
    } catch {
      // Worst case it shows again on the next page load.
    }
    if (decisions.length) {
      await supabase.rpc('mark_logs_seen')
      refresh()
    }
  }

  return (
    <div className="cal-overlay" onClick={close}>
      <div className="cal-card notices" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="cal-close" aria-label="Close" onClick={close}>
          &times;
        </button>
        <h3>Since you were last here</h3>

        {decisions.length > 0 && (
          <div className="notice-block">
            <h4>Service logs</h4>
            <ul>
              {decisions.map((l) => (
                <li key={l.id}>
                  <span className={'tag' + (l.status === 'approved' ? ' ok' : ' no')}>
                    {l.status === 'approved' ? 'Approved' : 'Declined'}
                  </span>{' '}
                  {label(l.event_id)} — {String(l.hours)} hr{Number(l.hours) === 1 ? '' : 's'}
                  {l.status === 'declined' && <small> Check with the service chair, then log it again.</small>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reminders.length > 0 && (
          <div className="notice-block">
            <h4>Log your service</h4>
            <ul>
              {reminders.map((s) => (
                <li key={s.id}>
                  {label(s.event_id)} <small>happened {fmtDate(s.date)} — no hours logged yet</small>
                </li>
              ))}
            </ul>
            <Link className="btn" to="/member/log" onClick={close}>
              Log Service
            </Link>
          </div>
        )}

        <div className="formfoot">
          <button type="button" className="btn ghost" onClick={close}>
            Got It
          </button>
        </div>
      </div>
    </div>
  )
}
