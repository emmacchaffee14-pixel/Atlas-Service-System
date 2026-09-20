import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import GlobeMark from './GlobeMark.jsx'
import { AdminDataContext } from '../context/AdminDataContext.js'
import { supabase } from '../lib/supabaseClient.js'

// Settings is admin-only, and lives in the session area, not this list —
// see the .session block below.
const ADMIN_NAV = [
  ['/admin', 'Dashboard'],
  ['/admin/members', 'Members'],
  ['/admin/groups', 'Groups'],
  ['/admin/events', 'Events'],
  ['/admin/nominations', 'Nominations'],
]

async function loadReferenceData() {
  const [settings, roster, mentors, orgs, events, signups, logs, nominations, accountStatus] =
    await Promise.all([
      supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('roster').select('*').order('full_name'),
      supabase.from('mentors').select('*').order('name'),
      supabase.from('orgs').select('*'),
      supabase.from('events').select('*'),
      supabase.from('signups').select('*'),
      supabase.from('service_logs').select('*'),
      supabase.from('nominations').select('*'),
      supabase.from('account_status').select('*').order('full_name'),
    ])
  for (const r of [settings, roster, mentors, orgs, events, signups, logs, nominations, accountStatus]) {
    if (r.error) throw r.error
  }
  return {
    settings: settings.data,
    roster: roster.data ?? [],
    mentors: mentors.data ?? [],
    orgs: orgs.data ?? [],
    events: events.data ?? [],
    signups: signups.data ?? [],
    logs: logs.data ?? [],
    nominations: nominations.data ?? [],
    accountStatus: accountStatus.data ?? [],
  }
}

export default function AdminLayout() {
  const [gate, setGate] = useState({ status: 'loading' })
  const [data, setData] = useState(null)
  const [dataError, setDataError] = useState(null)
  const location = useLocation()
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
    <>
      <header className="top">
        <div className="topin">
          <Link className="mark" to="/admin" aria-label="Atlas Service, home">
            <GlobeMark className="globe" />
            <span>
              Atlas <em>Service</em>
            </span>
          </Link>
          <nav className="main">
            {ADMIN_NAV.map(([path, label]) => (
              <Link key={path} to={path} className={location.pathname === path ? 'on' : ''}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="session">
            <span>
              {gate.isAdmin ? 'Admin' : 'Officer'} &middot; <b>{gate.fullName}</b>
            </span>
            {gate.isAdmin && (
              <Link to="/admin/settings" className={location.pathname === '/admin/settings' ? 'on' : ''}>
                Settings
              </Link>
            )}
            <button onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>
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
    </>
  )
}
