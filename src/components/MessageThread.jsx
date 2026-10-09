import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

function dayKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(iso) === dayKey(now)) return 'Today'
  if (dayKey(iso) === dayKey(yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// One member's conversation with the officers, laid out like a text thread:
// bubbles, a date divider per day, composer pinned underneath. `viewer` is
// 'member' or 'officer' — it decides which bubbles are "mine," which side's
// unread messages get marked read on open, and who the sender is on send.
export default function MessageThread({ memberEmail, viewer, senderEmail, messages, otherLabel, refresh }) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef(null)

  const unread = messages.filter((m) => m.sender !== viewer && !m.read_at).length

  useEffect(() => {
    if (!unread) return
    supabase.rpc('mark_thread_read', { p_member_email: memberEmail }).then(({ error }) => {
      if (!error) refresh()
    })
  }, [unread, memberEmail, refresh])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, memberEmail])

  // Consecutive messages from one side within a few minutes stack tight;
  // a new day starts with a divider.
  const items = useMemo(() => {
    const out = []
    let prev = null
    messages.forEach((m) => {
      const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at)
      if (newDay) out.push({ divider: dayLabel(m.created_at), key: `d-${m.id}` })
      const stacked =
        !newDay && prev.sender === m.sender && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000
      out.push({ m, stacked, key: m.id })
      prev = m
    })
    return out
  }, [messages])

  async function send(e) {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
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
  }

  return (
    <div className="thread">
      <div className="thread-log" ref={logRef}>
        {items.length === 0 ? (
          <p className="empty">No messages yet. Say hello below.</p>
        ) : (
          items.map((it) =>
            it.divider ? (
              <div className="msg-day" key={it.key}>
                <span>{it.divider}</span>
              </div>
            ) : (
              <div
                key={it.key}
                className={`bubble ${it.m.sender === viewer ? 'mine' : 'theirs'}${it.stacked ? ' stacked' : ''}`}
              >
                {!it.stacked && it.m.sender !== viewer && <small className="who">{otherLabel}</small>}
                <p>{it.m.body}</p>
                <time>{clock(it.m.created_at)}</time>
              </div>
            ),
          )
        )}
      </div>
      <form className="composer" onSubmit={send}>
        <textarea
          rows="1"
          maxLength="4000"
          value={draft}
          placeholder="Write a message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e)
          }}
        />
        <button className="btn" type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
      <p className="note">Enter to send · they get an email nudge · messages are deleted after 90 days.</p>
    </div>
  )
}
