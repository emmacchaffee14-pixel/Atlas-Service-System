import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { inviteMember } from '../../lib/inviteMember.js'
import { downloadCsv } from '../../lib/csv.js'
import { reqHours, swabCap } from '../../lib/stats.js'

function actionLabel(status) {
  return status === 'Active' ? 'Send Password Reset' : 'Copy Invite Link'
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
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
  const [newAdminName, setNewAdminName] = useState('')
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [accountBusy, setAccountBusy] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  if (!isAdmin) {
    return <Navigate to="/admin" replace />
  }

  // "Officer" is a real-world title (mentor/group leader) with no portal
  // meaning — admin is the only access tier. is_officer still gets set
  // alongside is_admin under the hood (the schema requires it), but
  // nothing in this UI manages it separately or shows it.
  const admins = roster.filter((r) => r.is_admin)
  const memberAccountStatus = accountStatus.filter((x) => !x.is_admin)
  const statusByEmail = new Map(accountStatus.map((x) => [x.email, x.status]))

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
    toast('Settings Saved.')
  }

  async function demoteAdmin(email) {
    if (admins.length <= 1) {
      toast('At least one admin is required. Add someone else first.')
      return
    }
    if (email === officerEmail) {
      const sure = window.confirm('Remove your own admin access? You will lose access to this page.')
      if (!sure) return
    }
    setRoleBusy(email)
    const { error } = await supabase
      .from('roster')
      .update({ is_officer: false, is_admin: false })
      .eq('email', email)
    setRoleBusy(null)
    if (error) {
      toast('Could not remove that admin.')
      return
    }
    await refresh()
    toast('Admin removed.')
  }

  // The only path to admin access — works whether the person is already
  // on the roster (an existing member) or not (a mentor who's never had a
  // login). The roster insert, if needed, leaves roles false; the update
  // right after is what actually grants access, so it goes through
  // guard_role_changes() like every other role change here.
  async function addAdmin(e) {
    e.preventDefault()
    if (!newAdminName.trim() || !newAdminEmail.trim()) return
    const email = newAdminEmail.trim().toLowerCase()
    const fullName = newAdminName.trim()
    setAddingAdmin(true)
    const { error: insertError } = await supabase.from('roster').insert({ email, full_name: fullName })
    if (insertError && insertError.code !== '23505') {
      setAddingAdmin(false)
      toast('Could not add that person.')
      return
    }
    const { error } = await supabase
      .from('roster')
      .update({ full_name: fullName, is_officer: true, is_admin: true })
      .eq('email', email)
    setAddingAdmin(false)
    if (error) {
      toast('Could not grant admin access.')
      return
    }
    setNewAdminName('')
    setNewAdminEmail('')
    await refresh()
    toast('Admin access granted.')
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
        const result = await inviteMember(row.email)
        await refresh()
        if (result?.link && (await copyToClipboard(result.link))) {
          toast(
            `Invite link copied for ${row.email} — paste it straight to them. Don't open it yourself, it's one-time use.`,
          )
        } else if (result?.link) {
          toast(`Invite link ready (copy failed): ${result.link}`)
        } else {
          toast(`Invite ready for ${row.email}.`)
        }
      }
    } catch (err) {
      toast(err.message || 'Could not complete that action.')
    } finally {
      setAccountBusy(null)
    }
  }

  // Supabase's built-in email sender is rate-limited to a handful of sends
  // an hour with no custom SMTP configured — nowhere near enough for the
  // whole roster at once. inviteMember() generates the one-time link
  // without Supabase sending anything, so there's no limit to hit here;
  // this just collects every link into a CSV for manual delivery instead
  // of a single clipboard copy, since 65 links can't all live in one paste.
  async function inviteAllWithoutAccount() {
    const todo = memberAccountStatus.filter((x) => x.status === 'Not invited')
    if (!todo.length) {
      toast('Everyone already has an invite or an account.')
      return
    }
    setBulkBusy(true)
    const links = []
    let lastError = null
    for (const x of todo) {
      try {
        const result = await inviteMember(x.email)
        if (result?.link) links.push([x.full_name, x.email, result.link])
      } catch (err) {
        lastError = err
      }
    }
    setBulkBusy(false)
    await refresh()
    if (links.length) {
      downloadCsv('atlas-invite-links.csv', [['Name', 'Email', 'Invite Link'], ...links])
    }
    if (links.length === todo.length) {
      toast(
        `${links.length} invite link${links.length === 1 ? '' : 's'} downloaded — send each one as-is, don't open them yourself first.`,
      )
    } else if (links.length > 0) {
      toast(`${links.length} of ${todo.length} links downloaded, ${todo.length - links.length} failed: ${lastError?.message || 'unknown error'}`)
    } else {
      toast(`Could not generate invite links: ${lastError?.message || 'unknown error'}`)
    }
  }

  const activeCount = memberAccountStatus.filter((x) => x.status === 'Active').length
  const invitedCount = memberAccountStatus.filter((x) => x.status === 'Invited').length
  const notInvitedCount = memberAccountStatus.length - activeCount - invitedCount

  return (
    <>
      <div className="pagehead">
        <h1>Settings</h1>
        <p>Requirement rules and who gets admin access.</p>
      </div>

      <section>
        <form className="card" style={{ maxWidth: 'none' }} onSubmit={saveSettings}>
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
              Save Settings
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="plate">
          <h2>Admin Access</h2>
          <span>Admins see everything and reach Settings. There is no tier below it.</span>
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
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((o) => {
                  const status = statusByEmail.get(o.email) || 'Not invited'
                  return (
                    <tr key={o.email}>
                      <td>
                        {o.full_name}
                        {o.email === officerEmail && <span className="note"> (you)</span>}
                      </td>
                      <td>{o.email}</td>
                      <td className={status === 'Active' ? 'yes' : status === 'Not invited' ? 'no' : undefined}>
                        {status}
                      </td>
                      <td style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn sm ghost"
                          disabled={accountBusy === o.email}
                          onClick={() => handleAccountAction({ email: o.email, status })}
                        >
                          {actionLabel(status)}
                        </button>
                        <button
                          className="btn sm warn"
                          disabled={roleBusy === o.email}
                          onClick={() => demoteAdmin(o.email)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <form className="card" style={{ marginTop: 14, maxWidth: 'none' }} onSubmit={addAdmin}>
          <div className="fields">
            <div>
              <label htmlFor="adName">
                Add an Admin
                <small>Works even if they're not on the roster yet — a mentor, say.</small>
              </label>
              <input
                id="adName"
                type="text"
                required
                placeholder="Full name"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="adEmail">UGA Email</label>
              <input
                id="adEmail"
                type="email"
                required
                placeholder="name@uga.edu"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={addingAdmin}>
              Add Admin
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
          The member roster &mdash; admins are managed above, not listed here. Copy Invite Link
          gets a one-time link to paste into an email or text yourself; Supabase never sends
          anything, so there's no rate limit to hit. Don't open a link yourself to check it
          &mdash; that uses it up, and the member will see "expired" when they click it. Members
          choose their own password &mdash; nobody on the executive board can see it.
        </p>
        <div className="formfoot" style={{ marginTop: 0, marginBottom: 16 }}>
          <button className="btn" disabled={bulkBusy} onClick={inviteAllWithoutAccount}>
            Download All Invite Links
          </button>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>UGA Email</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {memberAccountStatus.map((x) => (
                <tr key={x.email}>
                  <td>{x.full_name}</td>
                  <td>{x.email}</td>
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
