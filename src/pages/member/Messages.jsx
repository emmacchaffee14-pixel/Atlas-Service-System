import { useMemo } from 'react'
import { useMemberData } from '../../context/MemberDataContext.js'
import MessageThread from '../../components/MessageThread.jsx'
import { keyOf } from '../../lib/stats.js'

export default function Messages() {
  const { messages, myEmail, refresh } = useMemberData()
  const mine = useMemo(
    () =>
      messages
        .filter((m) => keyOf(m.member_email) === keyOf(myEmail))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages, myEmail],
  )

  return (
    <>
      <div className="pagehead">
        <h1>Messages</h1>
        <p>A direct line to the service team. Ask a question or reply to a note here.</p>
      </div>
      <section>
        <MessageThread
          memberEmail={myEmail}
          viewer="member"
          senderEmail={myEmail}
          messages={mine}
          otherLabel="Service Team"
          refresh={refresh}
        />
      </section>
    </>
  )
}
