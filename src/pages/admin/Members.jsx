import { useMemo, useState } from 'react'
import { useAdminData } from '../../context/AdminDataContext.js'
import RoleTag from '../../components/RoleTag.jsx'
import { downloadCsv } from '../../lib/csv.js'
import { computeMemberStats, groupOf, keyOf, mentorName } from '../../lib/stats.js'

const HEADS = [
  ['name', 'Member', null],
  ['role', 'Role', null],
  ['mentor', 'Mentor', null],
  ['group', 'Group', null],
  ['claims', 'Spots', 'n'],
  ['logsCount', 'Logs', 'n'],
  ['total', 'Hours', 'n'],
  ['swab', 'Book Drive', 'n'],
  ['countable', 'Counting', 'n'],
  ['met', 'Met?', null],
]

export default function Members() {
  const { roster, mentors, orgs, events, signups, logs, settings, officerEmail } = useAdminData()
  const [filters, setFilters] = useState({
    mentor: '',
    group: '',
    partner: '',
    status: '',
    role: 'member', // officers/admins still serve and still count — just hidden from this list by default
    search: '',
  })
  const [sort, setSort] = useState({ key: 'name', dir: 1 })

  const eventsById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events])
  const groups = useMemo(() => {
    const set = new Set()
    mentors.forEach((m) => m.group_name && set.add(m.group_name))
    return [...set]
  }, [mentors])
  const activeOrgs = useMemo(() => orgs.filter((o) => o.active !== false), [orgs])

  const rows = useMemo(() => {
    return roster.map((m) => {
      const stats = computeMemberStats(m.email, { logs, signups, eventsById, settings })
      const partners = new Set()
      logs
        .filter((l) => keyOf(l.member_email) === keyOf(m.email))
        .forEach((l) => {
          const ev = eventsById.get(l.event_id)
          if (ev) partners.add(ev.org_id)
        })
      return {
        member: m,
        stats,
        partners,
        group: groupOf(m.mentor_id, mentors),
        mentor: mentorName(m.mentor_id, mentors),
        role: m.is_admin ? 'Admin' : m.is_officer ? 'Officer' : 'Member',
      }
    })
  }, [roster, logs, signups, eventsById, settings, mentors])

  const filtered = useMemo(() => {
    const q = keyOf(filters.search)
    return rows.filter((r) => {
      if (filters.mentor && String(r.member.mentor_id) !== filters.mentor) return false
      if (filters.group && r.group !== filters.group) return false
      if (filters.partner && !r.partners.has(filters.partner)) return false
      if (filters.role === 'member' && r.member.is_officer) return false
      if (filters.role === 'officer' && !r.member.is_officer) return false
      const f = filters.status
      if (f === 'met' && !r.stats.met) return false
      if (f === 'short' && (r.stats.met || r.stats.total === 0)) return false
      if (f === 'none' && (r.stats.total > 0 || r.stats.claims > 0)) return false
      if (f === 'ghost' && !(r.stats.claims > 0 && r.stats.total === 0)) return false
      if (q && !`${r.member.full_name} ${r.member.email}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filters])

  const sorted = useMemo(() => {
    const { key, dir } = sort
    return [...filtered].sort((x, y) => {
      let a, b
      if (key === 'name') {
        a = x.member.full_name
        b = y.member.full_name
      } else if (key === 'mentor') {
        a = x.mentor
        b = y.mentor
      } else if (key === 'group') {
        a = x.group
        b = y.group
      } else if (key === 'role') {
        a = x.role
        b = y.role
      } else if (key === 'met') {
        a = x.stats.met ? 1 : 0
        b = y.stats.met ? 1 : 0
      } else {
        a = x.stats[key]
        b = y.stats[key]
      }
      if (typeof a === 'number') return (a - b) * dir
      return String(a).localeCompare(String(b)) * dir
    })
  }, [filtered, sort])

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }))
  }

  function exportCsv() {
    const out = [
      ['Member', 'Email', 'Role', 'Mentor', 'Group', 'Spots', 'Logs', 'Hours', 'BookDrive', 'Counting', 'Met'],
    ]
    sorted.forEach((r) =>
      out.push([
        r.member.full_name,
        r.member.email,
        r.role,
        r.mentor,
        r.group,
        r.stats.claims,
        r.stats.logsCount,
        r.stats.total,
        r.stats.swab,
        r.stats.countable,
        r.stats.met ? 'Yes' : 'No',
      ]),
    )
    downloadCsv('atlas-members.csv', out)
  }

  return (
    <>
      <div className="pagehead">
        <h1>Members</h1>
        <p>Filter by mentor, group, partner or standing. Everything here is live.</p>
      </div>

      <section>
        <div className="filters">
          <div>
            <label htmlFor="fMentor">Mentor</label>
            <select id="fMentor" value={filters.mentor} onChange={(e) => setFilter('mentor', e.target.value)}>
              <option value="">All mentors</option>
              {mentors.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fGroup">Group</label>
            <select id="fGroup" value={filters.group} onChange={(e) => setFilter('group', e.target.value)}>
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fPartner">Served with</label>
            <select id="fPartner" value={filters.partner} onChange={(e) => setFilter('partner', e.target.value)}>
              <option value="">All partners</option>
              {activeOrgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fStatus">Standing</label>
            <select id="fStatus" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Everyone</option>
              <option value="met">Requirement met</option>
              <option value="short">Short of requirement</option>
              <option value="none">No activity</option>
              <option value="ghost">Claimed but never logged</option>
            </select>
          </div>
          <div>
            <label htmlFor="fRole">Role</label>
            <select id="fRole" value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
              <option value="">Everyone</option>
              <option value="member">Members only</option>
              <option value="officer">Officers only</option>
            </select>
          </div>
          <div>
            <label htmlFor="fSearch">Search</label>
            <input
              id="fSearch"
              type="search"
              placeholder="Name or email"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
            />
          </div>
        </div>

        <div className="plate">
          <h2></h2>
          <span>
            {sorted.length} of {roster.length} members
          </span>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                {HEADS.map(([key, label, cls]) => (
                  <th
                    key={key}
                    className={[cls, 'sort'].filter(Boolean).join(' ')}
                    onClick={() => toggleSort(key)}
                  >
                    {label}
                    {sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.member.email}>
                  <td>
                    {r.member.full_name}
                    {keyOf(r.member.email) === keyOf(officerEmail) && (
                      <span className="note"> (you)</span>
                    )}
                  </td>
                  <td>
                    <RoleTag role={r.role} />
                  </td>
                  <td>{r.mentor || '—'}</td>
                  <td>{r.group || '—'}</td>
                  <td className="n">{r.stats.claims}</td>
                  <td className="n">{r.stats.logsCount}</td>
                  <td className="n">{r.stats.total}</td>
                  <td className="n">{r.stats.swab}</td>
                  <td className="n">{r.stats.countable}</td>
                  <td className={r.stats.met ? 'yes' : 'no'}>{r.stats.met ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={exportCsv}>
          Export This View as CSV
        </button>
      </section>
    </>
  )
}
