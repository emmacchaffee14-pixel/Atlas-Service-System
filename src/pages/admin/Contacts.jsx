import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'

const STATUS_LABELS = {
  reached_out: 'Reached Out',
  responded: 'Responded',
  meeting_set: 'Meeting Set',
  partner: 'Partner',
  declined: 'Declined',
  no_response: 'No Response',
}

const NEW_CONTACT_INITIAL = {
  orgId: '',
  orgName: '',
  name: '',
  title: '',
  email: '',
  phone: '',
  status: 'reached_out',
  lastContactDate: '',
  notes: '',
}

export default function Contacts() {
  const { orgs, contacts, officerEmail, refresh } = useAdminData()
  const toast = useToast()
  const [filters, setFilters] = useState({ org: '', status: '', search: '' })
  const [form, setForm] = useState(NEW_CONTACT_INITIAL)
  const [adding, setAdding] = useState(false)
  const [rowBusy, setRowBusy] = useState(null)

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function setFilter(key) {
    return (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))
  }

  const sorted = useMemo(
    () => [...contacts].sort((x, y) => (y.created_at || '').localeCompare(x.created_at || '')),
    [contacts],
  )

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return sorted.filter((c) => {
      if (filters.org && c.org_id !== filters.org) return false
      if (filters.status && c.status !== filters.status) return false
      if (q) {
        const org = c.org_id ? orgsById.get(c.org_id)?.name : c.org_name
        const hay = `${c.name} ${org || ''} ${c.email || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sorted, filters, orgsById])

  async function addContact(e) {
    e.preventDefault()
    if (!form.name || (!form.orgId && !form.orgName)) {
      toast('Give it a name and an organization.')
      return
    }
    setAdding(true)
    const { error } = await supabase.from('contacts').insert({
      org_id: form.orgId || null,
      org_name: form.orgId ? null : form.orgName,
      name: form.name,
      title: form.title || null,
      email: form.email || null,
      phone: form.phone || null,
      status: form.status,
      last_contact_date: form.lastContactDate || null,
      notes: form.notes || null,
      created_by: officerEmail,
    })
    setAdding(false)
    if (error) {
      toast('Could not save that contact.')
      return
    }
    setForm(NEW_CONTACT_INITIAL)
    await refresh()
    toast('Contact added.')
  }

  async function updateStatus(id, status) {
    setRowBusy(id)
    const { error } = await supabase.from('contacts').update({ status }).eq('id', id)
    setRowBusy(null)
    if (error) {
      toast('Could not update that contact.')
      return
    }
    await refresh()
  }

  return (
    <>
      <div className="pagehead">
        <h1>Contacts</h1>
        <p>
          Every organization the cohort has reached out to, and where things stand — separate from
          the Partners on the Events page, which only lists orgs with a scheduled event.
        </p>
      </div>

      <section>
        <div className="filters">
          <div>
            <label htmlFor="cfOrg">Organization</label>
            <select id="cfOrg" value={filters.org} onChange={setFilter('org')}>
              <option value="">All organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cfStatus">Status</label>
            <select id="cfStatus" value={filters.status} onChange={setFilter('status')}>
              <option value="">Everyone</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cfSearch">Search</label>
            <input
              id="cfSearch"
              type="search"
              placeholder="Name, org or email"
              value={filters.search}
              onChange={setFilter('search')}
            />
          </div>
        </div>

        <div className="plate">
          <h2></h2>
          <span>
            {filtered.length} of {contacts.length} contacts
          </span>
        </div>

        {filtered.length === 0 ? (
          <p className="empty">
            {contacts.length === 0
              ? 'No contacts logged yet. Add the first one below.'
              : 'Nothing matches those filters.'}
          </p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Organization</th>
                  <th>Title</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Last Contact</th>
                  <th className="wrapok">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.org_id ? orgsById.get(c.org_id)?.name || c.org_id : c.org_name || '—'}</td>
                    <td>{c.title || '—'}</td>
                    <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                    <td>{c.phone || '—'}</td>
                    <td>
                      <select
                        value={c.status}
                        disabled={rowBusy === c.id}
                        onChange={(e) => updateStatus(c.id, e.target.value)}
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{c.last_contact_date ? fmtDate(c.last_contact_date) : '—'}</td>
                    <td className="wrapok">{c.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="plate">
          <h2>Add a Contact</h2>
        </div>
        <form className="card" style={{ maxWidth: 'none' }} onSubmit={addContact}>
          <div className="fields">
            <div>
              <label htmlFor="cName">Name</label>
              <input id="cName" type="text" required value={form.name} onChange={set('name')} />
            </div>
            <div>
              <label htmlFor="cOrgId">
                Organization
                <small>Pick a partner, or type a new one below</small>
              </label>
              <select id="cOrgId" value={form.orgId} onChange={set('orgId')}>
                <option value="">Not an existing partner</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            {!form.orgId && (
              <div>
                <label htmlFor="cOrgName">
                  New organization name
                  <small>A lead, not yet a partner</small>
                </label>
                <input id="cOrgName" type="text" value={form.orgName} onChange={set('orgName')} />
              </div>
            )}
            <div>
              <label htmlFor="cTitle">
                Title
                <small>Optional</small>
              </label>
              <input id="cTitle" type="text" value={form.title} onChange={set('title')} />
            </div>
            <div>
              <label htmlFor="cEmail">
                Email
                <small>Optional</small>
              </label>
              <input id="cEmail" type="email" value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label htmlFor="cPhone">
                Phone
                <small>Optional</small>
              </label>
              <input id="cPhone" type="tel" value={form.phone} onChange={set('phone')} />
            </div>
            <div>
              <label htmlFor="cStatus">Status</label>
              <select id="cStatus" value={form.status} onChange={set('status')}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cLast">
                Last contact date
                <small>Optional</small>
              </label>
              <input
                id="cLast"
                type="date"
                value={form.lastContactDate}
                onChange={set('lastContactDate')}
              />
            </div>
            <div className="span2">
              <label htmlFor="cNotes">
                Notes
                <small>Optional</small>
              </label>
              <textarea id="cNotes" value={form.notes} onChange={set('notes')} />
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={adding}>
              Add contact
            </button>
          </div>
        </form>
      </section>
    </>
  )
}
