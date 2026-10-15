import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import MessageThread from '../../components/MessageThread.jsx'
import { keyOf } from '../../lib/stats.js'

function listStamp(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Messages() {
  const { roster, messages, officerEmail, refresh } = useAdminData()
  const [selected, setSelected] = useState('')
  const [order, setOrder] = useState('recent')
  const [search, setSearch] = useState('')

  const threads = useMemo(() => {
    const by = new Map()
    messages.forEach((m) => {
      const k = keyOf(m.member_email)
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(m)
    })
    const nameOf = new Map(roster.map((r) => [keyOf(r.email), r.full_name]))
    return [...by.entries()].map(([email, list]) => {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at))
      return {
        email,
        name: nameOf.get(email) || email,
        list,
        last: list[list.length - 1],
        unread: list.filter((m) => m.sender === 'member' && !m.read_at).length,
      }
    })
  }, [messages, roster])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = threads.filter((t) => !q || t.name.toLowerCase().includes(q))
    return list.sort((a, b) =>
      order === 'name' ? a.name.localeCompare(b.name) : b.last.created_at.localeCompare(a.last.created_at),
    )
  }, [threads, order, search])

  const open = selected ? threads.find((t) => t.email === selected) : null
  const openName = open?.name || roster.find((r) => keyOf(r.email) === selected)?.full_name || selected
  const totalUnread = threads.reduce((n, t) => n + t.unread, 0)

  return (
    <>
      <div className="pagehead">
        <h1>Messages</h1>
        <p>One-on-one notes with members. Each person is emailed when you write or reply.</p>
      </div>

      <div className={'inbox' + (selected ? ' has-open' : '')}>
        <aside className="inbox-list">
          <div className="inbox-tools">
            <select
              aria-label="Start a new message"
              value=""
              onChange={(e) => e.target.value && setSelected(e.target.value)}
            >
              <option value="">+ New message…</option>
              {roster.map((r) => (
                <option key={r.email} value={keyOf(r.email)}>
                  {r.full_name}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="inbox-sort">
              <button type="button" className={order === 'recent' ? 'on' : ''} onClick={() => setOrder('recent')}>
                Recent
              </button>
              <button type="button" className={order === 'name' ? 'on' : ''} onClick={() => setOrder('name')}>
                A–Z
              </button>
              <span>{totalUnread ? `${totalUnread} unread` : 'All read'}</span>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="empty">{threads.length ? 'No matches.' : 'No conversations yet.'}</p>
          ) : (
            <ul>
              {shown.map((t) => (
                <li key={t.email}>
                  <button
                    type="button"
                    className={'convo' + (t.email === selected ? ' on' : '') + (t.unread ? ' unread' : '')}
                    onClick={() => setSelected(t.email)}
                  >
                    <span className="convo-top">
                      <b>{t.name}</b>
                      <time>{listStamp(t.last.created_at)}</time>
                    </span>
                    <span className="convo-bot">
                      <span className="convo-prev">
                        {t.last.sender === 'officer' ? 'You: ' : ''}
                        {t.last.body}
                      </span>
                      {t.unread > 0 && <i className="dotcount">{t.unread}</i>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="inbox-pane">
          {selected ? (
            <>
              <div className="inbox-head">
                <button type="button" className="btn ghost sm inbox-back" onClick={() => setSelected('')}>
                  ‹ Back
                </button>
                <div>
                  <b>{openName}</b>
                  <small>{selected}</small>
                </div>
              </div>
              <MessageThread
                key={selected}
                memberEmail={selected}
                viewer="officer"
                senderEmail={officerEmail}
                messages={open?.list || []}
                otherLabel={openName}
                refresh={refresh}
              />
            </>
          ) : (
            <p className="empty">Pick a conversation, or start a new message.</p>
          )}
        </section>
      </div>
    </>
  )
}
