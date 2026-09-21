import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMemberData } from '../../context/MemberDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate, fmtTimeRange } from '../../lib/format.js'

const CLAIM_ERRORS = {
  full: 'That was the last spot — this event just filled up.',
  already_claimed: 'You are already on this list.',
  not_signed_in: 'Your session expired. Sign in again and try once more.',
  no_such_event: 'That event is no longer listed.',
}

export default function Signup() {
  const { eventId } = useParams()
  const { orgs, events, signups, mentors, me, myEmail, refresh } = useMemberData()
  const toast = useToast()
  const navigate = useNavigate()

  const ev = events.find((e) => e.id === eventId)
  const org = useMemo(() => orgs.find((o) => o.id === ev?.org_id), [orgs, ev])
  const claims = useMemo(() => signups.filter((s) => s.event_id === eventId), [signups, eventId])
  const capacity = Number(ev?.capacity) || 0

  const [mentorId, setMentorId] = useState(me?.mentor_id ? String(me.mentor_id) : '')
  const [transportation, setTransportation] = useState('No')
  const [advocating, setAdvocating] = useState('no')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  if (!ev) {
    return (
      <div className="pagehead">
        <h1>Event not found</h1>
        <p>That event is no longer listed.</p>
      </div>
    )
  }

  if (capacity && claims.length >= capacity) {
    return (
      <>
        <div className="pagehead">
          <h1>Sign up: {org?.name || ev.org_id} — {fmtDate(ev.event_date)}</h1>
        </div>
        <section>
          <div className="flag">This event filled up while you were deciding.</div>
        </section>
      </>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!mentorId) {
      toast('Choose your mentor so your group gets credit.')
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('claim_slot', {
      p_event_id: eventId,
      p_mentor_id: Number(mentorId),
      p_transportation: transportation === 'Yes',
      p_advocating: advocating === 'yes',
      p_notes: notes || null,
    })
    setBusy(false)
    if (error) {
      toast('Could not claim that spot. Try again.')
      return
    }
    if (!data?.ok) {
      toast(CLAIM_ERRORS[data?.reason] || 'Could not claim that spot. Try again.')
      if (data?.reason === 'full' || data?.reason === 'already_claimed') {
        navigate('/member/opportunities')
      }
      return
    }
    await refresh()
    toast('Spot claimed. File a service log after you go.')
    navigate('/member/opportunities')
  }

  return (
    <>
      <div className="pagehead">
        <h1>
          Sign up: {org?.name || ev.org_id} — {fmtDate(ev.event_date)}
        </h1>
        {org?.location && <p>{fmtTimeRange(ev.start_time, ev.end_time)} · {org.location}</p>}
      </div>

      {org?.directions && (
        <div className="flag" style={{ whiteSpace: 'pre-line', marginTop: 16 }}>
          {org.directions}
        </div>
      )}

      <section>
        <form className="card" onSubmit={handleSubmit}>
          <div className="fields">
            <div>
              <label htmlFor="suName">Your name</label>
              <input id="suName" type="text" value={me?.full_name || ''} readOnly style={{ color: 'var(--soft)' }} />
            </div>
            <div>
              <label htmlFor="suEmail">UGA email</label>
              <input id="suEmail" type="email" value={myEmail} readOnly style={{ color: 'var(--soft)' }} />
            </div>
            <div>
              <label htmlFor="suMentor">Your mentor</label>
              <select id="suMentor" value={mentorId} onChange={(e) => setMentorId(e.target.value)} required>
                <option value="">Choose your mentor</option>
                {mentors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.group_name ? ` — ${m.group_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="suTrans">Do you need transportation?</label>
              <div className="radios inline" id="suTrans">
                {['Yes', 'No'].map((v) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="suTrans"
                      value={v}
                      checked={transportation === v}
                      onChange={() => setTransportation(v)}
                    />
                    {v}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="fields one" style={{ marginTop: 15 }}>
            <div>
              <label>Are you advocating for another organization?</label>
              <div className="radios">
                <label>
                  <input
                    type="radio"
                    name="suAdv"
                    value="no"
                    checked={advocating === 'no'}
                    onChange={() => setAdvocating('no')}
                  />
                  I am not advocating.
                </label>
                <label>
                  <input
                    type="radio"
                    name="suAdv"
                    value="yes"
                    checked={advocating === 'yes'}
                    onChange={() => setAdvocating('yes')}
                  />
                  I am going to fill out the nomination form and sign up again if it is approved.
                </label>
              </div>
            </div>
            <div className="span2">
              <label htmlFor="suNotes">
                Anything the coordinator should know?
                <small>Optional — allergies, arriving late, leaving early.</small>
              </label>
              <textarea id="suNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="formfoot">
            <button className="btn" type="submit" disabled={busy}>
              Claim my spot
            </button>
            <Link className="btn ghost" to="/member/opportunities">
              Cancel
            </Link>
            <span className="note">Do not give up a spot within 48 hours of the event.</span>
          </div>
        </form>
      </section>
    </>
  )
}
