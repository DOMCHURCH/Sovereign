import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, streamAnalyst } from '../api'

const COUNTRY_ETFS = {
  USA:'SPY', CHN:'FXI', JPN:'EWJ', DEU:'EWG', GBR:'EWU',
  IND:'INDA', BRA:'EWZ', RUS:'ERUS', KOR:'EWY', AUS:'EWA',
  CAN:'EWC', FRA:'EWQ', ITA:'EWI', MEX:'EWW', SAU:'KSA',
  ZAF:'EZA', SGP:'EWS', HKG:'EWH', TWN:'EWT', ARG:'ARGT',
}

const ETF_TO_ISO3 = Object.fromEntries(Object.entries(COUNTRY_ETFS).map(([k,v])=>[v,k]))

const TIER_COLORS = {
  low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444',
}

const TIER_BG = {
  low: 'rgba(34,197,94,0.08)', elevated: 'rgba(234,179,8,0.08)',
  high: 'rgba(249,115,22,0.08)', severe: 'rgba(239,68,68,0.08)',
}

const COMMODITIES = [
  { ticker: 'USO', name: 'Crude Oil', type: 'commodity' },
  { ticker: 'GLD', name: 'Gold', type: 'commodity' },
  { ticker: 'UNG', name: 'Natural Gas', type: 'commodity' },
  { ticker: 'WEAT', name: 'Wheat', type: 'commodity' },
  { ticker: 'CPER', name: 'Copper', type: 'commodity' },
]

export default function Markets() {
  const navigate = useNavigate()
  const [countries, setCountries] = useState([])
  const [loading, setLoading] = useState(true)
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    api.countries()
      .then(data => { setCountries(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (countries.length === 0) return
    const top5 = [...countries]
      .filter(c => c.sovereign_risk_score != null)
      .sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score)
      .slice(0, 5)
    const prompt = `Analyze geopolitical market risk for institutional investors. The 5 highest-risk countries with ETF exposure are: ${top5.map(c => `${c.name} (${COUNTRY_ETFS[c.iso3] || 'no ETF'}, sovereign risk score ${c.sovereign_risk_score?.toFixed(1)}, tier: ${c.risk_tier})`).join('; ')}. Which ETFs face the most immediate geopolitical danger and why? Focus on risk transmission channels and macro drivers — do not invent or cite specific ETF price levels, returns, or performance numbers not provided here. Answer in 3 sentences.`
    setAiLoading(true)
    streamAnalyst(prompt, [], null,
      chunk => setAiInsight(prev => prev + chunk),
      () => setAiLoading(false),
    ).catch(() => setAiLoading(false))
  }, [countries.length])

  const etfRows = countries
    .filter(c => COUNTRY_ETFS[c.iso3])
    .map(c => ({
      ticker: COUNTRY_ETFS[c.iso3],
      iso3: c.iso3,
      name: c.name,
      score: c.sovereign_risk_score,
      tier: c.risk_tier,
      delta: c.risk_delta_7d,
      drivers: c.top_risk_drivers,
      sanctions: c.is_primary_sanctions_target,
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  const dangerCount = etfRows.filter(r => r.tier === 'severe' || r.tier === 'high').length

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-200">Markets at Risk</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {etfRows.length} country ETFs · {dangerCount} high/severe risk · live sovereign scores
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold text-red-400">{dangerCount}</div>
          <div className="text-xs text-slate-500">ETFs at elevated risk</div>
        </div>
      </div>

      {/* AI Market Brief */}
      <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-mono text-indigo-400 uppercase tracking-widest">AI Market Brief</h3>
          {aiLoading && <span className="text-xs text-slate-600 animate-pulse">analyzing...</span>}
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          {aiInsight || (aiLoading ? '' : (loading ? 'Loading...' : 'No analysis available.'))}
        </p>
      </div>

      {/* ETF Table */}
      {loading ? (
        <div className="text-center text-slate-500 text-sm py-12">Loading market data...</div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#1e1e2e' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-mono text-slate-500 uppercase tracking-widest border-b" style={{ background: '#0d0d14', borderColor: '#1e1e2e' }}>
                <th className="px-4 py-2 text-left">ETF</th>
                <th className="px-4 py-2 text-left">Country</th>
                <th className="px-4 py-2 text-center">Tier</th>
                <th className="px-4 py-2 text-right">Risk Score</th>
                <th className="px-4 py-2 text-right">7D Δ</th>
                <th className="px-4 py-2 text-left">Top Driver</th>
              </tr>
            </thead>
            <tbody>
              {etfRows.map((row, i) => (
                <tr
                  key={row.ticker}
                  className="border-b cursor-pointer transition-colors hover:bg-white/5"
                  style={{ borderColor: '#1e1e2e', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
                  onClick={() => navigate(`/country/${row.iso3}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-300">{row.ticker}</span>
                      {row.sanctions && <span className="text-xs text-red-400 font-mono">SANCTIONS</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{row.name}</td>
                  <td className="px-4 py-3 text-center">
                    {row.tier ? (
                      <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold"
                            style={{ background: TIER_BG[row.tier], color: TIER_COLORS[row.tier] }}>
                        {row.tier.toUpperCase()}
                      </span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold"
                      style={{ color: row.tier ? TIER_COLORS[row.tier] : '#64748b' }}>
                    {row.score?.toFixed(1) ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs"
                      style={{ color: row.delta > 1 ? '#ef4444' : row.delta < -1 ? '#22c55e' : '#64748b' }}>
                    {row.delta != null ? `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(1)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{row.drivers?.[0] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Commodities */}
      <div>
        <h2 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Commodities</h2>
        <div className="grid grid-cols-5 gap-3">
          {COMMODITIES.map(c => (
            <div key={c.ticker} className="rounded-lg border p-3 text-center" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
              <div className="font-mono font-bold text-slate-200 text-sm">{c.ticker}</div>
              <div className="text-xs text-slate-500 mt-0.5">{c.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
