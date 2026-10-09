import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import MessageThread from '../../components/MessageThread.jsx'
import { keyOf } from '../../lib/stats.js'

function shortStamp(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Messages() {
  const { roster, messages, officerEmail, refresh } = useAdminData()
  const [selected, setSelected] = useState('')

  const threads = useMemo(() => {
    const by = new Map()
    messages.forEach((m) => {
      const k = keyOf(m.member_email)
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(m)
    })
    const nameOf = new Map(roster.map((r) => [keyOf(r.email), r.full_name]))
    return [...by.entries()]
      .map(([email, list]) => {
        list.sort((a, b) => a.created_at.localeCompare(b.created_at))
        return {
          email,
          name: nameOf.get(email) || email,
          list,
          last: list[list.length - 1],
          unread: list.filter((m) => m.sender === 'member' && !m.read_at).length,
        }
      })
      .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))
  }, [messages, roster])

  const open = selected ? threads.find((t) => t.email === selected) : null
  const openName = open?.name || roster.find((r) => keyOf(r.email) === selected)?.full_name || selected

  return (
    <>
      <div className="pagehead">
        <h1>Messages</h1>
        <p>One-on-one notes with members. Each person is emailed when you write or reply.</p>
      </div>

      <section>
        <div className="plate">
          <h2>Conversations</h2>
          <span>{threads.reduce((n, t) => n + t.unread, 0)} unread</span>
        </div>
        <div className="fields" style={{ marginBottom: 12 }}>
          <div>
            <label htmlFor="msgTo">Message a member</label>
            <select id="msgTo" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Choose a member…</option>
              {roster.map((r) => (
                <option key={r.email} value={keyOf(r.email)}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {threads.length === 0 ? (
          <p className="empty">No conversations yet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Last Message</th>
                  <th>When</th>
                  <th className="n">Unread</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => (
                  <tr
                    key={t.email}
                    className={t.unread ? 'unread' : undefined}
                    style={{ cursor: 'pointer', fontWeight: t.unread ? 700 : undefined }}
                    onClick={() => setSelected(t.email)}
                  >
                    <td>{t.name}</td>
                    <td className="wrapok">
                      {t.last.sender === 'officer' ? 'You: ' : ''}
                      {t.last.body.length > 80 ? `${t.last.body.slice(0, 80)}…` : t.last.body}
                    </td>
                    <td>{shortStamp(t.last.created_at)}</td>
                    <td className="n">{t.unread || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section>
          <div className="plate">
            <h2>{openName}</h2>
            <span>{selected}</span>
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
        </section>
      )}
    </>
  )
}
