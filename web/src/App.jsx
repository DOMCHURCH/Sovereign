import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
const Globe = lazy(() => import('./pages/Globe'))
const Country = lazy(() => import('./pages/Country'))
const Markets = lazy(() => import('./pages/Markets'))
const Compare = lazy(() => import('./pages/Compare'))
const Analyst = lazy(() => import('./pages/Analyst'))
const Scenario = lazy(() => import('./pages/Scenario'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
import { api, streamAnalyst } from './api'

const TIER_COLORS = { low: '#4ade80', elevated: '#fbbf24', high: '#fb923c', severe: '#f87171' }

function DataFreshness() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    const load = () => api.ingestStatus().then(setStatus).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  if (!status) return null
  const lastRan = status.last_ran ? new Date(status.last_ran) : null
  const diffMin = lastRan ? Math.floor((Date.now() - lastRan.getTime()) / 60000) : null
  const label = diffMin === null ? 'LIVE' : diffMin < 2 ? 'LIVE' : diffMin < 60 ? `${diffMin}m ago` : `${Math.floor(diffMin/60)}h ago`
  const isLive = diffMin === null || diffMin < 5
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md"
         style={{ background: isLive ? 'rgba(74,222,128,0.08)' : 'rgba(251,191,36,0.08)', border: `1px solid ${isLive ? 'rgba(74,222,128,0.15)' : 'rgba(251,191,36,0.15)'}` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: isLive ? '#4ade80' : '#fbbf24', boxShadow: `0 0 6px ${isLive ? 'rgba(74,222,128,0.8)' : 'rgba(251,191,36,0.8)'}` }} />
      <span className="text-xs font-mono" style={{ color: isLive ? '#4ade80' : '#fbbf24' }}>{label}</span>
    </div>
  )
}

function FloatingAnalyst() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const location = useLocation()
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async (text) => {
    if (!text.trim() || streaming) return
    const userMsg = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    let acc = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    try {
      await streamAnalyst(
        text.trim(), history, null,
        chunk => { acc += chunk; setMessages(prev => { const copy = [...prev]; copy[copy.length - 1] = { role: 'assistant', content: acc }; return copy }) },
        () => setStreaming(false)
      )
    } catch { setStreaming(false) }
  }, [messages, streaming])

  if (location.pathname === '/analyst') return null

  const SUGGESTED = ['What are the top 3 geopolitical risks right now?', 'Which emerging markets look most vulnerable?', 'Explain the contagion risk from Russia']

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-transform hover:scale-105"
        style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)', boxShadow: '0 4px 24px rgba(99,102,241,0.5)' }}
        title="Open Analyst"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-50 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ width: '360px', height: '480px', background: 'rgba(10,10,20,0.97)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <span className="text-sm font-semibold text-slate-200">Sovereign Analyst</span>
            <span className="ml-auto text-xs text-slate-600 font-mono">AI</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <p className="text-xs text-slate-600 px-1 mb-1">Suggested queries</p>
                {SUGGESTED.map(q => (
                  <button key={q} onClick={() => send(q)}
                    className="text-left text-xs px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed"
                     style={m.role === 'user'
                       ? { background: 'rgba(99,102,241,0.2)', color: '#c4b5fd', border: '1px solid rgba(99,102,241,0.3)' }
                       : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.06)' }}>
                  {m.content || (streaming && i === messages.length - 1 ? <span className="animate-pulse">▋</span> : '')}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
                placeholder="Ask about geopolitical risk..."
                disabled={streaming}
                className="flex-1 text-xs px-3 py-2 rounded-lg text-slate-300 placeholder-slate-600 outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              />
              <button
                onClick={() => send(input)}
                disabled={streaming || !input.trim()}
                className="px-3 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)', color: 'white' }}
              >
                {streaming ? '…' : '→'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

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

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { if (query) setOpen(true) }}
          onKeyDown={e => {
            if (e.key === 'Escape') { setOpen(false); setQuery('') }
            if (e.key === 'Enter' && filtered.length > 0) {
              navigate(`/country/${filtered[0].iso3}`)
              setQuery(''); setOpen(false)
            }
          }}
          placeholder="Search countries..."
          className="w-52 text-xs pl-7 pr-3 py-1.5 rounded-lg bg-transparent text-slate-300 placeholder-slate-600 outline-none transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}
          onFocusCapture={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; e.target.style.background = 'rgba(99,102,241,0.06)' }}
          onBlurCapture={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.background = 'rgba(255,255,255,0.04)' }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div
          className="rounded-xl overflow-hidden shadow-2xl"
          style={{
            position: 'fixed',
            top: '46px',
            right: '16px',
            width: '280px',
            background: 'rgba(12,12,22,0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(20px)',
            zIndex: 9999,
          }}
        >
          {filtered.map((c, i) => (
            <button
              key={c.iso3}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b"
              style={{ borderColor: 'rgba(255,255,255,0.05)', background: i === 0 ? 'rgba(99,102,241,0.05)' : 'transparent' }}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = i === 0 ? 'rgba(99,102,241,0.05)' : 'transparent'}
              onClick={() => { navigate(`/country/${c.iso3}`); setQuery(''); setOpen(false) }}
            >
              <span className="font-mono text-xs text-slate-600 w-8 shrink-0">{c.iso3}</span>
              <span className="text-sm text-slate-200 flex-1 truncate">{c.name}</span>
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
    <span className="absolute -top-0.5 -right-0.5 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none"
          style={{ background: '#f87171', fontSize: '9px', boxShadow: '0 0 8px rgba(248,113,113,0.6)' }}>
      {count > 9 ? '9+' : count}
    </span>
  )
}

function Nav() {
  const location = useLocation()
  const isGlobe = location.pathname === '/'

  const navItem = (to, label, end = false) => (
    <NavLink to={to} end={end}>
      {({ isActive }) => (
        <span
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-all"
          style={{
            color: isActive ? '#a78bfa' : '#94a3b8',
            background: isActive ? 'rgba(167,139,250,0.1)' : 'transparent',
            border: isActive ? '1px solid rgba(167,139,250,0.2)' : '1px solid transparent',
          }}
        >
          {label}
        </span>
      )}
    </NavLink>
  )

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center gap-1 px-4 h-12"
      style={{
        background: 'rgba(7,7,15,0.9)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Logo */}
      <NavLink to="/" className="mr-4 flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-md flex items-center justify-center"
             style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <span
          className="text-sm font-bold tracking-widest font-mono"
          style={{
            background: 'linear-gradient(135deg, #818cf8 0%, #a78bfa 50%, #c4b5fd 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          SOVEREIGN
        </span>
      </NavLink>

      {/* Nav items */}
      <div className="relative">
        {navItem('/', 'Globe', true)}
        <AlertBadge />
      </div>
      {navItem('/dashboard', 'Dashboard')}
      {navItem('/markets', 'Markets')}
      {navItem('/compare', 'Compare')}
      {navItem('/analyst', 'Analyst')}
      {navItem('/scenario', 'Scenario')}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-3">
        <DataFreshness />
        <SearchBar />
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <FloatingAnalyst />
      <div style={{ paddingTop: '48px', minHeight: '100vh' }}>
        <Suspense fallback={
          <div className="flex items-center justify-center h-screen" style={{ background: '#070710' }}>
            <div className="text-slate-600 font-mono text-sm animate-pulse">Loading...</div>
          </div>
        }>
          <Routes>
            <Route path="/" element={<Globe />} />
            <Route path="/country/:iso3" element={<Country />} />
            <Route path="/markets" element={<Markets />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/analyst" element={<Analyst />} />
            <Route path="/scenario" element={<Scenario />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  )
}
