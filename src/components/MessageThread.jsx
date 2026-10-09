import { useEffect, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

function stamp(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// One member's conversation with the officers. `viewer` is 'member' or
// 'officer' — it decides which messages are "mine," which side's unread
// messages get marked read on open, and who the sender is on send.
export default function MessageThread({ memberEmail, viewer, senderEmail, messages, otherLabel, refresh }) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  const unread = messages.filter((m) => m.sender !== viewer && !m.read_at).length

  useEffect(() => {
    if (!unread) return
    supabase
      .rpc('mark_thread_read', { p_member_email: memberEmail })
      .then(({ error }) => {
        if (!error) refresh()
      })
  }, [unread, memberEmail, refresh])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, memberEmail])

  async function send(e) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    const { error } = await supabase.from('messages').insert({
      member_email: memberEmail,
      sender: viewer,
      sender_email: senderEmail,
      body,
    })
    setBusy(false)
    if (error) {
      toast('Could not send that message.')
      return
    }
    setDraft('')
    await refresh()
    toast('Message sent.')
  }

  return (
    <div className="thread">
      <div className="thread-log">
        {messages.length === 0 ? (
          <p className="empty">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg ${m.sender === viewer ? 'mine' : 'theirs'}`}>
              <small>
                {m.sender === viewer ? 'You' : otherLabel} · {stamp(m.created_at)}
              </small>
              <p>{m.body}</p>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send}>
        <textarea
          rows="3"
          maxLength="4000"
          value={draft}
          placeholder="Write a message…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="formfoot">
          <button className="btn" type="submit" disabled={busy || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
      <p className="note">The other person gets an email letting them know. Messages are deleted after 90 days.</p>
    </div>
  )
}
