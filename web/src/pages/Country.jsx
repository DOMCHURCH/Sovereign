import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList,
} from 'recharts'
import { api, streamAnalyst } from '../api'
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
    <div className="glass-card card-accent-top rounded-xl p-3">
      <div className="text-xs text-slate-500 mb-1.5 font-mono uppercase tracking-wide">{label}</div>
      <div className="text-base font-mono font-bold" style={{ color: color || '#c4b5fd' }}>
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
  const [aiInsight, setAiInsight] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [news, setNews] = useState([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [weatherData, setWeatherData] = useState(null)

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
    api.countryWeather(iso3).then(d => { if (d && d.iso3) setWeatherData(d) }).catch(() => {})
  }, [iso3])

  useEffect(() => {
    if (!country) return
    setAiInsight('')
    setAiLoading(true)
    const prompt = `Give me a concise 3-sentence risk assessment of ${country.name} for an institutional investor. Risk score: ${country.sovereign_risk_score?.toFixed(1)} (${country.risk_tier}). Top drivers: ${country.top_risk_drivers?.join(', ') || 'none'}. Inflation: ${country.inflation_pct}%, debt/GDP: ${country.govt_debt_pct_gdp}%, political stability: ${country.political_stability_score?.toFixed(2)}, sanctions entities: ${country.sanctions_entity_count}.`
    streamAnalyst(prompt, [], country.iso3, (chunk) => {
      setAiInsight(prev => prev + chunk)
    }, () => setAiLoading(false)).catch(() => setAiLoading(false))
  }, [country?.iso3])

  useEffect(() => {
    if (!iso3) return
    setNews([])
    setNewsLoading(true)
    // Try new RSS-based feed first, fall back to legacy news endpoint
    api.newsFeed(iso3)
      .then(d => { if (d.length) setNews(d); else return api.countryNews(iso3).then(setNews) })
      .catch(() => api.countryNews(iso3).then(setNews).catch(() => {}))
      .finally(() => setNewsLoading(false))
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

  const downloadReport = async () => {
    try {
      const data = await api.countryReport(iso3)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${iso3}-sovereign-report.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

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
        <div className="flex flex-col items-end gap-2">
          <div className="text-center">
            <RiskGauge score={country.sovereign_risk_score} size={96} />
            <div className="text-xs text-slate-500 mt-1">Risk Score / 100</div>
          </div>
          <button
            onClick={downloadReport}
            className="text-xs px-3 py-1.5 rounded-lg font-mono transition-colors"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}
          >
            ↓ Export Report
          </button>
        </div>
      </div>

      {/* AI Risk Assessment */}
      <div className="glass-card card-accent-top rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
               style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h3 className="text-xs font-mono font-semibold uppercase tracking-widest" style={{ color: '#a78bfa' }}>AI Risk Assessment</h3>
          {aiLoading && (
            <span className="flex items-center gap-1 text-xs text-slate-600 ml-1">
              <span className="w-3 h-3 border border-slate-600 border-t-indigo-500 rounded-full animate-spin" />
              analyzing
            </span>
          )}
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          {aiInsight || (aiLoading ? <span className="shimmer inline-block w-full h-4 rounded" /> : 'No analysis available.')}
        </p>
      </div>

      {/* Weather Card */}
      {weatherData && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-4"
             style={{
               background: weatherData.is_severe ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
               border: `1px solid ${weatherData.is_severe ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.07)'}`,
             }}>
          <span style={{ fontSize: '28px', lineHeight: 1 }}>{weatherData.weather_emoji}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">
                {weatherData.temp_c != null ? `${weatherData.temp_c.toFixed(1)}°C` : '—'}
              </span>
              <span className="text-xs text-slate-500">{weatherData.weather_label}</span>
              <span className="text-xs text-slate-600">· Wind {weatherData.wind_kmh?.toFixed(0)} km/h</span>
            </div>
            {weatherData.is_severe && (
              <div className="text-xs font-semibold mt-0.5" style={{ color: '#fbbf24' }}>
                ⚠️ Severe weather alert active
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top row: sub-scores + macro stats */}
      <div className="grid grid-cols-2 gap-4">
        {/* Sub-score bar chart */}
        <div className="glass-card rounded-xl p-4">
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
        <div className="glass-card rounded-xl p-4">
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
        <div className="glass-card rounded-xl p-4">
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
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">Active Alerts</h3>
          <AlertFeed limit={4} compact />
        </div>

        {/* Contagion */}
        <div className="glass-card rounded-xl p-4">
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
            <p className="text-xs text-slate-500">No contagion edges detected — this country has no significant cross-border risk linkages in the current model.</p>
          )}
        </div>
      </div>

      {/* News Intelligence Feed */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-widest">News Intelligence</h3>
          {newsLoading && <span className="text-xs text-slate-600 animate-pulse">fetching...</span>}
        </div>
        {news.length === 0 && !newsLoading ? (
          <p className="text-xs text-slate-600">No news — run ingest to populate RSS feeds.</p>
        ) : (
          <div className="space-y-2.5">
            {news.map((article, i) => {
              const sentiment = article.sentiment ?? article.sentiment_score
              const sentColor = sentiment < -0.3 ? '#f87171' : sentiment > 0.2 ? '#4ade80' : '#64748b'
              const eventColors = {
                military_conflict: '#ef4444', sanctions: '#f97316', trade_dispute: '#fbbf24',
                diplomatic_crisis: '#a78bfa', terrorism: '#ff6b6b', political_instability: '#fb923c',
                economic_crisis: '#ef4444', humanitarian: '#22d3ee', general: '#475569',
              }
              const evtColor = eventColors[article.event_type] || '#475569'
              return (
                <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                   className="block hover:bg-white/5 rounded-lg p-2.5 -mx-2 transition-colors group border border-transparent hover:border-white/5">
                  <div className="flex items-start gap-2.5">
                    {/* Sentiment bar */}
                    <div className="w-0.5 rounded-full shrink-0 mt-1"
                         style={{ height: 40, background: sentColor, opacity: 0.8 }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-300 group-hover:text-white transition-colors leading-snug line-clamp-2">
                        {article.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-xs font-mono text-slate-600">{article.source}</span>
                        {article.published_at && (
                          <span className="text-xs text-slate-700">
                            {new Date(article.published_at).toLocaleDateString()}
                          </span>
                        )}
                        {article.event_type && article.event_type !== 'general' && (
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                                style={{ background: `${evtColor}18`, color: evtColor, border: `1px solid ${evtColor}33` }}>
                            {article.event_type.replace(/_/g, ' ')}
                          </span>
                        )}
                        {sentiment != null && (
                          <span className="text-xs font-mono ml-auto" style={{ color: sentColor }}>
                            {sentiment >= 0 ? '+' : ''}{sentiment.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
