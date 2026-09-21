import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import { MemberDataContext } from '../context/MemberDataContext.js'
import { supabase } from '../lib/supabaseClient.js'
import { keyOf } from '../lib/stats.js'

const MEMBER_NAV = [
  ['/member/opportunities', 'Opportunities'],
  ['/member/log', 'Log Service'],
  ['/member/nominate', 'Nominate'],
  ['/member/standing', 'My Standing'],
]

async function loadMemberData(email) {
  const [settings, me, mentors, orgs, events, signups, logs] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabase.from('roster').select('*').eq('email', email).maybeSingle(),
    supabase.from('mentors').select('*').order('name'),
    supabase.from('orgs').select('*'),
    supabase.from('events').select('*'),
    supabase.from('signups').select('*'),
    // RLS already scopes this to the caller's own rows unless they're also
    // an officer — filter client-side too so the math is right either way.
    supabase.from('service_logs').select('*'),
  ])
  for (const r of [settings, me, mentors, orgs, events, signups, logs]) {
    if (r.error) throw r.error
  }
  return {
    settings: settings.data,
    me: me.data,
    mentors: mentors.data ?? [],
    orgs: orgs.data ?? [],
    events: events.data ?? [],
    signups: signups.data ?? [],
    logs: (logs.data ?? []).filter((l) => keyOf(l.member_email) === keyOf(email)),
  }
}

export default function MemberLayout() {
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
      if (active) setGate({ status: 'ok', email: session.user.email.toLowerCase() })
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
    if (gate.status !== 'ok') return
    const d = await loadMemberData(gate.email)
    setData(d)
    return d
  }, [gate.status, gate.email])

  useEffect(() => {
    if (gate.status !== 'ok') return
    let active = true
    loadMemberData(gate.email)
      .then((d) => active && setData(d))
      .catch((e) => active && setDataError(e))
    return () => {
      active = false
    }
  }, [gate.status, gate.email])

  if (gate.status === 'loading') {
    return <p className="note" style={{ padding: 40, textAlign: 'center' }}>Checking your session…</p>
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
        brandTo="/member/opportunities"
        navItems={MEMBER_NAV}
        name={data?.me?.full_name || gate.email}
        onSignOut={signOut}
      />
      <div className="main-area">
        <div className="wrap">
          {dataError && <div className="flag">Could not load your data. Try refreshing.</div>}
          {!data && !dataError && (
            <p className="note" style={{ padding: 40, textAlign: 'center' }}>Loading…</p>
          )}
          {data && (
            <MemberDataContext.Provider value={{ ...data, refresh, myEmail: gate.email }}>
              <Outlet />
            </MemberDataContext.Provider>
          )}
        </div>
        <p className="watermark">Atlas Business Society &middot; Service</p>
      </div>
    </div>
  )
}
