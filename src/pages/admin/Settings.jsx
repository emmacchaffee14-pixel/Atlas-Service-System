import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminData } from '../../context/AdminDataContext.js'
import RoleTag from '../../components/RoleTag.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { inviteMember } from '../../lib/inviteMember.js'
import { reqHours, swabCap } from '../../lib/stats.js'

function actionLabel(status) {
  if (status === 'Active') return 'Send Password Reset'
  if (status === 'Invited') return 'Resend Invite'
  return 'Invite'
}

function roleLabel(row) {
  if (row.is_admin) return 'Admin'
  if (row.is_officer) return 'Officer'
  return 'Member'
}

export default function Settings() {
  const { settings, roster, accountStatus, refresh, officerEmail, isAdmin } = useAdminData()
  const toast = useToast()
  const [savingSettings, setSavingSettings] = useState(false)
  const [reqValue, setReqValue] = useState(String(reqHours(settings)))
  const [capValue, setCapValue] = useState(String(swabCap(settings)))
  const [semesterValue, setSemesterValue] = useState(settings?.semester || '')
  const [webhookValue, setWebhookValue] = useState(settings?.calendar_webhook_url || '')
  const [roleBusy, setRoleBusy] = useState(null)
  const [promoteEmail, setPromoteEmail] = useState('')
  const [promoteAdminEmail, setPromoteAdminEmail] = useState('')
  const [accountBusy, setAccountBusy] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  if (!isAdmin) {
    return <Navigate to="/admin" replace />
  }

  const officers = roster.filter((r) => r.is_officer)
  const promotable = roster.filter((r) => !r.is_officer)
  const admins = roster.filter((r) => r.is_admin)
  const promotableToAdmin = roster.filter((r) => r.is_officer && !r.is_admin)

  async function saveSettings(e) {
    e.preventDefault()
    setSavingSettings(true)
    const { error } = await supabase
      .from('settings')
      .update({
        hour_requirement: Number(reqValue) || 0,
        swab_cap: Number(capValue) || 0,
        semester: semesterValue,
        calendar_webhook_url: webhookValue || null,
      })
      .eq('id', 1)
    setSavingSettings(false)
    if (error) {
      toast('Could not save settings.')
      return
    }
    await refresh()
    toast('Settings saved.')
  }

  async function demoteOfficer(email) {
    if (officers.length <= 1) {
      toast('At least one officer is required. Promote someone else first.')
      return
    }
    if (email === officerEmail) {
      const sure = window.confirm('Remove your own officer access? You will lose access to this page.')
      if (!sure) return
    }
    setRoleBusy(email)
    const { error } = await supabase
      .from('roster')
      .update({ is_officer: false, is_admin: false })
      .eq('email', email)
    setRoleBusy(null)
    if (error) {
      toast('Could not remove that officer.')
      return
    }
    await refresh()
    toast('Officer removed.')
  }

  async function promoteOfficer(e) {
    e.preventDefault()
    if (!promoteEmail) return
    setRoleBusy(promoteEmail)
    const { error } = await supabase.from('roster').update({ is_officer: true }).eq('email', promoteEmail)
    setRoleBusy(null)
    if (error) {
      toast('Could not add that officer.')
      return
    }
    setPromoteEmail('')
    await refresh()
    toast('Officer added.')
  }

  async function demoteAdmin(email) {
    if (admins.length <= 1) {
      toast('At least one admin is required. Promote someone else first.')
      return
    }
    if (email === officerEmail) {
      const sure = window.confirm('Remove your own admin access? You will lose access to this page.')
      if (!sure) return
    }
    setRoleBusy(email)
    const { error } = await supabase.from('roster').update({ is_admin: false }).eq('email', email)
    setRoleBusy(null)
    if (error) {
      toast('Could not remove that admin.')
      return
    }
    await refresh()
    toast('Admin removed.')
  }

  async function promoteAdmin(e) {
    e.preventDefault()
    if (!promoteAdminEmail) return
    setRoleBusy(promoteAdminEmail)
    const { error } = await supabase.from('roster').update({ is_admin: true }).eq('email', promoteAdminEmail)
    setRoleBusy(null)
    if (error) {
      toast('Could not add that admin.')
      return
    }
    setPromoteAdminEmail('')
    await refresh()
    toast('Admin added.')
  }

  async function handleAccountAction(row) {
    setAccountBusy(row.email)
    try {
      if (row.status === 'Active') {
        const { error } = await supabase.auth.resetPasswordForEmail(row.email, {
          redirectTo: `${window.location.origin}/setup`,
        })
        if (error) throw error
        toast(`Password reset sent to ${row.email}.`)
      } else {
        await inviteMember(row.email)
        await refresh()
        toast(`Invite sent to ${row.email}.`)
      }
    } catch (err) {
      toast(err.message || 'Could not complete that action.')
    } finally {
      setAccountBusy(null)
    }
  }

  async function inviteAllWithoutAccount() {
    const todo = accountStatus.filter((x) => x.status === 'Not invited')
    if (!todo.length) {
      toast('Everyone already has an invite or an account.')
      return
    }
    setBulkBusy(true)
    let n = 0
    for (const x of todo) {
      try {
        await inviteMember(x.email)
        n++
      } catch {
        // best effort — keep going for the rest of the roster
      }
    }
    setBulkBusy(false)
    await refresh()
    toast(`${n} invite${n === 1 ? '' : 's'} sent.`)
  }

  const activeCount = accountStatus.filter((x) => x.status === 'Active').length
  const invitedCount = accountStatus.filter((x) => x.status === 'Invited').length
  const notInvitedCount = accountStatus.length - activeCount - invitedCount

  return (
    <>
      <div className="pagehead">
        <h1>Settings</h1>
        <p>Requirement rules and who gets officer and admin access.</p>
      </div>

      <section>
        <form className="card" onSubmit={saveSettings}>
          <div className="fields">
            <div>
              <label htmlFor="stReq">
                Service hours required
                <small>Per member, per semester</small>
              </label>
              <input
                id="stReq"
                type="number"
                required
                value={reqValue}
                onChange={(e) => setReqValue(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="stCap">
                Book-drive hours that count
                <small>Ceiling on ADOS / SWAB hours</small>
              </label>
              <input
                id="stCap"
                type="number"
                required
                value={capValue}
                onChange={(e) => setCapValue(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="stSem">Semester</label>
              <input
                id="stSem"
                type="text"
                required
                value={semesterValue}
                onChange={(e) => setSemesterValue(e.target.value)}
              />
            </div>
            <div className="span2">
              <label htmlFor="stWebhook">
                Calendar webhook
                <small>
                  Google Apps Script Web App URL — see google-apps-script/calendar-hold.gs. Sends
                  a calendar invite for every signup, a ride-needed alert, and a new-event hold.
                  Blank means nothing is sent.
                </small>
              </label>
              <input
                id="stWebhook"
                type="url"
                placeholder="https://script.google.com/macros/s/…/exec"
                value={webhookValue}
                onChange={(e) => setWebhookValue(e.target.value)}
              />
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={savingSettings}>
              Save settings
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="plate">
          <h2>Officer Access</h2>
        </div>
        {officers.length === 0 ? (
          <p className="empty">No officers added yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>UGA Email</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {officers.map((o) => (
                  <tr key={o.email}>
                    <td>
                      {o.full_name}
                      {o.email === officerEmail && <span className="note"> (you)</span>}
                    </td>
                    <td>{o.email}</td>
                    <td>
                      <button
                        className="btn sm warn"
                        disabled={roleBusy === o.email}
                        onClick={() => demoteOfficer(o.email)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form className="card" style={{ marginTop: 14, maxWidth: 'none' }} onSubmit={promoteOfficer}>
          <div className="fields">
            <div>
              <label htmlFor="ofEmail">
                Promote a member to officer
                <small>They must already be on the roster.</small>
              </label>
              <select id="ofEmail" value={promoteEmail} onChange={(e) => setPromoteEmail(e.target.value)} required>
                <option value="">Choose a member</option>
                {promotable.map((r) => (
                  <option key={r.email} value={r.email}>
                    {r.full_name} &mdash; {r.email}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={!promoteEmail || roleBusy === promoteEmail}>
              Make Officer
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="plate">
          <h2>Admin Access</h2>
          <span>Admins reach Settings; everyone else on the officer roster does not.</span>
        </div>
        {admins.length === 0 ? (
          <p className="empty">No admins yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>UGA Email</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((o) => (
                  <tr key={o.email}>
                    <td>
                      {o.full_name}
                      {o.email === officerEmail && <span className="note"> (you)</span>}
                    </td>
                    <td>{o.email}</td>
                    <td>
                      <button
                        className="btn sm warn"
                        disabled={roleBusy === o.email}
                        onClick={() => demoteAdmin(o.email)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form className="card" style={{ marginTop: 14, maxWidth: 'none' }} onSubmit={promoteAdmin}>
          <div className="fields">
            <div>
              <label htmlFor="adEmail">
                Promote an officer to admin status
                <small>They must already be an officer.</small>
              </label>
              <select
                id="adEmail"
                value={promoteAdminEmail}
                onChange={(e) => setPromoteAdminEmail(e.target.value)}
                required
              >
                <option value="">Choose an officer</option>
                {promotableToAdmin.map((r) => (
                  <option key={r.email} value={r.email}>
                    {r.full_name} &mdash; {r.email}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="formfoot">
            <button
              className="btn"
              type="submit"
              disabled={!promoteAdminEmail || roleBusy === promoteAdminEmail}
            >
              Make Admin
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="plate">
          <h2>Accounts</h2>
          <span>
            {activeCount} active &middot; {invitedCount} invited &middot; {notInvitedCount} not invited
          </span>
        </div>
        <p className="lede">
          Invite sends a one-time link by email. Members choose their own password &mdash; nobody
          on the executive board can see it.
        </p>
        <div className="formfoot" style={{ marginTop: 0, marginBottom: 16 }}>
          <button className="btn" disabled={bulkBusy} onClick={inviteAllWithoutAccount}>
            Invite Everyone Without An Account
          </button>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>UGA Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accountStatus.map((x) => (
                <tr key={x.email}>
                  <td>
                    {x.full_name}
                    {x.email === officerEmail && <span className="note"> (you)</span>}
                  </td>
                  <td>{x.email}</td>
                  <td>
                    <RoleTag role={roleLabel(x)} />
                  </td>
                  <td className={x.status === 'Active' ? 'yes' : x.status === 'Not invited' ? 'no' : undefined}>
                    {x.status}
                  </td>
                  <td>
                    <button
                      className="btn sm ghost"
                      disabled={accountBusy === x.email}
                      onClick={() => handleAccountAction(x)}
                    >
                      {actionLabel(x.status)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
