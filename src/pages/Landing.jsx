import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import GlobeMark from '../components/GlobeMark.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

function keyOf(email) {
  return String(email || '').trim().toLowerCase()
}

function Terminal({ role, heading, blurb, note, onSubmit, busy }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="term">
      <h2>{heading}</h2>
      <p>{blurb}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(email, password)
        }}
      >
        <div>
          <label htmlFor={`${role}-email`}>UGA Email</label>
          <input
            id={`${role}-email`}
            type="email"
            autoComplete="username"
            placeholder={role === 'admin' ? 'officer@uga.edu' : 'you@uga.edu'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="fieldgroup">
          <label htmlFor={`${role}-password`}>Password</label>
          <input
            id={`${role}-password`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" type="submit" disabled={busy}>
            Sign In
          </button>
        </div>
      </form>
      <p className="termnote">{note}</p>
    </div>
  )
}

export default function Landing() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function handleSignIn(role, email, password) {
    const k = keyOf(email)
    if (!k || !password) {
      toast('Enter your email and password.')
      return
    }
    setBusy(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: k,
      password,
    })
    if (authError) {
      toast('That email or password is not right.')
      setBusy(false)
      return
    }
    const { data: rosterRow, error: rosterError } = await supabase
      .from('roster')
      .select('full_name, is_officer')
      .eq('email', k)
      .maybeSingle()
    if (rosterError || !rosterRow) {
      await supabase.auth.signOut()
      toast('That email is not on the Fall 2026 roster. Check with an officer.')
      setBusy(false)
      return
    }
    if (role === 'admin' && !rosterRow.is_officer) {
      await supabase.auth.signOut()
      toast('That email is not on the officer list.')
      setBusy(false)
      return
    }
    setBusy(false)
    navigate(role === 'admin' ? '/admin' : '/member/opportunities')
  }

  return (
    <div className="gate">
      <GlobeMark className="gatemark" />
      <h1>Atlas Service</h1>
      <p className="sub">Discover. Ignite. Lead.</p>
      <div className="rule" />

      <div className="termgrid">
        <Terminal
          role="member"
          heading="Member Log In"
          blurb="Browse opportunities, claim a spot, and log your hours."
          note="Use the UGA email on the cohort roster."
          busy={busy}
          onSubmit={(email, password) => handleSignIn('member', email, password)}
        />
        <Terminal
          role="admin"
          heading="Officer Log In"
          blurb="Track the roster, mentor groups, events, and nominations."
          note="Manage officer access under Settings once signed in."
          busy={busy}
          onSubmit={(email, password) => handleSignIn('admin', email, password)}
        />
      </div>

      <p className="gatefoot">
        First time here? <Link to="/setup">Set Up Your Account</Link> using the link from your
        welcome email.
      </p>
    </div>
  )
}
