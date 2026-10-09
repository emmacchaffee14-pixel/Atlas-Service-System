import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'
import { signedProofUrl } from '../../lib/proofUpload.js'
import { keyOf } from '../../lib/stats.js'

export default function Files() {
  const { roster, orgs, events, allLogs: logs } = useAdminData()
  const toast = useToast()
  const [filters, setFilters] = useState({ partner: '', has: 'proof', search: '' })
  const [openingId, setOpeningId] = useState(null)

  const rosterByEmail = useMemo(() => new Map(roster.map((r) => [keyOf(r.email), r])), [roster])
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const activeOrgs = useMemo(() => orgs.filter((o) => o.active !== false), [orgs])

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

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  const rows = useMemo(() => {
    return logs
      .map((l) => {
        const ev = eventsById.get(l.event_id)
        const org = ev ? orgsById.get(ev.org_id) : null
        const member = rosterByEmail.get(keyOf(l.member_email))
        return { log: l, event: ev, org, member }
      })
      .filter((r) => {
        if (filters.has === 'proof' && !r.log.proof_path) return false
        if (filters.has === 'no-proof' && r.log.proof_path) return false
        if (filters.partner && r.event?.org_id !== filters.partner) return false
        const q = keyOf(filters.search)
        if (q) {
          const hay = `${r.member?.full_name || r.log.member_email} ${r.log.member_email}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => (b.log.created_at || '').localeCompare(a.log.created_at || ''))
  }, [logs, eventsById, orgsById, rosterByEmail, filters])

  const proofCount = logs.filter((l) => l.proof_path).length

  return (
    <>
      <div className="pagehead">
        <h1>Files</h1>
        <p>
          Every service log's proof photo or document, in one place — no need to dig through
          individual members.
        </p>
      </div>

      <section>
        <div className="filters">
          <div>
            <label htmlFor="ffPartner">Partner</label>
            <select id="ffPartner" value={filters.partner} onChange={(e) => setFilter('partner', e.target.value)}>
              <option value="">All partners</option>
              {activeOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ffHas">Files</label>
            <select id="ffHas" value={filters.has} onChange={(e) => setFilter('has', e.target.value)}>
              <option value="proof">With a file attached</option>
              <option value="no-proof">Without a file</option>
              <option value="">Every log</option>
            </select>
          </div>
          <div>
            <label htmlFor="ffSearch">Search</label>
            <input
              id="ffSearch"
              type="search"
              placeholder="Member name or email"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>
        </div>

        <div className="plate">
          <h2></h2>
          <span>
            {rows.length} of {logs.length} logs &middot; {proofCount} with a file
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="empty">Nothing matches those filters.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Partner</th>
                  <th>Date</th>
                  <th className="n">Hours</th>
                  <th className="n">Reported</th>
                  <th className="wrapok">Takeaway</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ log, event, org, member }) => (
                  <tr key={log.id}>
                    <td>{member?.full_name || log.member_email}</td>
                    <td>{org?.name || event?.org_id || '—'}</td>
                    <td>{event ? fmtDate(event.event_date) : '—'}</td>
                    <td className="n">{String(log.hours)}</td>
                    <td className="n">{log.quantity == null ? '' : String(log.quantity)}</td>
                    <td className="wrapok">{log.takeaway || '—'}</td>
                    <td>
                      {log.proof_path ? (
                        <button
                          className="btn ghost sm"
                          disabled={openingId === log.id}
                          onClick={() => viewProof(log.id, log.proof_path)}
                        >
                          View
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
