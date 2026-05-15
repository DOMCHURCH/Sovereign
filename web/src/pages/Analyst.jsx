import { useEffect, useState } from 'react'
import { api } from '../api'

const SOURCES = [
  { name: 'World Bank WDI/WGI', desc: '53 countries · GDP, inflation, debt, governance scores', color: '#3b82f6' },
  { name: 'OFAC SDN List', desc: '3,200+ sanctioned entities tracked across 25 countries', color: '#8b5cf6' },
  { name: 'Equity Markets', desc: '25 country ETFs · 1Y returns, 21D volatility, 30D correlations', color: '#06b6d4' },
  { name: 'News Sentiment', desc: 'NLP sentiment across 53 countries · 7-day rolling average', color: '#10b981' },
]

function Card({ title, accent, children }) {
  return (
    <div className="rounded-xl border p-5" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
      <h3 className="text-xs font-mono font-semibold uppercase tracking-widest mb-4" style={{ color: accent }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function RiskBar({ label, value, max = 100 }) {
  const pct = Math.min(100, (value / max) * 100)
  const color = value > 70 ? '#ef4444' : value > 50 ? '#f59e0b' : value > 30 ? '#3b82f6' : '#10b981'
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span className="font-mono" style={{ color }}>{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: '#1e1e2e' }}>
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function Analyst() {
  const [countries, setCountries] = useState([])
  const [alerts, setAlerts] = useState([])
  const [impact, setImpact] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.countries(), api.alerts(), api.portfolioImpact()])
      .then(([c, a, imp]) => {
        setCountries(c)
        setAlerts(a.filter(x => !x.acknowledged))
        setImpact(imp)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const topRisk = [...countries]
    .filter(c => c.sovereign_risk_score != null)
    .sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score)
    .slice(0, 6)

  const critical = alerts.filter(a => a.severity === 'critical').slice(0, 3)
  const warning = alerts.filter(a => a.severity === 'warning').slice(0, 3)
  const shownAlerts = [...critical, ...warning].slice(0, 5)

  const worstExposures = impact?.worst_country_exposures?.slice(0, 5) || []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
        Loading intelligence data...
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-200">Sovereign Intelligence Brief</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {countries.length} countries · {alerts.length} active alerts · Live as of {new Date().toLocaleDateString()}
          </p>
        </div>
        {impact && (
          <div className="text-right">
            <div className={`text-lg font-mono font-bold ${impact.total_shock_pct < -0.005 ? 'text-red-400' : 'text-green-400'}`}>
              {impact.total_shock_pct > 0 ? '+' : ''}{(impact.total_shock_pct * 100).toFixed(2)}%
            </div>
            <div className="text-xs text-slate-500">Est. portfolio P&L impact</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Risk Drivers */}
        <Card title="Top Risk Drivers" accent="#f59e0b">
          {topRisk.length === 0 ? (
            <p className="text-sm text-slate-500">No risk data available yet.</p>
          ) : (
            topRisk.map(c => (
              <RiskBar key={c.iso3} label={`${c.name} (${c.iso3})`} value={c.sovereign_risk_score} />
            ))
          )}
        </Card>

        {/* Portfolio Exposure */}
        <Card title="Portfolio Exposure" accent="#ef4444">
          {worstExposures.length === 0 ? (
            <p className="text-sm text-slate-500">No portfolio exposure data.</p>
          ) : (
            <>
              {worstExposures.map(e => (
                <div key={e.country} className="flex items-center justify-between mb-3 text-sm">
                  <div>
                    <span className="text-slate-300 font-medium">{e.country}</span>
                    <span className="text-slate-500 text-xs ml-2">
                      {(e.portfolio_weight_exposed * 100).toFixed(1)}% weight
                    </span>
                  </div>
                  <span className={`font-mono text-xs ${e.shock_pct < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {e.shock_pct > 0 ? '+' : ''}{(e.shock_pct * 100).toFixed(2)}%
                  </span>
                </div>
              ))}
              {impact && (
                <div className="mt-4 pt-3 border-t flex justify-between text-xs" style={{ borderColor: '#1e1e2e' }}>
                  <span className="text-slate-500">Total portfolio shock</span>
                  <span className={`font-mono font-semibold ${impact.total_shock_pct < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    ${(impact.total_shock_usd / 1000).toFixed(1)}K ({(impact.total_shock_pct * 100).toFixed(2)}%)
                  </span>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Contagion Watch */}
        <Card title="Contagion Watch" accent="#3b82f6">
          {shownAlerts.length === 0 ? (
            <p className="text-sm text-slate-500">No active alerts — all systems stable.</p>
          ) : (
            shownAlerts.map(a => (
              <div key={a.id} className="mb-3 pb-3 border-b last:border-0 last:mb-0 last:pb-0" style={{ borderColor: '#1e1e2e' }}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 text-xs font-mono px-1.5 py-0.5 rounded shrink-0 ${
                    a.severity === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {a.severity.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs text-slate-300 font-medium">{a.country_iso3} · {a.trigger}</div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{a.message}</div>
                    {a.contagion_risk?.length > 0 && (
                      <div className="text-xs text-blue-400 mt-1">
                        Contagion: {a.contagion_risk.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>

        {/* Data Sources */}
        <Card title="Data Sources" accent="#64748b">
          <div className="space-y-3">
            {SOURCES.map(s => (
              <div key={s.name} className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: s.color }} />
                <div>
                  <div className="text-xs text-slate-300 font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t text-xs text-slate-600" style={{ borderColor: '#1e1e2e' }}>
            Risk model: 6-factor composite · NetworkX contagion graph · APScheduler 6h refresh
          </div>
        </Card>
      </div>
    </div>
  )
}
