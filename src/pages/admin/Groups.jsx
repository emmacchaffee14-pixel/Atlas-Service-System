import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import { supabase } from '../../lib/supabaseClient.js'
import { computeMemberStats, round } from '../../lib/stats.js'

export default function Groups() {
  const { roster, mentors, events, signups, logs, settings, refresh } = useAdminData()
  const [savingGroup, setSavingGroup] = useState(null)
  const [savingMentor, setSavingMentor] = useState(null)

  // Officers and admins don't get a mentor, so they're out of the
  // assignment list and the "unassigned" count.
  const mentees = useMemo(() => roster.filter((r) => !r.is_officer), [roster])

  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  const memberStatsByEmail = useMemo(() => {
    const map = new Map()
    roster.forEach((r) => {
      map.set(r.email, computeMemberStats(r.email, { logs, signups, eventsById, settings }))
    })
    return map
  }, [roster, logs, signups, eventsById, settings])

  const mentorRows = useMemo(
    () =>
      mentors.map((m) => {
        const members = mentees.filter((r) => r.mentor_id === m.id)
        let hrs = 0
        let met = 0
        members.forEach((r) => {
          const s = memberStatsByEmail.get(r.email)
          hrs += s.total
          if (s.met) met++
        })
        return { mentor: m, members, hours: round(hrs), met }
      }),
    [mentors, mentees, memberStatsByEmail],
  )

  const unassigned = mentees.filter((r) => !r.mentor_id).length

  async function saveGroupName(mentorId, value) {
    setSavingGroup(mentorId)
    const { error } = await supabase
      .from('mentors')
      .update({ group_name: value.trim() || null })
      .eq('id', mentorId)
    setSavingGroup(null)
    if (!error) await refresh()
  }

  async function saveMemberMentor(email, mentorIdValue) {
    setSavingMentor(email)
    const { error } = await supabase
      .from('roster')
      .update({ mentor_id: mentorIdValue ? Number(mentorIdValue) : null })
      .eq('email', email)
    setSavingMentor(null)
    if (!error) await refresh()
  }

  return (
    <>
      <div className="pagehead">
        <h1>Mentor Groups</h1>
        <p>Name each group, then assign every member to a mentor. Group reporting turns on as soon as you do.</p>
      </div>

      <section>
        <div className="plate">
          <h2>Groups</h2>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Mentor</th>
                <th>Group Name</th>
                <th className="n">Members</th>
                <th className="n">Hours</th>
                <th className="n">Avg Per Member</th>
                <th className="n">Meeting Requirement</th>
              </tr>
            </thead>
            <tbody>
              {mentorRows.map(({ mentor, members, hours, met }) => (
                <tr key={mentor.id}>
                  <td>{mentor.name}</td>
                  <td>
                    <input
                      key={mentor.group_name || ''}
                      defaultValue={mentor.group_name || ''}
                      placeholder="e.g. Group 4"
                      disabled={savingGroup === mentor.id}
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (mentor.group_name || '')) {
                          saveGroupName(mentor.id, e.target.value)
                        }
                      }}
                    />
                  </td>
                  <td className="n">{members.length}</td>
                  <td className="n">{hours}</td>
                  <td className="n">{members.length ? round(hours / members.length) : 0}</td>
                  <td className="n">{members.length ? `${met} of ${members.length}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="plate">
          <h2>Assign Members</h2>
          <span>{unassigned ? `${unassigned} still unassigned` : 'All assigned'}</span>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>UGA Email</th>
                <th>Mentor</th>
              </tr>
            </thead>
            <tbody>
              {mentees.map((r) => (
                <tr key={r.email}>
                  <td>{r.full_name}</td>
                  <td>{r.email}</td>
                  <td>
                    <select
                      value={r.mentor_id || ''}
                      disabled={savingMentor === r.email}
                      onChange={(e) => saveMemberMentor(r.email, e.target.value)}
                    >
                      <option value="">{'—'} unassigned {'—'}</option>
                      {mentors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
