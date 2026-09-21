import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMemberData } from '../../context/MemberDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import FileField from '../../components/FileField.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { fmtDate } from '../../lib/format.js'
import { isAdos, keyOf, swabCap } from '../../lib/stats.js'
import { PROOF_ACCEPT, uploadProof, validateProofFile } from '../../lib/proofUpload.js'

export default function LogService() {
  const { orgs, events, signups, settings, myEmail, refresh } = useMemberData()
  const toast = useToast()
  const navigate = useNavigate()

  const orgsById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const sortedEvents = useMemo(() => {
    const myKey = keyOf(myEmail)
    return [...events].sort((x, y) => {
      const xSigned = signups.some((s) => s.event_id === x.id && keyOf(s.member_email) === myKey) ? 0 : 1
      const ySigned = signups.some((s) => s.event_id === y.id && keyOf(s.member_email) === myKey) ? 0 : 1
      return xSigned - ySigned || (x.event_date || '').localeCompare(y.event_date || '')
    })
  }, [events, signups, myEmail])

  const [eventId, setEventId] = useState('')
  const [hours, setHours] = useState('')
  const [quantity, setQuantity] = useState('')
  const [proofFile, setProofFile] = useState(null)
  const [takeaway, setTakeaway] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedEvent = events.find((e) => e.id === eventId)
  const selectedOrg = selectedEvent ? orgsById.get(selectedEvent.org_id) : null
  const quantityLabel = selectedOrg?.impact_metric
    ? `How many ${selectedOrg.impact_metric.toLowerCase()}?`
    : 'How many?'
  const swabHint =
    selectedEvent && isAdos(selectedEvent)
      ? `At most ${swabCap(settings)} hour from the book drive counts toward your requirement.`
      : ''

  async function handleSubmit(e) {
    e.preventDefault()
    if (!eventId) {
      toast('Pick the event you served at.')
      return
    }
    if (proofFile) {
      const problem = validateProofFile(proofFile)
      if (problem) {
        toast(problem)
        return
      }
    }
    setBusy(true)
    let proofPath = null
    if (proofFile) {
      try {
        proofPath = await uploadProof(supabase, myEmail, proofFile)
      } catch {
        setBusy(false)
        toast('Could not upload that file. Try again.')
        return
      }
    }
    const { error } = await supabase.from('service_logs').insert({
      event_id: eventId,
      member_email: myEmail,
      hours: Number(hours) || 0,
      quantity: quantity === '' ? null : Number(quantity) || 0,
      proof_path: proofPath,
      takeaway: takeaway || null,
    })
    setBusy(false)
    if (error) {
      toast('Could not file that log. Try again.')
      return
    }
    await refresh()
    toast('Service log filed. Your hours are counted.')
    navigate('/member/standing')
  }

  return (
    <>
      <div className="pagehead">
        <h1>Log Your Service</h1>
        <p>
          File this after you serve. It is the only thing that credits your hours, and every
          cohort impact number is built from it.
        </p>
      </div>

      <section>
        <form className="card" onSubmit={handleSubmit}>
          <div className="fields">
            <div className="span2">
              <label htmlFor="lgEvent">Event you served at</label>
              <select id="lgEvent" value={eventId} onChange={(e) => setEventId(e.target.value)} required>
                <option value="">Choose an event</option>
                {sortedEvents.map((ev) => {
                  const org = orgsById.get(ev.org_id)
                  const signed = signups.some(
                    (s) => s.event_id === ev.id && keyOf(s.member_email) === keyOf(myEmail),
                  )
                  return (
                    <option key={ev.id} value={ev.id}>
                      {(org?.name || ev.org_id) + ' — ' + fmtDate(ev.event_date)}
                      {signed ? '  ✓ you signed up' : ''}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label htmlFor="lgHours">Hours served</label>
              <select id="lgHours" value={hours} onChange={(e) => setHours(e.target.value)} required>
                <option value="">Hours</option>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lgQty">
                {quantityLabel}
                <small>Report the group total if you worked as a group.</small>
              </label>
              <input
                id="lgQty"
                type="number"
                min="0"
                step="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="span2">
              <label htmlFor="lgProof">
                Upload your proof photo
                <small>JPG, PNG, HEIC, or PDF. Kept private — only you and officers can see it.</small>
              </label>
              <FileField id="lgProof" accept={PROOF_ACCEPT} file={proofFile} onChange={setProofFile} />
            </div>
            <div className="span2">
              <label htmlFor="lgTake">
                What did you take away?
                <small>Optional, but the best of these run in the year-end impact report.</small>
              </label>
              <textarea id="lgTake" value={takeaway} onChange={(e) => setTakeaway(e.target.value)} />
            </div>
          </div>
          <div className="formfoot">
            <button className="btn" type="submit" disabled={busy}>
              File service log
            </button>
            <span className="note">{swabHint}</span>
          </div>
        </form>
      </section>
    </>
  )
}
