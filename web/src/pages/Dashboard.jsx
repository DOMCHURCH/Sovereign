import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'

// ─── Constants ───────────────────────────────────────────────────────────────

const TIER_COLORS = {
  critical: '#ef4444',
  high:     '#f97316',
  elevated: '#fbbf24',
  low:      '#4ade80',
  severe:   '#f87171',
}

const TIER_BG = {
  critical: 'rgba(239,68,68,0.12)',
  high:     'rgba(249,115,22,0.12)',
  elevated: 'rgba(251,191,36,0.12)',
  low:      'rgba(74,222,128,0.12)',
  severe:   'rgba(248,113,113,0.12)',
}

// ISO3 → country flag emoji
const FLAG_MAP = {
  USA: '🇺🇸', CHN: '🇨🇳', JPN: '🇯🇵', DEU: '🇩🇪', GBR: '🇬🇧', FRA: '🇫🇷',
  IND: '🇮🇳', BRA: '🇧🇷', RUS: '🇷🇺', CAN: '🇨🇦', KOR: '🇰🇷', AUS: '🇦🇺',
  ITA: '🇮🇹', MEX: '🇲🇽', SAU: '🇸🇦', ZAF: '🇿🇦', SGP: '🇸🇬', HKG: '🇭🇰',
  TWN: '🇹🇼', ARG: '🇦🇷', TUR: '🇹🇷', IDN: '🇮🇩', NLD: '🇳🇱', CHE: '🇨🇭',
  IRN: '🇮🇷', IRQ: '🇮🇶', SYR: '🇸🇾', UKR: '🇺🇦', PRK: '🇰🇵', VEN: '🇻🇪',
  NGA: '🇳🇬', PAK: '🇵🇰', EGY: '🇪🇬', ISR: '🇮🇱', POL: '🇵🇱', NOR: '🇳🇴',
  SWE: '🇸🇪', ESP: '🇪🇸', THA: '🇹🇭', PHL: '🇵🇭', MYS: '🇲🇾', VNM: '🇻🇳',
  KEN: '🇰🇪', GHA: '🇬🇭', ETH: '🇪🇹', MAR: '🇲🇦', DZA: '🇩🇿', LBY: '🇱🇾',
  LBN: '🇱🇧', YEM: '🇾🇪', SDN: '🇸🇩', SSD: '🇸🇸', COD: '🇨🇩', ZWE: '🇿🇼',
  MMR: '🇲🇲', AFG: '🇦🇫', BLR: '🇧🇾', AZE: '🇦🇿', KAZ: '🇰🇿', UZB: '🇺🇿',
  QAT: '🇶🇦', KWT: '🇰🇼', OMN: '🇴🇲', ARE: '🇦🇪', JOR: '🇯🇴', COL: '🇨🇴',
  PER: '🇵🇪', CHL: '🇨🇱', CUB: '🇨🇺', NIC: '🇳🇮', HTI: '🇭🇹', BGD: '🇧🇩',
  MLI: '🇲🇱', NER: '🇳🇪', RWA: '🇷🇼', TZA: '🇹🇿', AGO: '🇦🇴',
}

// Ticker → flag emoji (for market movers)
const TICKER_FLAG = {
  SPY: '🇺🇸', FXI: '🇨🇳', EWJ: '🇯🇵', EWG: '🇩🇪', EWU: '🇬🇧',
  INDA: '🇮🇳', EWZ: '🇧🇷', ERUS: '🇷🇺', EWY: '🇰🇷', EWA: '🇦🇺',
  EWC: '🇨🇦', EWQ: '🇫🇷', EWI: '🇮🇹', EWW: '🇲🇽', KSA: '🇸🇦',
  EZA: '🇿🇦', EWS: '🇸🇬', EWH: '🇭🇰', EWT: '🇹🇼', ARGT: '🇦🇷',
  USO: '🛢️', GLD: '🥇', UNG: '⛽', WEAT: '🌾', CPER: '🔶',
}

const SUGGESTED_QUERIES = [
  "What's driving risk in Russia right now?",
  "If China escalates on Taiwan, what's my portfolio exposure?",
  "Which countries are most likely to default in 2026?",
]

// ─── Shimmer placeholder ──────────────────────────────────────────────────────

function ShimmerRow({ height = 44, className = '' }) {
  return (
    <div
      className={`shimmer rounded-lg ${className}`}
      style={{ height, minWidth: 0, minHeight: 44 }}
    />
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, valueColor, badge, onClick, loading, accentColor }) {
  return (
    <button
      onClick={onClick}
      className="glass-card glass-card-hover card-accent-top flex flex-col items-start p-4 md:p-5 w-full text-left transition-all group"
      style={{ cursor: onClick ? 'pointer' : 'default', minHeight: 44 }}
    >
      <div className="flex items-center justify-between w-full mb-2">
        <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">{label}</span>
        {badge && (
          <span
            className="text-xs font-mono font-bold px-2 py-0.5 rounded"
            style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
          >
            {badge}
          </span>
        )}
      </div>
      {loading ? (
        <div className="shimmer h-8 w-24 rounded" />
      ) : (
        <div
          className="text-2xl md:text-3xl font-mono font-bold leading-none"
          style={{ color: valueColor || 'var(--text)' }}
        >
          {value}
        </div>
      )}
      {sub && (
        <div className="mt-1.5 text-xs text-slate-500 truncate max-w-full">{sub}</div>
      )}
      {onClick && (
        <div
          className="mt-3 text-xs font-mono opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: accentColor || 'var(--accent)' }}
        >
          View details →
        </div>
      )}
    </button>
  )
}

// ─── GTI Leaderboard ─────────────────────────────────────────────────────────

function GTILeaderboard({ data, loading, navigate }) {
  const top10 = [...data]
    .sort((a, b) => (b.gti ?? 0) - (a.gti ?? 0))
    .slice(0, 10)

  const maxScore = top10[0]?.gti ?? 100

  return (
    <div className="glass-card card-accent-top p-4 md:p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">GTI Leaderboard</h2>
        <span className="text-xs text-slate-600 font-mono">Top 10 Countries</span>
      </div>

      <div className="flex flex-col gap-1.5 flex-1">
        {loading
          ? Array.from({ length: 10 }).map((_, i) => (
              <ShimmerRow key={i} height={44} className="w-full" />
            ))
          : top10.map((country, i) => {
              const tier = country.tier || 'low'
              const tierColor = TIER_COLORS[tier] || TIER_COLORS.low
              const fillPct = maxScore > 0 ? ((country.gti ?? 0) / maxScore) * 100 : 0

              return (
                <button
                  key={country.iso3 || i}
                  onClick={() => navigate(`/country/${country.iso3}`)}
                  className="w-full flex items-center gap-2 sm:gap-3 px-2 py-1.5 rounded-lg transition-colors text-left group"
                  style={{ background: 'transparent', minHeight: 44 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Rank */}
                  <span className="font-mono text-xs w-4 shrink-0 text-right"
                        style={{ color: i < 3 ? tierColor : '#475569' }}>
                    {i + 1}
                  </span>

                  {/* Name */}
                  <span className="text-sm text-slate-300 w-20 sm:w-24 shrink-0 truncate group-hover:text-slate-100 transition-colors">
                    {country.name || country.iso3}
                  </span>

                  {/* Bar */}
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${fillPct}%`,
                        background: `linear-gradient(90deg, ${tierColor}99, ${tierColor})`,
                        boxShadow: i < 3 ? `0 0 8px ${tierColor}55` : 'none',
                      }}
                    />
                  </div>

                  {/* Score */}
                  <span className="font-mono text-xs font-bold w-10 text-right shrink-0"
                        style={{ color: tierColor }}>
                    {country.gti != null ? country.gti.toFixed(1) : '—'}
                  </span>

                  {/* Tier badge */}
                  <span
                    className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide"
                    style={{
                      background: TIER_BG[tier] || TIER_BG.low,
                      color: tierColor,
                      fontSize: '10px',
                      minWidth: '52px',
                      textAlign: 'center',
                      border: `1px solid ${tierColor}33`,
                    }}
                  >
                    {tier}
                  </span>
                </button>
              )
            })
        }
      </div>
    </div>
  )
}

// ─── Alert Feed ───────────────────────────────────────────────────────────────

const SEVERITY_ICON = {
  critical: '🔴',
  warning:  '⚠️',
  watch:    '👁',
}

function AlertsFeed({ alerts, loading, onAcknowledge, countries }) {
  const countryMap = {}
  countries.forEach(c => { countryMap[c.iso3] = c.name })

  const visible = alerts.filter(a => !a.acknowledged).slice(0, 8)

  return (
    <div className="glass-card card-accent-top p-4 md:p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">Active Alerts</h2>
        {!loading && visible.length > 0 && (
          <span
            className="text-xs font-mono font-bold px-2 py-0.5 rounded"
            style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
          >
            {visible.length} unread
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 flex-1 overflow-y-auto" style={{ maxHeight: 420 }}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <ShimmerRow key={i} height={52} className="w-full" />
          ))
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-10 gap-2">
            <div className="text-3xl">✅</div>
            <div className="text-sm font-mono text-green-400">All clear</div>
            <div className="text-xs text-slate-600">No active alerts</div>
          </div>
        ) : (
          visible.map(alert => {
            const icon = SEVERITY_ICON[alert.severity] || '👁'
            const countryName = countryMap[alert.iso3] || alert.iso3 || '—'
            const msg = alert.message || alert.description || ''
            const truncated = msg.length > 80 ? msg.slice(0, 80) + '…' : msg

            const severityColor =
              alert.severity === 'critical' ? '#f87171' :
              alert.severity === 'warning'  ? '#fbbf24' :
                                              '#818cf8'

            return (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-3 rounded-lg transition-all"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderLeft: `3px solid ${severityColor}`,
                }}
              >
                <span className="text-base shrink-0 leading-tight mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono font-semibold text-slate-300 truncate">{countryName}</span>
                    <span
                      className="text-xs font-mono uppercase tracking-wide shrink-0"
                      style={{ color: severityColor }}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{truncated}</p>
                </div>
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors text-xs font-mono font-bold"
                  style={{
                    background: 'rgba(74,222,128,0.08)',
                    border: '1px solid rgba(74,222,128,0.2)',
                    color: '#4ade80',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(74,222,128,0.18)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(74,222,128,0.08)'}
                  title="Acknowledge"
                >
                  ✓
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── News Intelligence ────────────────────────────────────────────────────────

function NewsFeed({ articles, loading }) {
  if (loading) {
    return (
      <div className="glass-card card-accent-top p-4 md:p-5 flex flex-col h-full">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest mb-4">News Intelligence</h2>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <ShimmerRow key={i} height={54} className="w-full" />
          ))}
        </div>
      </div>
    )
  }

  const items = articles.slice(0, 12)

  return (
    <div className="glass-card card-accent-top p-4 md:p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">News Intelligence</h2>
        <span className="text-xs text-slate-600 font-mono">{items.length} articles</span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-12 gap-2 text-center">
          <div className="text-3xl">📡</div>
          <div className="text-sm text-slate-500">Run ingest to populate news feed</div>
          <div className="text-xs text-slate-700 mt-1">Use the /ingest/run endpoint to fetch latest articles</div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1" style={{ maxHeight: 520 }}>
          {items.map((article, i) => {
            const sentiment = article.sentiment_score ?? article.sentiment ?? 0
            const sentimentColor =
              sentiment < -0.1 ? '#f87171' :
              sentiment >  0.1 ? '#4ade80' :
                                 '#94a3b8'

            const title = article.title || article.headline || 'Untitled'
            const source = article.source || article.publisher || ''
            const eventType = article.event_type || article.category || ''
            const url = article.url || article.link || '#'

            return (
              <a
                key={article.id || i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 p-3 rounded-lg transition-all group"
                style={{
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderLeft: `3px solid ${sentimentColor}`,
                  textDecoration: 'none',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                  e.currentTarget.style.borderColor = `${sentimentColor}66`
                  e.currentTarget.style.borderLeftColor = sentimentColor
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.borderColor = 'transparent'
                  e.currentTarget.style.borderLeftColor = sentimentColor
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300 leading-snug mb-1.5 group-hover:text-slate-100 transition-colors line-clamp-2">
                    {title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {source && (
                      <span className="text-xs text-slate-600">{source}</span>
                    )}
                    {eventType && (
                      <span
                        className="text-xs font-mono px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}
                      >
                        {eventType}
                      </span>
                    )}
                    <span
                      className="text-xs font-mono ml-auto shrink-0"
                      style={{ color: sentimentColor }}
                    >
                      {sentiment >= 0 ? '+' : ''}{sentiment.toFixed(2)}
                    </span>
                  </div>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Market Movers ────────────────────────────────────────────────────────────

function MarketMovers({ snapshot, loading }) {
  const raw = snapshot?.equities
  const equities = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([ticker, v]) => ({ ticker, ...v }))
      : []

  const sorted = [...equities]
    .filter(e => e.change_pct != null)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, 8)

  return (
    <div className="glass-card card-accent-top p-4 md:p-5 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-mono text-slate-400 uppercase tracking-widest">Market Movers</h2>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ boxShadow: '0 0 5px rgba(74,222,128,0.8)' }} />
          <span className="text-xs text-green-400 font-mono">LIVE</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 flex-1">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <ShimmerRow key={i} height={44} className="w-full" />
          ))
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 py-10">
            <div className="text-xs text-slate-600">No market data available</div>
          </div>
        ) : (
          sorted.map((eq, i) => {
            const isUp = eq.change_pct >= 0
            const changeColor = isUp ? '#4ade80' : '#f87171'
            const flag = TICKER_FLAG[eq.ticker] || ''

            return (
              <div
                key={eq.ticker || i}
                className="flex items-center gap-2 px-2 py-2 rounded-lg"
                style={{
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  minHeight: 44,
                }}
              >
                {/* Flag + Ticker */}
                <div className="flex items-center gap-1.5 w-20 shrink-0">
                  {flag && <span className="text-sm">{flag}</span>}
                  <span className="font-mono text-xs font-bold text-indigo-300 truncate">{eq.ticker}</span>
                </div>

                {/* Spacer + Price */}
                <div className="flex-1" />
                {eq.price != null && (
                  <span className="font-mono text-xs text-slate-400 mr-1">
                    ${typeof eq.price === 'number' ? eq.price.toFixed(2) : eq.price}
                  </span>
                )}

                {/* Change pct */}
                <span
                  className="font-mono text-xs font-bold w-16 text-right shrink-0"
                  style={{ color: changeColor }}
                >
                  {isUp ? '▲' : '▼'} {Math.abs(eq.change_pct).toFixed(2)}%
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Analyst CTA Strip ────────────────────────────────────────────────────────

function AnalystCTA({ navigate }) {
  return (
    <div
      className="rounded-xl px-4 py-5 md:px-6 md:py-6 flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-8"
      style={{
        background: 'linear-gradient(135deg, rgba(49,46,129,0.6) 0%, rgba(67,56,202,0.4) 50%, rgba(109,40,217,0.35) 100%)',
        border: '1px solid rgba(99,102,241,0.3)',
        boxShadow: '0 0 40px rgba(99,102,241,0.1)',
      }}
    >
      {/* Left: Title */}
      <div className="shrink-0">
        <div className="text-base font-semibold text-slate-200">Ask the Analyst</div>
        <div className="text-xs text-slate-400 mt-0.5">Natural language queries across all 50+ countries</div>
      </div>

      {/* Center: Suggested queries */}
      <div className="flex-1 flex items-center gap-3 flex-wrap w-full md:w-auto">
        {SUGGESTED_QUERIES.map((q, i) => (
          <button
            key={i}
            onClick={() => navigate(`/analyst?q=${encodeURIComponent(q)}`)}
            className="text-xs px-3 py-2 rounded-lg transition-all text-left"
            style={{
              background: 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              color: '#c4b5fd',
              maxWidth: '220px',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(99,102,241,0.28)'
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(99,102,241,0.15)'
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'
            }}
          >
            "{q}"
          </button>
        ))}
      </div>

      {/* Right: CTA button */}
      <button
        onClick={() => navigate('/analyst')}
        className="shrink-0 w-full md:w-auto px-6 py-3 rounded-xl font-semibold text-sm transition-all"
        style={{
          background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
          color: '#fff',
          boxShadow: '0 4px 20px rgba(99,102,241,0.35)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.boxShadow = '0 4px 28px rgba(99,102,241,0.55)'
          e.currentTarget.style.transform = 'translateY(-1px)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.35)'
          e.currentTarget.style.transform = 'translateY(0)'
        }}
      >
        Open Analyst →
      </button>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [countries, setCountries] = useState([])
  const [alerts, setAlerts]     = useState([])
  const [gtiData, setGtiData]   = useState([])
  const [portfolio, setPortfolio] = useState(null)
  const [news, setNews]         = useState([])
  const [snapshot, setSnapshot] = useState(null)

  const loadData = useCallback(async () => {
    try {
      const [countriesRes, alertsRes, gtiRes, portfolioRes, newsRes, snapshotRes] =
        await Promise.all([
          api.countries().catch(() => []),
          api.alerts().catch(() => []),
          api.gti().catch(() => []),
          api.portfolioImpact().catch(() => null),
          api.newsFeed().catch(() => []),
          api.marketSnapshot().catch(() => null),
        ])

      setCountries(countriesRes || [])
      setAlerts(alertsRes || [])
      setGtiData(Array.isArray(gtiRes) ? gtiRes : (gtiRes?.countries || []))
      setPortfolio(portfolioRes)
      setNews(Array.isArray(newsRes) ? newsRes : (newsRes?.articles || []))
      setSnapshot(snapshotRes)
    } catch {
      // silent error — show empty states
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleAcknowledge = useCallback(async (id) => {
    try {
      await api.acknowledgeAlert(id)
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a))
    } catch {
      // silent
    }
  }, [])

  // ── Derived values ──────────────────────────────────────────────────────────

  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged)
  const criticalAndWarning   = unacknowledgedAlerts.filter(
    a => a.severity === 'critical' || a.severity === 'warning'
  )

  // Top country by GTI
  const topGTI = [...gtiData].sort((a, b) => (b.gti ?? 0) - (a.gti ?? 0))[0]
  const topGTITier  = topGTI?.tier || 'low'
  const topGTIColor = TIER_COLORS[topGTITier] || TIER_COLORS.low

  // Portfolio impact
  const portfolioShock = portfolio?.total_shock_pct ?? null
  const portfolioColor = portfolioShock == null
    ? 'var(--text)'
    : portfolioShock < 0 ? '#f87171' : '#4ade80'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fade-in max-w-screen-xl mx-auto px-3 py-4 md:px-6 md:py-6 space-y-6" style={{ minWidth: 0 }}>

      {/* ── Page header ── */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1
            className="text-lg md:text-xl font-bold tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #e2e8f0 0%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Command Center
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">
            Geopolitical risk intelligence · {new Date().toUTCString().slice(0, 25)} UTC
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-2 h-2 rounded-full bg-green-400" style={{ boxShadow: '0 0 8px rgba(74,222,128,0.8)' }} />
          <span className="text-xs text-green-400 font-mono hidden sm:inline">LIVE MONITORING</span>
          <span className="text-xs text-green-400 font-mono sm:hidden">LIVE</span>
        </div>
      </div>

      {/* ── Stat bar (2 cols mobile/tablet, 4 cols desktop) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Active Alerts"
          value={loading ? '—' : criticalAndWarning.length}
          sub={loading ? '' : `${unacknowledgedAlerts.length} total unacknowledged`}
          valueColor={criticalAndWarning.length > 0 ? '#f87171' : '#4ade80'}
          badge={criticalAndWarning.length > 0 ? `${criticalAndWarning.length} critical` : null}
          onClick={() => navigate('/globe')}
          loading={loading}
          accentColor="#f87171"
        />
        <StatCard
          label="Highest GTI"
          value={loading ? '—' : (topGTI?.gti?.toFixed(1) ?? '—')}
          sub={topGTI?.name || topGTI?.iso3 || '—'}
          valueColor={topGTIColor}
          onClick={topGTI?.iso3 ? () => navigate(`/country/${topGTI.iso3}`) : undefined}
          loading={loading}
          accentColor={topGTIColor}
        />
        <StatCard
          label="Portfolio Impact"
          value={
            loading ? '—' :
            portfolioShock == null ? '—' :
            `${portfolioShock >= 0 ? '+' : ''}${portfolioShock.toFixed(2)}%`
          }
          sub="Total shock exposure"
          valueColor={portfolioColor}
          onClick={() => navigate('/markets')}
          loading={loading}
          accentColor="#f87171"
        />
        <StatCard
          label="Active Conflicts"
          value="30"
          sub="conflicts monitored globally"
          valueColor="#fb923c"
          onClick={() => navigate('/globe')}
          loading={false}
          accentColor="#fb923c"
        />
      </div>

      {/* ── Middle row: GTI Leaderboard + Alert Feed ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ alignItems: 'start' }}>
        <GTILeaderboard
          data={gtiData}
          loading={loading}
          navigate={navigate}
        />
        <AlertsFeed
          alerts={alerts}
          loading={loading}
          onAcknowledge={handleAcknowledge}
          countries={countries}
        />
      </div>

      {/* ── Bottom row: News + Market Movers ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ alignItems: 'start' }}>
        <NewsFeed articles={news} loading={loading} />
        <MarketMovers snapshot={snapshot} loading={loading} />
      </div>

      {/* ── Analyst CTA strip ── */}
      <AnalystCTA navigate={navigate} />

    </div>
  )
}
