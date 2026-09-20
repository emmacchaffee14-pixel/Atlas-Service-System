import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import GlobeMark from '../components/GlobeMark.jsx'
import Toast from '../components/Toast.jsx'
import { useToast } from '../hooks/useToast.js'
import { supabase } from '../lib/supabaseClient.js'

export default function AccountSetup() {
  const [message, toast] = useToast()
  const [session, setSession] = useState(undefined) // undefined = still checking
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 8) {
      toast('Pick a password of at least 8 characters.')
      return
    }
    if (password !== password2) {
      toast('Those two passwords do not match.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      toast('Could not set that password. Try again.')
      return
    }
    setDone(true)
    toast('Password set. You are signed in.')
  }

  return (
    <div className="gate">
      <GlobeMark className="gatemark" />
      <h1>Set Up Your Account</h1>
      <p className="sub">Discover. Ignite. Lead.</p>
      <div className="rule" />

      <div className="term setupcard" style={{ marginTop: 34 }}>
        {session === undefined && <p className="note">Checking your invitation…</p>}

        {session === null && (
          <>
            <p>
              This page opens from the one-time link in your welcome email. If you have not
              received one yet, ask an officer to invite you.
            </p>
            <div className="row" style={{ marginTop: 18 }}>
              <Link className="btn ghost" to="/">
                Back to Log In
              </Link>
            </div>
          </>
        )}

        {session && !done && (
          <>
            <p>
              Signed in as <strong>{session.user.email}</strong>. Choose a password only you
              know.
            </p>
            <form onSubmit={handleSubmit}>
              <div>
                <label htmlFor="su-pw1">Choose a Password</label>
                <input
                  id="su-pw1"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="fieldgroup">
                <label htmlFor="su-pw2">Confirm Password</label>
                <input
                  id="su-pw2"
                  type="password"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </div>
              <div className="row" style={{ marginTop: 20 }}>
                <button className="btn" type="submit" disabled={busy}>
                  Create Account
                </button>
                <Link className="btn ghost" to="/">
                  Back to Log In
                </Link>
              </div>
            </form>
            <p className="termnote">
              At least 8 characters. Your password is never emailed to you.
            </p>
          </>
        )}

        {session && done && (
          <>
            <div className="flag ok">Your account is ready.</div>
            <p className="note">
              You are signed in as {session.user.email}. Officer and member pages are on their
              way.
            </p>
          </>
        )}
      </div>

      <Toast message={message} />
    </div>
  )
}
