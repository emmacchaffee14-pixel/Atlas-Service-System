import { useMemo, useState } from 'react'
import { keyOf } from '../lib/stats.js'

// Pick members to put on an event. `selected` is an array of emails;
// `already` is emails already on the event (shown checked and locked).
export default function AssignMembers({ roster, mentors, selected, onChange, already = [] }) {
  const [search, setSearch] = useState('')
  const on = useMemo(() => new Set(already.map(keyOf)), [already])
  const picked = useMemo(() => new Set(selected.map(keyOf)), [selected])

  const mentees = useMemo(
    () => roster.filter((r) => !r.is_officer).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [roster],
  )
  const q = search.trim().toLowerCase()
  const shown = mentees.filter((r) => !q || r.full_name.toLowerCase().includes(q))

  function toggle(email) {
    const k = keyOf(email)
    onChange(picked.has(k) ? selected.filter((e) => keyOf(e) !== k) : [...selected, k])
  }
  function addGroup(mentorId) {
    const emails = mentees
      .filter((r) => r.mentor_id === mentorId && !on.has(keyOf(r.email)))
      .map((r) => keyOf(r.email))
    onChange([...new Set([...selected.map(keyOf), ...emails])])
  }

  return (
    <div className="assign">
      <div className="assign-tools">
        <input
          type="search"
          placeholder="Search members"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value=""
          aria-label="Add a mentor group"
          onChange={(e) => e.target.value && addGroup(Number(e.target.value))}
        >
          <option value="">+ Add a mentor group…</option>
          {mentors.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.group_name ? ` — ${m.group_name}` : ''}
            </option>
          ))}
        </select>
        <span className="assign-count">
          {selected.length} selected
          {selected.length > 0 && (
            <button type="button" className="linkbtn small inline" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </span>
      </div>
      <ul className="assign-list">
        {shown.map((r) => {
          const locked = on.has(keyOf(r.email))
          return (
            <li key={r.email}>
              <label>
                <input
                  type="checkbox"
                  checked={locked || picked.has(keyOf(r.email))}
                  disabled={locked}
                  onChange={() => toggle(r.email)}
                />
                <span>{r.full_name}</span>
                {locked && <small>already on</small>}
              </label>
            </li>
          )
        })}
        {shown.length === 0 && <li className="empty">No matches.</li>}
      </ul>
    </div>
  )
}
