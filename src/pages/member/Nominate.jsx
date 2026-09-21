import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMemberData } from '../../context/MemberDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'

const initial = {
  orgName: '',
  website: '',
  address: '',
  date: '',
  time: '',
  volunteers: '',
  contact: '',
  description: '',
  notes: '',
}

export default function Nominate() {
  const { myEmail, refresh } = useMemberData()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)

  function set(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('nominations').insert({
      member_email: myEmail,
      org_name: form.orgName,
      website: form.website || null,
      address: form.address,
      event_date: form.date,
      event_time: form.time,
      volunteers: form.volunteers === '' ? null : Number(form.volunteers) || 0,
      contact: form.contact,
      description: form.description,
      notes: form.notes || null,
      status: 'pending',
    })
    setBusy(false)
    if (error) {
      toast('Could not submit that nomination. Try again.')
      return
    }
    await refresh()
    toast('Nomination submitted. An officer reviews it before it counts.')
    navigate('/member/opportunities')
  }

  return (
    <>
      <div className="pagehead">
        <h1>Nominate an Organization</h1>
        <p>
          Already volunteering somewhere? Put it forward. An officer reviews it before it counts,
          and you still file a service log afterward.
        </p>
      </div>

      <section>
        <form className="card" onSubmit={handleSubmit}>
          <div className="fields">
            <div>
              <label htmlFor="nmName">Organization</label>
              <input id="nmName" type="text" required value={form.orgName} onChange={set('orgName')} />
            </div>
            <div>
              <label htmlFor="nmSite">
                Website
                <small>Optional</small>
              </label>
              <input id="nmSite" type="url" value={form.website} onChange={set('website')} />
            </div>
            <div className="span2">
              <label htmlFor="nmAddr">Address</label>
              <input id="nmAddr" type="text" required value={form.address} onChange={set('address')} />
            </div>
            <div>
              <label htmlFor="nmDate">Date</label>
              <input id="nmDate" type="date" required value={form.date} onChange={set('date')} />
            </div>
            <div>
              <label htmlFor="nmTime">Time</label>
              <input id="nmTime" type="time" required value={form.time} onChange={set('time')} />
            </div>
            <div>
              <label htmlFor="nmVol">Volunteers needed</label>
              <input id="nmVol" type="number" required value={form.volunteers} onChange={set('volunteers')} />
            </div>
            <div>
              <label htmlFor="nmContact">
                Contact at the organization
                <small>Name plus email or phone</small>
              </label>
              <input id="nmContact" type="text" required value={form.contact} onChange={set('contact')} />
            </div>
            <div className="span2">
              <label htmlFor="nmDesc">What would volunteers do?</label>
              <textarea id="nmDesc" required value={form.description} onChange={set('description')} />
            </div>
            <div className="span2">
              <label htmlFor="nmNotes">
                Anything a coordinator should know?
                <small>Optional</small>
              </label>
              <textarea id="nmNotes" value={form.notes} onChange={set('notes')} />
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={busy}>
              Submit Nomination
            </button>
            <span className="note">You still owe a service log after you serve.</span>
          </div>
        </form>
      </section>
    </>
  )
}
