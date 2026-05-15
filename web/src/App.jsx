import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import Globe from './pages/Globe'
import Country from './pages/Country'
import Markets from './pages/Markets'
import Compare from './pages/Compare'
import Analyst from './pages/Analyst'
import { api } from './api'

function SearchBar() {
  const [query, setQuery] = useState('')
  const [countries, setCountries] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.countries().then(setCountries).catch(() => {})
  }, [])

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.length > 0
    ? countries.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.iso3.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : []

  const TIER_COLORS = { low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444' }

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (query) setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); setQuery('') }
          if (e.key === 'Enter' && filtered.length > 0) {
            navigate(`/country/${filtered[0].iso3}`)
            setQuery('')
            setOpen(false)
          }
        }}
        placeholder="Search countries..."
        className="w-52 text-xs px-3 py-1.5 rounded-lg border bg-transparent text-slate-300 placeholder-slate-600 outline-none focus:border-indigo-500 transition-colors"
        style={{ borderColor: '#2e2e42' }}
      />
      {open && filtered.length > 0 && (
        <div
          className="rounded-lg border shadow-2xl overflow-hidden"
          style={{
            position: 'fixed',
            top: '44px',
            right: '16px',
            width: '260px',
            background: '#12121a',
            borderColor: '#2e2e42',
            zIndex: 9999,
          }}
        >
          {filtered.map(c => (
            <button
              key={c.iso3}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/5 transition-colors border-b last:border-0"
              style={{ borderColor: '#1e1e2e' }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { navigate(`/country/${c.iso3}`); setQuery(''); setOpen(false) }}
            >
              <span className="font-mono text-xs text-slate-500 w-8 shrink-0">{c.iso3}</span>
              <span className="text-sm text-slate-300 flex-1 truncate">{c.name}</span>
              {c.sovereign_risk_score != null && (
                <span className="font-mono text-xs font-bold shrink-0"
                      style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                  {c.sovereign_risk_score.toFixed(0)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AlertBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const load = () => api.alerts()
      .then(a => setCount(a.filter(x => !x.acknowledged).length))
      .catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  if (count === 0) return null
  return (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
      {count > 9 ? '9+' : count}
    </span>
  )
}

function Nav() {
  const base = 'px-4 py-2 text-sm font-medium rounded transition-colors'
  const active = `${base} bg-indigo-600/20 text-indigo-400 border border-indigo-500/30`
  const inactive = `${base} text-slate-400 hover:text-slate-200 hover:bg-white/5`

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center gap-1 px-4 h-12 border-b"
         style={{ background: 'rgba(10,10,15,0.95)', borderColor: '#1e1e2e', backdropFilter: 'blur(12px)' }}>
      <span className="text-sm font-semibold text-indigo-400 tracking-widest mr-4 font-mono">SOVEREIGN</span>
      <div className="relative">
        <NavLink to="/" end className={({ isActive }) => isActive ? active : inactive}>Globe</NavLink>
        <AlertBadge />
      </div>
      <NavLink to="/markets" className={({ isActive }) => isActive ? active : inactive}>Markets</NavLink>
      <NavLink to="/compare" className={({ isActive }) => isActive ? active : inactive}>Compare</NavLink>
      <NavLink to="/analyst" className={({ isActive }) => isActive ? active : inactive}>Analyst</NavLink>
      <div className="ml-auto">
        <SearchBar />
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <div style={{ paddingTop: '48px', minHeight: '100vh' }}>
        <Routes>
          <Route path="/" element={<Globe />} />
          <Route path="/country/:iso3" element={<Country />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/analyst" element={<Analyst />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
