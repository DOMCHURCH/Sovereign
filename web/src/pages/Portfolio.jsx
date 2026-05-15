import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'
import RiskGauge from '../components/RiskGauge'

const TIER_COLORS = {
  low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444', unknown: '#4a4a6a',
}

const PRESETS = [
  { label: '2008 GFC',       shocks: { CHN: 40, USA: 35, GBR: 30, DEU: 25, JPN: 20 } },
  { label: 'COVID 2020',     shocks: { USA: 30, IND: 35, BRA: 40, CHN: 20, ITA: 35 } },
  { label: '2022 Rate Shock', shocks: { USA: 15, DEU: 20, GBR: 18, JPN: 22, AUS: 15 } },
]

function fmt(v) {
  if (v == null) return '—'
  return typeof v === 'number' ? v.toFixed(1) : v
}

export default function Portfolio() {
  const [holdings, setHoldings] = useState([])
  const [impact, setImpact] = useState(null)
  const [stressResult, setStressResult] = useState(null)
  const [stressCountry, setStressCountry] = useState('CHN')
  const [stressMag, setStressMag] = useState(25)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.portfolio(), api.portfolioImpact()]).then(([p, i]) => {
      setHoldings(p.holdings || [])
      setImpact(i)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const runCustomStress = async () => {
    const res = await api.portfolioStress(stressCountry, stressMag)
    setStressResult(res)
  }

  const runPreset = async (preset) => {
    const results = await Promise.all(
      Object.entries(preset.shocks).map(([c, m]) => api.portfolioStress(c, m))
    )
    const totalShock = results.reduce((s, r) => s + (r.total_shock_pct || 0), 0)
    setStressResult({
      scenario: { label: preset.label },
      total_shock_pct: totalShock,
      total_shock_usd: totalShock * 1_000_000,
      position_attribution: results.flatMap(r => r.position_attribution || []),
    })
  }

  const tierBreakdown = holdings.reduce((acc, h) => {
    const t = h.risk_tier || 'unknown'
    acc[t] = (acc[t] || 0) + h.weight
    return acc
  }, {})

  const pieData = Object.entries(tierBreakdown).map(([t, v]) => ({
    name: t,
    value: parseFloat((v * 100).toFixed(1)),
  }))

  const overallScore = holdings.reduce((s, h) => s + (h.risk_score || 0) * h.weight, 0) /
    (holdings.reduce((s, h) => s + (h.risk_score != null ? h.weight : 0), 0) || 1)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 font-mono text-sm">
        Loading portfolio...
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Portfolio Risk Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Demo portfolio · $1M AUM · 10 positions</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <RiskGauge score={overallScore} size={80} />
            <div className="text-xs text-slate-500 mt-1">Blended Risk</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 mb-1">Est. P&amp;L Shock</div>
            <div className={`text-2xl font-mono font-bold ${impact?.total_shock_pct < -0.01 ? 'text-red-400' : 'text-green-400'}`}>
              {impact ? `${(impact.total_shock_pct * 100).toFixed(2)}%` : '—'}
            </div>
            <div className="text-xs text-slate-500">
              {impact ? `$${impact.total_shock_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Holdings table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#1e1e2e' }}>
        <div className="px-4 py-3 border-b" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest">Holdings</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ background: '#0d0d14' }}>
            <thead>
              <tr className="text-xs text-slate-500 font-mono uppercase border-b" style={{ borderColor: '#1e1e2e' }}>
                <th className="px-4 py-2 text-left">Ticker</th>
                <th className="px-4 py-2 text-left">Country</th>
                <th className="px-4 py-2 text-right">Weight</th>
                <th className="px-4 py-2 text-left">Risk Tier</th>
                <th className="px-4 py-2 text-right">Risk Score</th>
                <th className="px-4 py-2 text-right">Shock Est.</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map(h => {
                const attr = impact?.position_attribution?.find(p => p.ticker === h.ticker)
                return (
                  <tr key={h.ticker} className="border-b hover:bg-white/5 transition-colors"
                      style={{ borderColor: '#1a1a28' }}>
                    <td className="px-4 py-2.5 font-mono text-indigo-400 font-semibold">{h.ticker}</td>
                    <td className="px-4 py-2.5 text-slate-300">{h.country_iso3 || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{(h.weight * 100).toFixed(0)}%</td>
                    <td className="px-4 py-2.5"><RiskBadge tier={h.risk_tier} size="xs" /></td>
                    <td className="px-4 py-2.5 text-right font-mono"
                        style={{ color: h.risk_score > 75 ? '#ef4444' : h.risk_score > 50 ? '#f97316' : '#94a3b8' }}>
                      {fmt(h.risk_score)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono"
                        style={{ color: attr?.shock_contribution_pct < 0 ? '#ef4444' : '#22c55e' }}>
                      {attr ? `${(attr.shock_contribution_pct * 100).toFixed(3)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Tier breakdown pie */}
        <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Exposure by Risk Tier</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                   label={({ name, value }) => `${name} ${value}%`} labelLine={false}>
                {pieData.map(e => (
                  <Cell key={e.name} fill={TIER_COLORS[e.name]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Shock attribution bar */}
        {impact?.position_attribution?.length > 0 && (
          <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
            <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">P&amp;L Shock Attribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={impact.position_attribution} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
                <XAxis dataKey="ticker" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} width={50}
                       tickFormatter={v => `${(v * 100).toFixed(2)}%`} />
                <Tooltip
                  formatter={v => `${(v * 100).toFixed(3)}%`}
                  contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="shock_contribution_pct">
                  {impact.position_attribution.map(e => (
                    <Cell key={e.ticker} fill={e.shock_contribution_pct < 0 ? '#ef4444' : '#22c55e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Stress testing */}
      <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
        <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Stress Scenario Analysis</h3>

        <div className="flex gap-2 mb-4 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => runPreset(p)}
                    className="px-3 py-1.5 rounded border text-xs font-medium text-slate-300 hover:bg-white/10 transition-colors"
                    style={{ borderColor: '#2e2e42' }}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-4 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Country ISO3</label>
            <input
              value={stressCountry}
              onChange={e => setStressCountry(e.target.value.toUpperCase().slice(0, 3))}
              className="w-20 px-2 py-1.5 rounded border text-sm font-mono bg-transparent text-slate-200"
              style={{ borderColor: '#2e2e42' }}
              placeholder="CHN"
            />
          </div>
          <div className="flex-1 max-w-xs">
            <label className="text-xs text-slate-500 block mb-1">
              Risk spike: <span className="text-indigo-400 font-mono">+{stressMag} pts</span>
            </label>
            <input type="range" min={10} max={50} value={stressMag}
                   onChange={e => setStressMag(Number(e.target.value))}
                   className="w-full accent-indigo-500" />
          </div>
          <button onClick={runCustomStress}
                  className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
            Run
          </button>
        </div>

        {stressResult && (
          <div className="rounded-lg border p-4" style={{ background: '#0d0d14', borderColor: '#1e1e2e' }}>
            <div className="flex items-center gap-6 mb-3">
              <div>
                <div className="text-xs text-slate-500">Scenario</div>
                <div className="font-mono text-sm text-indigo-400">
                  {stressResult.scenario?.label || `${stressResult.scenario?.country} +${stressResult.scenario?.shock_magnitude}pts`}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Est. P&amp;L Impact</div>
                <div className={`text-xl font-mono font-bold ${stressResult.total_shock_pct < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(stressResult.total_shock_pct * 100).toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">USD Impact</div>
                <div className="font-mono text-sm text-slate-300">
                  ${stressResult.total_shock_usd?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '—'}
                </div>
              </div>
            </div>
            {stressResult.position_attribution?.length > 0 && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {stressResult.position_attribution.slice(0, 6).map(p => (
                  <div key={p.ticker} className="flex justify-between">
                    <span className="font-mono text-indigo-400">{p.ticker}</span>
                    <span className={p.shock_contribution_pct < 0 ? 'text-red-400' : 'text-green-400'}>
                      {(p.shock_contribution_pct * 100).toFixed(3)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
