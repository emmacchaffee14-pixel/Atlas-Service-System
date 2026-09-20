export default function GlobeMark({ className }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="21.85" strokeWidth="4.3" />
      <ellipse cx="24" cy="24" rx="10.7" ry="21.85" strokeWidth="2.6" />
      <line x1="24" y1="2.15" x2="24" y2="45.85" strokeWidth="2.4" />
      <path d="M5.3 17.9h37.4M5.3 30.1h37.4" strokeWidth="2.7" />
    </svg>
  )
}
