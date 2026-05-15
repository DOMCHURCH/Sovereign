import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../api'

const COLORS = ['#6366f1', '#ef4444', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316']
const TIER_COLORS = { low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444' }

export default function Compare() {
  const [countries, setCountries] = useState([])
  const [selected, setSelected] = useState([])
  const [histories, setHistories] = useState({})
  const [loading, setLoading] = useState({})
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.countries().then(d => {
      setCountries(d.filter(c => c.sovereign_risk_score != null).sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score))
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

  // Merge histories into chart data keyed by date
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

  const filtered = countries.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.iso3.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-200">Country Risk Comparison</h1>
        <p className="text-xs text-slate-500 mt-0.5">Select up to 8 countries to compare 90-day risk trajectories</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Country picker */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#1e1e2e', background: '#12121a' }}>
          <div className="p-3 border-b" style={{ borderColor: '#1e1e2e' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter countries..."
              className="w-full text-xs px-2 py-1.5 rounded border bg-transparent text-slate-300 placeholder-slate-600 outline-none"
              style={{ borderColor: '#2e2e42' }}
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
            {filtered.map(c => {
              const isSelected = selected.includes(c.iso3)
              const colorIdx = selected.indexOf(c.iso3)
              return (
                <button
                  key={c.iso3}
                  onClick={() => toggle(c.iso3)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left border-b hover:bg-white/5 transition-colors"
                  style={{ borderColor: '#1e1e2e', opacity: !isSelected && selected.length >= 8 ? 0.4 : 1 }}
                >
                  <span className="w-3 h-3 rounded-full shrink-0 border"
                        style={{
                          background: isSelected ? COLORS[colorIdx] : 'transparent',
                          borderColor: isSelected ? COLORS[colorIdx] : '#2e2e42',
                        }} />
                  <span className="font-mono text-xs text-slate-500 w-8">{c.iso3}</span>
                  <span className="text-xs text-slate-300 flex-1 truncate">{c.name}</span>
                  <span className="font-mono text-xs font-bold shrink-0"
                        style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                    {c.sovereign_risk_score?.toFixed(0)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Chart */}
        <div className="col-span-2 rounded-xl border p-4" style={{ borderColor: '#1e1e2e', background: '#12121a' }}>
          {selected.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm" style={{ minHeight: 400 }}>
              Select countries on the left to compare
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {selected.map((iso3, i) => {
                  const c = countries.find(x => x.iso3 === iso3)
                  return (
                    <span key={iso3} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border"
                          style={{ borderColor: COLORS[i], color: COLORS[i], background: `${COLORS[i]}15` }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
                      {c?.name || iso3}
                      {loading[iso3] && <span className="animate-pulse">…</span>}
                      <button onClick={() => toggle(iso3)} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                    </span>
                  )
                })}
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} width={28} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  {selected.map((iso3, i) => (
                    <Line key={iso3} type="monotone" dataKey={iso3} stroke={COLORS[i]}
                          strokeWidth={2} dot={false} activeDot={{ r: 4 }}
                          name={countries.find(x => x.iso3 === iso3)?.name || iso3} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
