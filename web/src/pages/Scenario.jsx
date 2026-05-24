import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, streamAnalyst } from '../api'

const SHOCK_TYPES = [
  { label: 'Military Escalation',  value: 'military_escalation',  magnitude: 75 },
  { label: 'Economic Sanctions',   value: 'economic_sanctions',   magnitude: 60 },
  { label: 'Civil War / Coup',     value: 'civil_war_coup',       magnitude: 70 },
  { label: 'Debt Default / Crisis',value: 'debt_default_crisis',  magnitude: 65 },
  { label: 'Pandemic / Disaster',  value: 'pandemic_disaster',    magnitude: 50 },
  { label: 'Diplomatic Rupture',   value: 'diplomatic_rupture',   magnitude: 40 },
  { label: 'Trade War Escalation', value: 'trade_war_escalation', magnitude: 55 },
]

const EXAMPLE_SCENARIOS = [
  {
    label: 'Russia-Ukraine escalation',
    iso3: 'RUS',
    shockType: 'military_escalation',
    magnitude: 82,
  },
  {
    label: 'China-Taiwan blockade',
    iso3: 'CHN',
    shockType: 'military_escalation',
    magnitude: 90,
  },
  {
    label: 'Iran sanctions surge',
    iso3: 'IRN',
    shockType: 'economic_sanctions',
    magnitude: 70,
  },
]

function shockLabel(value) {
  return SHOCK_TYPES.find(s => s.value === value)?.label ?? value
}

function magnitudeColor(v) {
  if (v < 33) return '#4ade80'
  if (v < 66) return '#fbbf24'
  return '#ef4444'
}

function impactColor(v) {
  if (v == null) return '#94a3b8'
  if (v >= 0) return '#4ade80'
  return '#ef4444'
}

function SummaryCard({ label, value, sub, color, accent }) {
  return (
    <div
      className="glass-card card-accent-top rounded-xl p-5 flex flex-col gap-1.5"
      style={{ borderColor: accent ? 'rgba(99,102,241,0.3)' : undefined }}
    >
      <div className="text-xs font-mono uppercase tracking-widest text-slate-500">{label}</div>
      <div
        className="text-3xl font-mono font-bold leading-none"
        style={{ color: color || '#c4b5fd' }}
      >
        {value ?? '—'}
      </div>
      {sub && <div className="text-xs text-slate-600 font-mono">{sub}</div>}
    </div>
  )
}

function Spinner({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  )
}

export default function Scenario() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [countries, setCountries] = useState([])
  const [countriesLoading, setCountriesLoading] = useState(true)
  const [selectedIso3, setSelectedIso3] = useState('')
  const [shockType, setShockType] = useState(SHOCK_TYPES[0].value)
  const [magnitude, setMagnitude] = useState(SHOCK_TYPES[0].magnitude)
  const [isRunning, setIsRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [aiBriefing, setAiBriefing] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const briefingRef = useRef(null)

  // Load countries on mount
  useEffect(() => {
    setCountriesLoading(true)
    api.countries()
      .then(data => {
        const sorted = [...data].sort(
          (a, b) => (b.sovereign_risk_score ?? 0) - (a.sovereign_risk_score ?? 0)
        )
        setCountries(sorted)
        if (sorted.length > 0 && !selectedIso3) {
          setSelectedIso3(sorted[0].iso3)
        }
      })
      .catch(() => {})
      .finally(() => setCountriesLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll briefing
  useEffect(() => {
    if (briefingRef.current) {
      briefingRef.current.scrollTop = briefingRef.current.scrollHeight
    }
  }, [aiBriefing])

  function getCountryName(iso3) {
    return countries.find(c => c.iso3 === iso3)?.name ?? iso3
  }

  async function runSimulation(isoOverride, typeOverride, magOverride) {
    const iso = isoOverride ?? selectedIso3
    const type = typeOverride ?? shockType
    const mag = magOverride ?? magnitude

    if (!iso) return
    setIsRunning(true)
    setResults(null)
    setAiBriefing('')
    setAiStreaming(false)

    try {
      const [stress, contagion] = await Promise.all([
        api.portfolioStress(iso, mag),
        api.countryContagion(iso),
      ])

      setResults({ stress, contagion, iso, type, mag })
      setIsRunning(false)

      // Build prompt
      const countryName = getCountryName(iso)
      const impact = stress?.total_shock_pct
      const top3 = (contagion?.propagated_impacts ?? [])
        .slice(0, 3)
        .map(x => x.iso3 ?? x.country ?? x.name ?? '')
        .filter(Boolean)
        .join(', ')

      const prompt =
        `Analyze this scenario: ${countryName} experiencing ${shockLabel(type)} with intensity ${mag}/100. ` +
        `Portfolio impact: ${impact != null ? impact.toFixed(1) : 'unknown'}%. ` +
        `Top contagion risks: ${top3 || 'none identified'}. ` +
        `What are the key risk transmission channels, likely duration, and recommended portfolio actions?`

      setAiStreaming(true)
      streamAnalyst(
        prompt,
        [],
        iso,
        chunk => setAiBriefing(prev => prev + chunk),
        () => setAiStreaming(false),
      ).catch(() => {
        setAiStreaming(false)
        setAiBriefing('Analysis unavailable. Check API key configuration.')
      })
    } catch {
      setIsRunning(false)
    }
  }

  function handleShockTypeChange(e) {
    const val = e.target.value
    setShockType(val)
    const preset = SHOCK_TYPES.find(s => s.value === val)
    if (preset) setMagnitude(preset.magnitude)
  }

  function handleExampleClick(ex) {
    setSelectedIso3(ex.iso3)
    setShockType(ex.shockType)
    setMagnitude(ex.magnitude)
    // run immediately with explicit values since state may not flush yet
    runSimulation(ex.iso3, ex.shockType, ex.magnitude)
  }

  // Derived display data
  const propagated = (results?.contagion?.propagated_impacts ?? [])
    .slice()
    .sort((a, b) => (b.estimated_risk_increase ?? 0) - (a.estimated_risk_increase ?? 0))

  const maxRiskIncrease = propagated.length > 0
    ? Math.max(...propagated.map(x => x.estimated_risk_increase ?? 0))
    : 1

  const positions = results?.stress?.position_attribution ?? []
  const maxContrib = positions.length > 0
    ? Math.max(...positions.map(x => Math.abs(x.shock_contribution_pct ?? 0)))
    : 1

  const portfolioImpact = results?.stress?.total_shock_pct

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingTop: 0 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* ── Header ── */}
        <div className="mb-8">
          <div className="font-mono text-xs tracking-widest text-slate-500 uppercase mb-2">
            Scenario Simulation
          </div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">
            Model the geopolitical shockwave
            <span
              className="ml-3 text-base font-normal"
              style={{
                background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              before it hits your portfolio
            </span>
          </h1>
          {/* Accent line */}
          <div
            style={{
              height: 2,
              width: 120,
              marginTop: 12,
              borderRadius: 2,
              background: 'linear-gradient(90deg, #6366f1, #a78bfa, transparent)',
            }}
          />
        </div>

        {/* ── Scenario Builder ── */}
        <div
          className="glass-card card-accent-top rounded-xl p-6 mb-6"
          style={{ borderColor: 'rgba(99,102,241,0.2)' }}
        >
          <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-5">
            Scenario Builder
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Column 1 — Target Country */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Target Country
              </label>
              {countriesLoading ? (
                <div
                  className="shimmer rounded-lg h-10"
                  style={{ background: 'var(--surface-2)' }}
                />
              ) : (
                <select
                  value={selectedIso3}
                  onChange={e => setSelectedIso3(e.target.value)}
                  className="rounded-lg px-3 py-2.5 text-sm font-mono text-slate-200 outline-none appearance-none cursor-pointer"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text)',
                  }}
                  onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)' }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)' }}
                >
                  {countries.map(c => (
                    <option
                      key={c.iso3}
                      value={c.iso3}
                      style={{ background: '#0f0f1a', color: '#e2e8f0' }}
                    >
                      {c.iso3} — {c.name}
                      {c.sovereign_risk_score != null
                        ? `  [${c.sovereign_risk_score.toFixed(0)}]`
                        : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedIso3 && (
                <div className="text-xs text-slate-600 font-mono mt-0.5">
                  {getCountryName(selectedIso3)}
                </div>
              )}
            </div>

            {/* Column 2 — Shock Type */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Shock Type
              </label>
              <select
                value={shockType}
                onChange={handleShockTypeChange}
                className="rounded-lg px-3 py-2.5 text-sm font-mono text-slate-200 outline-none appearance-none cursor-pointer"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text)',
                }}
                onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)' }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)' }}
              >
                {SHOCK_TYPES.map(s => (
                  <option
                    key={s.value}
                    value={s.value}
                    style={{ background: '#0f0f1a', color: '#e2e8f0' }}
                  >
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-slate-600 font-mono mt-0.5">
                Preset intensity: {SHOCK_TYPES.find(s => s.value === shockType)?.magnitude ?? '—'}
              </div>
            </div>

            {/* Column 3 — Shock Magnitude */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Shock Intensity
              </label>
              <div className="flex items-center gap-4">
                <div
                  className="text-4xl font-mono font-bold leading-none w-14 shrink-0"
                  style={{ color: magnitudeColor(magnitude) }}
                >
                  {magnitude}
                </div>
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={magnitude}
                    onChange={e => setMagnitude(Number(e.target.value))}
                    className="w-full cursor-pointer"
                    style={{
                      accentColor: magnitudeColor(magnitude),
                    }}
                  />
                  <div className="flex justify-between text-xs font-mono mt-1" style={{ color: 'var(--text-dim)' }}>
                    <span>Low</span>
                    <span>Moderate</span>
                    <span>Extreme</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Run button */}
          <button
            onClick={() => runSimulation()}
            disabled={isRunning || !selectedIso3}
            className="mt-6 w-full flex items-center justify-center gap-3 rounded-xl py-3.5 text-sm font-mono font-bold tracking-widest uppercase transition-all"
            style={{
              background: isRunning || !selectedIso3
                ? 'rgba(99,102,241,0.3)'
                : 'linear-gradient(90deg, #6366f1, #7c3aed)',
              color: isRunning || !selectedIso3 ? 'rgba(255,255,255,0.4)' : '#fff',
              cursor: isRunning || !selectedIso3 ? 'not-allowed' : 'pointer',
              boxShadow: !isRunning && selectedIso3
                ? '0 0 24px rgba(99,102,241,0.3)'
                : 'none',
            }}
          >
            {isRunning ? (
              <>
                <Spinner size={16} />
                Running Simulation…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Run Simulation
              </>
            )}
          </button>
        </div>

        {/* ── Empty State ── */}
        {!results && !isRunning && (
          <div className="fade-in">
            <div
              className="glass-card rounded-xl p-12 flex flex-col items-center text-center mb-4"
              style={{ borderColor: 'rgba(255,255,255,0.05)' }}
            >
              <div
                className="text-5xl mb-4"
                style={{ filter: 'drop-shadow(0 0 16px rgba(99,102,241,0.5))' }}
              >
                ⚡
              </div>
              <div className="text-slate-300 text-base font-medium mb-1">
                Configure a scenario above and run simulation
              </div>
              <div className="text-slate-600 text-sm mb-8">
                Simulate how geopolitical shocks propagate through interconnected markets
              </div>

              {/* Example scenario cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full" style={{ maxWidth: 680 }}>
                {EXAMPLE_SCENARIOS.map(ex => (
                  <button
                    key={ex.label}
                    onClick={() => handleExampleClick(ex)}
                    className="glass-card rounded-xl p-4 text-left transition-all"
                    style={{ borderColor: 'rgba(99,102,241,0.15)' }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)'
                      e.currentTarget.style.background = 'rgba(99,102,241,0.05)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'rgba(99,102,241,0.15)'
                      e.currentTarget.style.background = ''
                    }}
                  >
                    <div className="text-xs font-mono text-slate-400 mb-1.5 uppercase tracking-wider">
                      {ex.iso3} · {shockLabel(ex.shockType)}
                    </div>
                    <div className="text-sm text-slate-200 font-medium mb-2">{ex.label}</div>
                    <div className="flex items-center gap-1.5">
                      <div
                        className="text-xs font-mono font-bold"
                        style={{ color: magnitudeColor(ex.magnitude) }}
                      >
                        {ex.magnitude}
                      </div>
                      <div className="text-xs text-slate-600">intensity</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Running skeleton ── */}
        {isRunning && (
          <div className="fade-in space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0, 1, 2].map(i => (
                <div key={i} className="shimmer glass-card rounded-xl h-28" />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="shimmer glass-card rounded-xl h-64" />
              <div className="shimmer glass-card rounded-xl h-64" />
            </div>
            <div className="shimmer glass-card rounded-xl h-48" />
          </div>
        )}

        {/* ── Results ── */}
        {results && !isRunning && (
          <div className="fade-in space-y-5">

            {/* Row 1: Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <SummaryCard
                label="Portfolio Impact"
                value={
                  portfolioImpact != null
                    ? `${portfolioImpact >= 0 ? '+' : ''}${portfolioImpact.toFixed(2)}%`
                    : '—'
                }
                sub="Total shock to portfolio"
                color={portfolioImpact == null ? '#94a3b8' : portfolioImpact >= 0 ? '#4ade80' : '#ef4444'}
              />
              <SummaryCard
                label="Countries at Risk"
                value={propagated.length}
                sub="Propagated contagion impacts"
                color="#a78bfa"
              />
              <SummaryCard
                label="Epicenter Risk Score"
                value={results.mag}
                sub={`${getCountryName(results.iso)} · ${shockLabel(results.type)}`}
                color={magnitudeColor(results.mag)}
              />
            </div>

            {/* Row 2: Contagion + Portfolio */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Contagion Spread */}
              <div className="glass-card card-accent-top rounded-xl p-5">
                <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4">
                  Contagion Spread
                </div>
                {propagated.length === 0 ? (
                  <div className="text-slate-600 text-sm text-center py-8">
                    No propagated impacts detected
                  </div>
                ) : (
                  <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                    {/* Header row */}
                    <div
                      className="grid text-xs font-mono text-slate-600 uppercase tracking-wider pb-2 mb-1"
                      style={{
                        gridTemplateColumns: '3rem 1fr 4rem 6rem',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <span>ISO3</span>
                      <span>Country</span>
                      <span className="text-right">Risk+</span>
                      <span />
                    </div>
                    {propagated.map(row => {
                      const inc = row.estimated_risk_increase ?? 0
                      const pct = maxRiskIncrease > 0 ? (inc / maxRiskIncrease) * 100 : 0
                      const iso = row.iso3 ?? row.country ?? ''
                      const name = row.name ?? getCountryName(iso)
                      return (
                        <button
                          key={iso}
                          onClick={() => navigate(`/country/${iso}`)}
                          className="grid w-full text-left rounded-lg px-0 py-1.5 transition-colors"
                          style={{
                            gridTemplateColumns: '3rem 1fr 4rem 6rem',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                        >
                          <span className="font-mono text-xs text-slate-500">{iso}</span>
                          <span className="text-xs text-slate-300 truncate pr-2">{name}</span>
                          <span
                            className="font-mono text-xs font-bold text-right"
                            style={{ color: '#fb923c' }}
                          >
                            +{inc.toFixed(1)}
                          </span>
                          <span className="flex items-center pl-2">
                            <span
                              className="h-1.5 rounded-full"
                              style={{
                                width: `${pct}%`,
                                background: 'linear-gradient(90deg, #6366f1, #fb923c)',
                                minWidth: 2,
                              }}
                            />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Portfolio Exposure */}
              <div className="glass-card card-accent-top rounded-xl p-5">
                <div className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4">
                  Portfolio Exposure
                </div>
                {positions.length === 0 ? (
                  <div className="text-slate-600 text-sm text-center py-8">
                    No position data available
                  </div>
                ) : (
                  <>
                    <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                      {/* Header row */}
                      <div
                        className="grid text-xs font-mono text-slate-600 uppercase tracking-wider pb-2 mb-1"
                        style={{
                          gridTemplateColumns: '4rem 1fr 4rem 5rem',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                        }}
                      >
                        <span>Ticker</span>
                        <span />
                        <span className="text-right">Impact</span>
                        <span />
                      </div>
                      {positions.map(pos => {
                        const contrib = pos.shock_contribution_pct ?? 0
                        const pct = maxContrib > 0 ? (Math.abs(contrib) / maxContrib) * 100 : 0
                        return (
                          <div
                            key={pos.ticker ?? pos.symbol}
                            className="grid items-center py-1.5"
                            style={{ gridTemplateColumns: '4.5rem 1fr 5rem 7rem' }}
                          >
                            <span className="font-mono text-xs text-slate-400">
                              {pos.ticker ?? pos.symbol ?? '—'}
                            </span>
                            <span className="text-xs text-slate-600 truncate pr-2">
                              {pos.name ?? ''}
                            </span>
                            <span
                              className="font-mono text-xs font-bold text-right"
                              style={{ color: impactColor(contrib) }}
                            >
                              {contrib >= 0 ? '+' : ''}{contrib.toFixed(2)}%
                            </span>
                            <span className="flex items-center pl-2">
                              <span
                                className="h-1.5 rounded-full"
                                style={{
                                  width: `${pct}%`,
                                  background: contrib >= 0
                                    ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                                    : 'linear-gradient(90deg, #ef4444, #dc2626)',
                                  minWidth: 2,
                                }}
                              />
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {/* Total */}
                    <div
                      className="flex items-center justify-between pt-3 mt-3 font-mono text-sm"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      <span className="text-slate-500 uppercase tracking-wider text-xs">Total Impact</span>
                      <span
                        className="font-bold text-base"
                        style={{ color: impactColor(portfolioImpact) }}
                      >
                        {portfolioImpact != null
                          ? `${portfolioImpact >= 0 ? '+' : ''}${portfolioImpact.toFixed(2)}%`
                          : '—'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Row 3: AI Scenario Briefing */}
            <div className="glass-card card-accent-top rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                </div>
                <span className="text-xs font-mono uppercase tracking-widest text-slate-400">
                  AI Scenario Briefing
                </span>
                {aiStreaming && (
                  <span className="ml-1 flex items-center gap-1.5 text-xs text-indigo-400 font-mono">
                    <Spinner size={12} />
                    Analyzing…
                  </span>
                )}
              </div>

              <div
                ref={briefingRef}
                className="text-sm text-slate-300 leading-relaxed max-h-80 overflow-y-auto pr-2"
                style={{ minHeight: 80 }}
              >
                {aiBriefing ? (
                  <span>
                    {aiBriefing.split('\n').map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < aiBriefing.split('\n').length - 1 && <br />}
                      </span>
                    ))}
                    {aiStreaming && (
                      <span
                        className="inline-block w-0.5 h-3.5 ml-0.5 rounded-sm align-middle"
                        style={{
                          background: '#6366f1',
                          animation: 'pulse-ring 1s ease-in-out infinite',
                        }}
                      />
                    )}
                  </span>
                ) : (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Spinner size={14} />
                    <span>Generating scenario analysis…</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
