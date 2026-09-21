import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import GlobeMark from './GlobeMark.jsx'

const COLLAPSE_KEY = 'atlas-nav-collapsed'

// Shared left nav for both the officer and member areas. Collapse state is
// a per-device UI preference, not app data, so it's fine to keep it in
// localStorage rather than anything server-side.
export default function Sidebar({ brandTo, navItems, roleLabel, name, extraLink, onSignOut }) {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      // Per-device convenience only — fine if it doesn't persist.
    }
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const brand = (
    <Link className="mark" to={brandTo} aria-label="Atlas Service, home">
      <GlobeMark className="globe" />
      <span>
        Atlas <em>Service</em>
      </span>
    </Link>
  )

  return (
    <>
      <div className="topbar">
        <button className="hamburger" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <span />
          <span />
          <span />
        </button>
        {brand}
      </div>

      {mobileOpen && <div className="side-backdrop" onClick={() => setMobileOpen(false)} />}

      <aside
        className={['side', collapsed ? 'collapsed' : '', mobileOpen ? 'mobile-open' : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className="side-head">
          {brand}
          <button
            className="side-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '›' : '‹'}
          </button>
          <button className="side-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
            &times;
          </button>
        </div>
        <nav className="side-nav">
          {navItems.map(([path, label]) => (
            <Link key={path} to={path} className={location.pathname === path ? 'on' : ''}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-id">
            {roleLabel && <span className="side-role">{roleLabel}</span>}
            <b>{name}</b>
          </div>
          <div className="side-actions">
            {extraLink && (
              <Link
                className={'btn ghost sm' + (location.pathname === extraLink.to ? ' on' : '')}
                to={extraLink.to}
              >
                {extraLink.label}
              </Link>
            )}
            <button className="btn ghost sm" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
