import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList,
} from 'recharts'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'
import RiskGauge from '../components/RiskGauge'
import AlertFeed from '../components/AlertFeed'

const TIER_COLORS = {
  low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444',
}

const SUB_LABELS = {
  political_instability: 'Political',
  macro_stress: 'Macro',
  market_stress: 'Market',
  sanctions_exposure: 'Sanctions',
  governance_deficit: 'Governance',
  sentiment_deterioration: 'Sentiment',
}

function fmt(v, decimals = 1) {
  if (v == null) return '—'
  return typeof v === 'number' ? v.toFixed(decimals) : v
}

function StatCard({ label, value, unit = '', color }) {
  return (
    <div className="rounded-lg p-3 border" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-base font-mono font-semibold" style={{ color: color || '#e2e8f0' }}>
        {value ?? '—'}{value != null && unit ? unit : ''}
      </div>
    </div>
  )
}

export default function Country() {
  const { iso3 } = useParams()
  const navigate = useNavigate()
  const [country, setCountry] = useState(null)
  const [history, setHistory] = useState([])
  const [contagion, setContagion] = useState(null)
  const [impact, setImpact] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.country(iso3),
      api.countryHistory(iso3),
      api.countryContagion(iso3),
      api.portfolioImpact(),
    ]).then(([c, h, ct, imp]) => {
      setCountry(c)
      setHistory(h.slice(-90))
      setContagion(ct)
      setImpact(imp)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [iso3])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 font-mono text-sm">
        Loading {iso3}...
      </div>
    )
  }

  if (!country) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-slate-400">Country not found: {iso3}</p>
        <button onClick={() => navigate('/')} className="text-indigo-400 text-sm hover:underline">← Back to Globe</button>
      </div>
    )
  }

  const sub = country.sub_scores || {}
  const subData = Object.entries(SUB_LABELS)
    .filter(([k]) => sub[k] != null)
    .map(([k, label]) => ({ name: label, value: Math.round(sub[k]) }))
    .sort((a, b) => b.value - a.value)

  const histData = history.map(h => ({
    date: h.date?.slice(0, 10),
    score: parseFloat(h.score?.toFixed(1)),
  }))

  const delta = country.risk_delta_7d
  const deltaStr = delta != null
    ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts this week`
    : ''
  const deltaColor = delta > 5 ? '#ef4444' : delta > 1 ? '#f97316' : delta < -1 ? '#22c55e' : '#64748b'

  const myTicker = {
    USA:'SPY',CHN:'FXI',JPN:'EWJ',DEU:'EWG',GBR:'EWU',IND:'INDA',
    BRA:'EWZ',RUS:'ERUS',KOR:'EWY',AUS:'EWA',CAN:'EWC',FRA:'EWQ',
    ITA:'EWI',MEX:'EWW',SAU:'KSA',ZAF:'EZA',SGP:'EWS',HKG:'EWH',TWN:'EWT',ARG:'ARGT',
  }[iso3]

  const portfolioPos = impact?.position_attribution?.find(p => p.ticker === myTicker)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => navigate('/')} className="text-xs text-indigo-400 hover:underline mb-2 block">
            ← Globe
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{country.name}</h1>
            <span className="font-mono text-slate-500">{iso3}</span>
            <RiskBadge tier={country.risk_tier} />
            {delta != null && (
              <span className="text-sm font-mono" style={{ color: deltaColor }}>
                {delta >= 0 ? '↑' : '↓'} {deltaStr}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-sm mt-1">{country.region}</p>
        </div>
        <div className="text-center">
          <RiskGauge score={country.sovereign_risk_score} size={96} />
          <div className="text-xs text-slate-500 mt-1">Risk Score / 100</div>
        </div>
      </div>

      {/* Top row: sub-scores + macro stats */}
      <div className="grid grid-cols-2 gap-4">
        {/* Sub-score bar chart */}
        <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Risk Factor Breakdown</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={subData} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="name" width={80} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {subData.map((entry) => (
                  <Cell key={entry.name}
                        fill={entry.value > 75 ? '#ef4444' : entry.value > 50 ? '#f97316' : entry.value > 25 ? '#eab308' : '#22c55e'} />
                ))}
                <LabelList dataKey="value" position="right" style={{ fill: '#94a3b8', fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Macro stats */}
        <div className="grid grid-cols-2 gap-2 content-start">
          <StatCard label="GDP (USD)" value={country.gdp_usd ? `$${(country.gdp_usd / 1e12).toFixed(2)}T` : null} />
          <StatCard label="GDP Growth" value={fmt(country.gdp_growth_pct)} unit="%" />
          <StatCard label="Inflation" value={fmt(country.inflation_pct)} unit="%"
                    color={country.inflation_pct > 10 ? '#ef4444' : country.inflation_pct > 5 ? '#f97316' : undefined} />
          <StatCard label="Govt Debt / GDP" value={fmt(country.govt_debt_pct_gdp)} unit="%"
                    color={country.govt_debt_pct_gdp > 100 ? '#ef4444' : undefined} />
          <StatCard label="Political Stability" value={fmt(country.political_stability_score)}
                    color={country.political_stability_score < -1 ? '#ef4444' : country.political_stability_score > 0.5 ? '#22c55e' : undefined} />
          <StatCard label="News Sentiment" value={fmt(country.news_sentiment_7d)}
                    color={country.news_sentiment_7d < -0.3 ? '#ef4444' : country.news_sentiment_7d > 0.1 ? '#22c55e' : undefined} />
          <StatCard label="Sanctions Entities" value={country.sanctions_entity_count}
                    color={country.is_primary_sanctions_target ? '#ef4444' : undefined} />
          <StatCard label="Equity Return 1Y" value={country.equity_return_1y != null ? `${(country.equity_return_1y * 100).toFixed(1)}%` : null}
                    color={country.equity_return_1y < -0.1 ? '#ef4444' : country.equity_return_1y > 0.1 ? '#22c55e' : undefined} />
        </div>
      </div>

      {/* 90-day history */}
      {histData.length > 0 && (
        <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">90-Day Risk Score History</h3>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={histData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e2e" />
              <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} width={28} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#12121a', border: '1px solid #1e1e2e', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#6366f1' }}
              />
              <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2}
                    dot={false} activeDot={{ r: 4, fill: '#6366f1' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Bottom row: portfolio + alerts + contagion */}
      <div className="grid grid-cols-3 gap-4">
        {/* Portfolio */}
        <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Portfolio Exposure</h3>
          {myTicker ? (
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-mono text-indigo-400">{myTicker}</span>
                {portfolioPos && (
                  <span className="text-slate-400 ml-2">{(portfolioPos.weight * 100).toFixed(0)}% weight</span>
                )}
              </div>
              {portfolioPos && (
                <div className="text-sm">
                  <span className="text-slate-400">Shock est.: </span>
                  <span className={portfolioPos.shock_contribution_pct < 0 ? 'text-red-400' : 'text-green-400'}>
                    {(portfolioPos.shock_contribution_pct * 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {!portfolioPos && (
                <p className="text-xs text-slate-500">No current P&amp;L impact estimated</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No direct ETF exposure in demo portfolio</p>
          )}
          <button
            onClick={() => navigate(`/analyst?country=${iso3}`)}
            className="mt-4 w-full text-xs px-3 py-2 rounded border text-indigo-400 hover:bg-indigo-600/10 transition-colors"
            style={{ borderColor: '#4f46e5' }}>
            Ask analyst about {country.name} →
          </button>
        </div>

        {/* Alerts */}
        <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Active Alerts</h3>
          <AlertFeed limit={4} compact />
        </div>

        {/* Contagion */}
        <div className="rounded-xl border p-4" style={{ background: '#12121a', borderColor: '#1e1e2e' }}>
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Contagion Channels</h3>
          {contagion?.direct_edges?.length > 0 ? (
            <div className="space-y-1.5">
              {contagion.direct_edges.slice(0, 6).map(e => (
                <div key={e.target} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-400 w-8">{e.target}</span>
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: '#1e1e2e' }}>
                    <div className="h-1.5 rounded-full"
                         style={{ width: `${e.weight * 100}%`, background: '#6366f1' }} />
                  </div>
                  <span className="font-mono text-slate-500 w-20 text-right">{e.channel}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No contagion data — run ingest first</p>
          )}
        </div>
      </div>
    </div>
  )
}
