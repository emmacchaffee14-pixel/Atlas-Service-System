import { Fragment, useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'
import { keyOf } from '../../lib/stats.js'

export default function Nominations() {
  const { roster, nominations, refresh } = useAdminData()
  const [saving, setSaving] = useState(null)

  const rosterByEmail = useMemo(() => new Map(roster.map((r) => [keyOf(r.email), r])), [roster])

  const sorted = useMemo(
    () => [...nominations].sort((x, y) => (y.created_at || '').localeCompare(x.created_at || '')),
    [nominations],
  )
  const pending = sorted.filter((n) => (n.status || 'pending') === 'pending')

  async function setStatus(id, status) {
    setSaving(id)
    const { error } = await supabase.from('nominations').update({ status }).eq('id', id)
    setSaving(null)
    if (!error) await refresh()
  }

  return (
    <>
      <div className="pagehead">
        <h1>Nominations</h1>
        <p>{pending.length ? `${pending.length} waiting on review` : 'All reviewed'}</p>
      </div>

      <section>
        {sorted.length === 0 ? (
          <p className="empty">
            Nothing nominated yet. Member submissions land here for review before they count.
          </p>
        ) : (
          sorted.map((n) => {
            const status = n.status || 'pending'
            const member = rosterByEmail.get(keyOf(n.member_email))
            const fields = [
              ['Submitted by', member?.full_name || n.member_email],
              ['When', `${fmtDate(n.event_date)} at ${n.event_time || ''}`],
              ['Where', n.address],
              ['Volunteers', n.volunteers ? String(n.volunteers) : ''],
              ['Contact', n.contact],
              ['Website', n.website],
              ['What they would do', n.description],
              ['Notes', n.notes],
            ].filter(([, v]) => v)
            return (
              <div className="nom" key={n.id}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <h3>{n.org_name}</h3>
                  <span
                    className={
                      'tag' + (status === 'approved' ? ' ok' : status === 'declined' ? ' no' : '')
                    }
                  >
                    {status}
                  </span>
                </div>
                <dl>
                  {fields.map(([label, value]) => (
                    <Fragment key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </Fragment>
                  ))}
                </dl>
                {status === 'pending' && (
                  <div className="formfoot">
                    <button
                      className="btn sm"
                      disabled={saving === n.id}
                      onClick={() => setStatus(n.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      className="btn sm warn"
                      disabled={saving === n.id}
                      onClick={() => setStatus(n.id, 'declined')}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>
    </>
  )
}
