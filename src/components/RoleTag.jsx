// Plain "Admin"/"Officer" text reads the same as "Member" at a glance,
// especially with a dozen mentors also carrying is_officer — give the
// elevated roles a real badge so they stand out in a long roster.
export default function RoleTag({ role }) {
  if (role === 'Admin') return <span className="tag ok">Admin</span>
  if (role === 'Officer') return <span className="tag">Officer</span>
  return <span className="note">Member</span>
}
