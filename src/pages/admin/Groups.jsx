import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAdminData } from '../../context/AdminDataContext.js'
import { useToast } from '../../context/ToastContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { computeMemberStats, keyOf, round } from '../../lib/stats.js'
import Members from './Members.jsx'

// One page for mentor groups and the people in them: the Groups tab is the
// default view (a block per mentor, filterable); the Members tab is the full
// searchable roster where mentors are assigned.
export default function Groups() {
  const { roster, mentors, events, signups, logs, settings, refresh } = useAdminData()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'members' ? 'members' : 'groups'
  const setTab = (t) => setParams(t === 'groups' ? {} : { tab: t }, { replace: true })
  const [mentorFilter, setMentorFilter] = useState('')
  const [savingGroup, setSavingGroup] = useState(null)
  const [savingMentor, setSavingMentor] = useState(null)

  // Officers and admins don't get a mentor, so they're left out here.
  const mentees = useMemo(() => roster.filter((r) => !r.is_officer), [roster])
  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])

  const statsByEmail = useMemo(() => {
    const map = new Map()
    mentees.forEach((r) => map.set(r.email, computeMemberStats(r.email, { logs, signups, eventsById, settings })))
    return map
  }, [mentees, logs, signups, eventsById, settings])

  const blocks = useMemo(() => {
    const make = (mentor) => {
      const members = mentees
        .filter((r) => (mentor ? r.mentor_id === mentor.id : !r.mentor_id))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
      const hours = members.reduce((t, r) => t + statsByEmail.get(r.email).total, 0)
      const met = members.filter((r) => statsByEmail.get(r.email).met).length
      return { mentor, members, hours: round(hours), met }
    }
    const list = mentors.map(make).sort((a, b) => a.mentor.name.localeCompare(b.mentor.name))
    const none = make(null)
    return none.members.length ? [...list, none] : list
  }, [mentors, mentees, statsByEmail])

  const shown = blocks.filter(
    (b) => !mentorFilter || (mentorFilter === 'none' ? !b.mentor : String(b.mentor?.id) === mentorFilter),
  )
  const unassigned = mentees.filter((r) => !r.mentor_id).length

  async function saveGroupName(mentorId, value) {
    setSavingGroup(mentorId)
    const { error } = await supabase.from('mentors').update({ group_name: value.trim() || null }).eq('id', mentorId)
    setSavingGroup(null)
    if (error) {
      toast('Could not save that name.')
      return
    }
    await refresh()
  }

  async function saveMemberMentor(email, value) {
    setSavingMentor(email)
    const { error } = await supabase
      .from('roster')
      .update({ mentor_id: value ? Number(value) : null })
      .eq('email', email)
    setSavingMentor(null)
    if (error) {
      toast('Could not change that mentor.')
      return
    }
    await refresh()
  }

  return (
    <>
      <div className="pagehead">
        <h1>Groups</h1>
        <p>Mentor groups and the members in them.</p>
      </div>

      <div className="tabs" role="tablist">
        <button type="button" className={'tab' + (tab === 'groups' ? ' on' : '')} onClick={() => setTab('groups')}>
          Groups
          {unassigned > 0 && <i className="tabcount hot">{unassigned} unassigned</i>}
        </button>
        <button type="button" className={'tab' + (tab === 'members' ? ' on' : '')} onClick={() => setTab('members')}>
          Members
        </button>
      </div>

      {tab === 'groups' && (
        <section style={{ marginTop: 24 }}>
          <div className="filters">
            <div>
              <label htmlFor="gMentor">Mentor</label>
              <select id="gMentor" value={mentorFilter} onChange={(e) => setMentorFilter(e.target.value)}>
                <option value="">All mentors</option>
                {mentors.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.name}
                  </option>
                ))}
                {unassigned > 0 && <option value="none">No mentor assigned</option>}
              </select>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="empty">Nothing matches.</p>
          ) : (
            shown.map(({ mentor, members, hours, met }) => (
              <div className="grp" key={mentor?.id ?? 'none'}>
                <div className="grp-head">
                  <div>
                    <h3>{mentor ? mentor.name : 'No Mentor Assigned'}</h3>
                    {mentor && (
                      <input
                        key={mentor.group_name || ''}
                        className="grp-name"
                        defaultValue={mentor.group_name || ''}
                        placeholder="Name this group (e.g. Group 4)"
                        disabled={savingGroup === mentor.id}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== (mentor.group_name || '')) saveGroupName(mentor.id, e.target.value)
                        }}
                      />
                    )}
                  </div>
                  <div className="grp-stats">
                    <span>
                      <b>{members.length}</b> member{members.length === 1 ? '' : 's'}
                    </span>
                    <span>
                      <b>{members.length ? `${met}/${members.length}` : '—'}</b> met
                    </span>
                    <span>
                      <b>{members.length ? round(hours / members.length) : 0}</b> avg hrs
                    </span>
                  </div>
                </div>
                {members.length === 0 ? (
                  <p className="empty">No members yet. Assign some from the Members tab.</p>
                ) : (
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th className="n">Spots</th>
                          <th className="n">Hours</th>
                          <th className="n">Counting</th>
                          <th>Met?</th>
                          {!mentor && <th>Assign</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((r) => {
                          const st = statsByEmail.get(r.email)
                          return (
                            <tr key={r.email}>
                              <td>{r.full_name}</td>
                              <td className="n">{st.claims}</td>
                              <td className="n">{st.total}</td>
                              <td className="n">{st.countable}</td>
                              <td className={st.met ? 'yes' : 'no'}>{st.met ? 'Yes' : 'No'}</td>
                              {!mentor && (
                                <td>
                                  <select
                                    value=""
                                    disabled={savingMentor === r.email}
                                    onChange={(e) => saveMemberMentor(r.email, e.target.value)}
                                  >
                                    <option value="">Choose a mentor…</option>
                                    {mentors.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {tab === 'members' && <Members />}
    </>
  )
}
