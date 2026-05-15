import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { api } from '../api'

const COLORS = ['#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316']
const TIER_COLORS = { low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444' }
const TIER_ORDER = { severe: 4, high: 3, elevated: 2, low: 1 }

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-lg border p-3 flex flex-col gap-1" style={{ borderColor: '#1e1e2e', background: '#12121a' }}>
      <div className="text-xs text-slate-500 font-mono uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold font-mono" style={{ color: color || '#e2e8f0' }}>{value}</div>
      {sub && <div className="text-xs text-slate-600">{sub}</div>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label, countries }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border p-3 shadow-2xl" style={{ background: '#0d0d14', borderColor: '#2e2e42' }}>
      <div className="text-xs text-slate-500 font-mono mb-2">{label}</div>
      {payload.map(p => {
        const c = countries.find(x => x.iso3 === p.dataKey)
        return (
          <div key={p.dataKey} className="flex items-center gap-2 mb-1 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-slate-400">{c?.name || p.dataKey}</span>
            <span className="font-mono font-bold ml-auto pl-4" style={{ color: p.color }}>
              {p.value?.toFixed(1)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function Compare() {
  const navigate = useNavigate()
  const [countries, setCountries] = useState([])
  const [selected, setSelected] = useState([])
  const [histories, setHistories] = useState({})
  const [loading, setLoading] = useState({})
  const [search, setSearch] = useState('')
  const [filterTier, setFilterTier] = useState('all')

  useEffect(() => {
    api.countries().then(d => {
      setCountries(
        d.filter(c => c.sovereign_risk_score != null)
          .sort((a, b) => (TIER_ORDER[b.risk_tier] || 0) - (TIER_ORDER[a.risk_tier] || 0) || b.sovereign_risk_score - a.sovereign_risk_score)
      )
    }).catch(() => {})
  }, [])

  const toggle = async (iso3) => {
    if (selected.includes(iso3)) {
      setSelected(s => s.filter(x => x !== iso3))
      return
    }
    if (selected.length >= 8) return
    setSelected(s => [...s, iso3])
    if (!histories[iso3]) {
      setLoading(l => ({ ...l, [iso3]: true }))
      try {
        const h = await api.countryHistory(iso3)
        setHistories(prev => ({ ...prev, [iso3]: h.slice(-90) }))
      } catch {}
      setLoading(l => ({ ...l, [iso3]: false }))
    }
  }

  const chartData = (() => {
    const dateMap = {}
    for (const iso3 of selected) {
      const h = histories[iso3] || []
      for (const row of h) {
        const d = row.date?.slice(0, 10)
        if (!d) continue
        if (!dateMap[d]) dateMap[d] = { date: d }
        dateMap[d][iso3] = parseFloat(row.score?.toFixed(1))
      }
    }
    return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date))
  })()

  const filtered = countries.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.iso3.toLowerCase().includes(search.toLowerCase())
    const matchTier = filterTier === 'all' || c.risk_tier === filterTier
    return matchSearch && matchTier
  })

  const selectedCountries = selected.map(iso3 => countries.find(c => c.iso3 === iso3)).filter(Boolean)

  const latestScores = selected.map(iso3 => {
    const h = histories[iso3]
    if (!h?.length) return null
    return h[h.length - 1]?.score
  }).filter(v => v != null)

  const avgScore = latestScores.length ? (latestScores.reduce((a, b) => a + b, 0) / latestScores.length).toFixed(1) : '—'
  const maxScore = latestScores.length ? Math.max(...latestScores).toFixed(1) : '—'
  const spreadVal = latestScores.length >= 2 ? (Math.max(...latestScores) - Math.min(...latestScores)).toFixed(1) : '—'

  const tiers = ['all', 'severe', 'high', 'elevated', 'low']

  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* Left panel — country picker */}
      <div className="w-60 flex flex-col border-r shrink-0" style={{ borderColor: '#1e1e2e', background: '#0d0d14' }}>
        <div className="p-3 border-b space-y-2" style={{ borderColor: '#1e1e2e' }}>
          <div className="text-xs font-mono text-slate-500 uppercase tracking-widest">Countries</div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full text-xs px-2 py-1.5 rounded border bg-transparent text-slate-300 placeholder-slate-600 outline-none focus:border-indigo-500 transition-colors"
            style={{ borderColor: '#2e2e42' }}
          />
          <div className="flex flex-wrap gap-1">
            {tiers.map(t => (
              <button
                key={t}
                onClick={() => setFilterTier(t)}
                className="text-xs px-2 py-0.5 rounded-full border transition-colors capitalize"
                style={{
                  borderColor: filterTier === t ? (TIER_COLORS[t] || '#6366f1') : '#2e2e42',
                  color: filterTier === t ? (TIER_COLORS[t] || '#6366f1') : '#64748b',
                  background: filterTier === t ? `${TIER_COLORS[t] || '#6366f1'}15` : 'transparent',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map(c => {
            const isSelected = selected.includes(c.iso3)
            const colorIdx = selected.indexOf(c.iso3)
            return (
              <button
                key={c.iso3}
                onClick={() => toggle(c.iso3)}
                disabled={!isSelected && selected.length >= 8}
                className="w-full flex items-center gap-2 px-3 py-2 text-left border-b hover:bg-white/5 transition-colors disabled:opacity-30"
                style={{ borderColor: '#1e1e2e' }}
              >
                <span className="w-3 h-3 rounded-full shrink-0 border transition-all"
                      style={{
                        background: isSelected ? COLORS[colorIdx] : 'transparent',
                        borderColor: isSelected ? COLORS[colorIdx] : '#2e2e42',
                      }} />
                <span className="font-mono text-xs text-slate-600 w-7">{c.iso3}</span>
                <span className="text-xs text-slate-300 flex-1 truncate">{c.name}</span>
                <span className="font-mono text-xs font-bold shrink-0"
                      style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                  {c.sovereign_risk_score?.toFixed(0)}
                </span>
              </button>
            )
          })}
        </div>

        <div className="p-3 border-t text-xs text-slate-600 font-mono" style={{ borderColor: '#1e1e2e' }}>
          {selected.length}/8 selected
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <h3 className="text-slate-300 font-semibold mb-2">Country Risk Comparison</h3>
            <p className="text-slate-500 text-sm max-w-sm">
              Select up to 8 countries from the left panel to compare 90-day risk trajectories side by side.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-200">Risk Comparison</h1>
                <p className="text-xs text-slate-500 mt-0.5">90-day sovereign risk trajectory</p>
              </div>
              <button
                onClick={() => setSelected([])}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Clear all
              </button>
            </div>

            {/* Selected pills */}
            <div className="flex flex-wrap gap-2">
              {selectedCountries.map((c, i) => (
                <div key={c.iso3}
                     className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs"
                     style={{ borderColor: COLORS[i], color: COLORS[i], background: `${COLORS[i]}12` }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono opacity-60">{c.sovereign_risk_score?.toFixed(0)}</span>
                  {loading[c.iso3] && <span className="animate-pulse opacity-60">…</span>}
                  <button onClick={() => toggle(c.iso3)} className="opacity-50 hover:opacity-100 ml-0.5 text-base leading-none">×</button>
                </div>
              ))}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Avg Risk Score" value={avgScore} sub="across selected countries" color="#e2e8f0" />
              <StatCard label="Highest Score" value={maxScore}
                sub={selectedCountries.find(c => c.sovereign_risk_score?.toFixed(1) === maxScore)?.name}
                color="#ef4444" />
              <StatCard label="Score Spread" value={spreadVal} sub="high − low" color="#f59e0b" />
            </div>

            {/* Chart */}
            <div className="rounded-xl border p-5" style={{ borderColor: '#1e1e2e', background: '#12121a' }}>
              <div className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-4">Risk Score Over Time</div>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2a" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#475569', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    tickFormatter={d => d?.slice(5)}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#475569', fontSize: 10 }}
                    width={28}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.3} label={{ value: 'High', fill: '#ef4444', fontSize: 10, opacity: 0.5 }} />
                  <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.3} label={{ value: 'Elevated', fill: '#f59e0b', fontSize: 10, opacity: 0.5 }} />
                  <Tooltip content={<CustomTooltip countries={countries} />} />
                  {selected.map((iso3, i) => (
                    <Line
                      key={iso3}
                      type="monotone"
                      dataKey={iso3}
                      stroke={COLORS[i]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                      name={countries.find(x => x.iso3 === iso3)?.name || iso3}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Country detail cards */}
            <div className="grid grid-cols-2 gap-3">
              {selectedCountries.map((c, i) => (
                <div key={c.iso3}
                     className="rounded-xl border p-4 cursor-pointer hover:bg-white/3 transition-colors"
                     style={{ borderColor: `${COLORS[i]}40`, background: '#12121a' }}
                     onClick={() => navigate(`/country/${c.iso3}`)}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i] }} />
                        <span className="text-sm font-semibold text-slate-200">{c.name}</span>
                      </div>
                      <div className="text-xs text-slate-600 font-mono mt-0.5 ml-4.5">{c.iso3} · {c.region || 'Global'}</div>
                    </div>
                    <span className="font-mono text-lg font-bold" style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                      {c.sovereign_risk_score?.toFixed(0)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {c.top_risk_drivers?.slice(0, 2).map((d, di) => (
                      <div key={di} className="text-xs text-slate-500 bg-white/5 rounded px-2 py-1 truncate">
                        ⚡ {d}
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-mono capitalize"
                          style={{ background: `${TIER_COLORS[c.risk_tier]}20`, color: TIER_COLORS[c.risk_tier] }}>
                      {c.risk_tier}
                    </span>
                    <span className="text-xs text-indigo-400 ml-auto">View details →</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
