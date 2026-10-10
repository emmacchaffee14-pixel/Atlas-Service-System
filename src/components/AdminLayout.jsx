import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import { AdminDataContext } from '../context/AdminDataContext.js'
import { supabase } from '../lib/supabaseClient.js'

// Settings is admin-only, and lives in the session area, not this list —
// see the .session block below.
const ADMIN_NAV = [
  ['/admin', 'Dashboard'],
  ['/admin/members', 'Members'],
  ['/admin/groups', 'Groups'],
  ['/admin/events', 'Events'],
  ['/admin/logs', 'Service Logs'],
  ['/admin/contacts', 'Contacts'],
  ['/admin/messages', 'Messages'],
  ['/admin/nominations', 'Nominations'],
  ['/admin/files', 'Files'],
]

async function loadReferenceData() {
  const [settings, roster, mentors, orgs, events, signups, logs, nominations, contacts, accountStatus, messages] =
    await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('roster').select('*').order('full_name'),
      supabase.from('mentors').select('*').order('name'),
      supabase.from('orgs').select('*'),
      supabase.from('events').select('*'),
      supabase.from('signups').select('*'),
      supabase.from('service_logs').select('*'),
      supabase.from('nominations').select('*'),
      supabase.from('contacts').select('*').order('created_at', { ascending: false }),
      supabase.from('account_status').select('*').order('full_name'),
      supabase.from('messages').select('*').order('created_at'),
    ])
  for (const r of [settings, roster, mentors, orgs, events, signups, logs, nominations, contacts, accountStatus, messages]) {
    if (r.error) throw r.error
  }
  return {
    settings: settings.data,
    roster: roster.data ?? [],
    mentors: mentors.data ?? [],
    orgs: orgs.data ?? [],
    events: events.data ?? [],
    signups: signups.data ?? [],
    // Only approved logs count everywhere; allLogs feeds the review queue and Files.
    logs: (logs.data ?? []).filter((l) => (l.status ?? 'approved') === 'approved'),
    allLogs: logs.data ?? [],
    nominations: nominations.data ?? [],
    contacts: contacts.data ?? [],
    accountStatus: accountStatus.data ?? [],
    messages: messages.data ?? [],
  }
}

export default function AdminLayout() {
  const [gate, setGate] = useState({ status: 'loading' })
  const [data, setData] = useState(null)
  const [dataError, setDataError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    async function check() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        if (active) setGate({ status: 'unauthorized' })
        return
      }
      const email = session.user.email.toLowerCase()
      const { data: rosterRow, error: rosterError } = await supabase
        .from('roster')
        .select('full_name, is_officer, is_admin')
        .eq('email', email)
        .maybeSingle()
      if (!active) return
      if (rosterError) {
        // A schema mismatch or RLS misconfiguration looks identical to a
        // bad login if we fall through to "unauthorized" here — surface it.
        setGate({ status: 'error', message: rosterError.message })
        return
      }
      if (!rosterRow?.is_officer) {
        setGate({ status: 'unauthorized' })
        return
      }
      setGate({
        status: 'ok',
        email,
        fullName: rosterRow.full_name,
        isAdmin: rosterRow.is_admin,
      })
    }
    check()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => check())
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const refresh = useCallback(async () => {
    const d = await loadReferenceData()
    setData(d)
    return d
  }, [])

  useEffect(() => {
    if (gate.status !== 'ok') return
    let active = true
    loadReferenceData()
      .then((d) => active && setData(d))
      .catch((e) => active && setDataError(e))
    return () => {
      active = false
    }
  }, [gate.status])

  if (gate.status === 'loading') {
    return <p className="note" style={{ padding: 40, textAlign: 'center' }}>Checking your session…</p>
  }
  if (gate.status === 'error') {
    return (
      <div className="wrap" style={{ paddingTop: 40 }}>
        <div className="flag">
          Could not check officer access: {gate.message}. If this just started, the database
          schema may be out of date — re-run supabase/schema.sql.
        </div>
      </div>
    )
  }
  if (gate.status === 'unauthorized') {
    return <Navigate to="/" replace />
  }

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="shell">
      <Sidebar
        brandTo="/admin"
        navItems={ADMIN_NAV.map(([path, label]) => {
          if (path === '/admin/messages') {
            return [path, label, (data?.messages ?? []).filter((m) => m.sender === 'member' && !m.read_at).length]
          }
          if (path === '/admin/logs') {
            return [path, label, (data?.allLogs ?? []).filter((l) => l.status === 'pending').length]
          }
          return [path, label]
        })}
        roleLabel={gate.isAdmin ? 'Admin' : 'Officer'}
        name={gate.fullName}
        extraLink={gate.isAdmin ? { to: '/admin/settings', label: 'Settings' } : null}
        onSignOut={signOut}
      />
      <div className="main-area">
        <div className="wrap">
          {dataError && <div className="flag">Could not load officer data. Try refreshing.</div>}
          {!data && !dataError && (
            <p className="note" style={{ padding: 40, textAlign: 'center' }}>Loading…</p>
          )}
          {data && (
            <AdminDataContext.Provider
              value={{ ...data, refresh, officerEmail: gate.email, isAdmin: gate.isAdmin }}
            >
              <Outlet />
            </AdminDataContext.Provider>
          )}
        </div>
        <p className="watermark">Atlas Business Society &middot; Service</p>
      </div>
    </div>
  )
}
