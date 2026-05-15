import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'
import AlertFeed from '../components/AlertFeed'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

const TIER_COLORS = {
  low:      '#22c55e',
  elevated: '#eab308',
  high:     '#f97316',
  severe:   '#ef4444',
  none:     '#1e293b',
}

// ISO numeric → ISO3 mapping (subset of most represented countries)
const NUM_TO_ISO3 = {
  840: 'USA', 156: 'CHN', 392: 'JPN', 276: 'DEU', 826: 'GBR',
  356: 'IND', 76:  'BRA', 643: 'RUS', 410: 'KOR', 36:  'AUS',
  124: 'CAN', 250: 'FRA', 380: 'ITA', 484: 'MEX', 682: 'SAU',
  710: 'ZAF', 702: 'SGP', 344: 'HKG', 158: 'TWN', 32:  'ARG',
  792: 'TUR', 862: 'VEN', 192: 'CUB', 112: 'BLR', 586: 'PAK',
  4:   'AFG', 804: 'UKR', 566: 'NGA', 818: 'EGY', 376: 'ISR',
  368: 'IRQ', 434: 'LBY', 887: 'YEM', 231: 'ETH', 104: 'MMR',
  736: 'SDN', 716: 'ZWE', 558: 'NIC', 422: 'LBN', 364: 'IRN',
  408: 'PRK', 760: 'SYR', 528: 'NLD', 724: 'ESP', 756: 'CHE',
  752: 'SWE', 578: 'NOR', 616: 'POL', 360: 'IDN', 458: 'MYS',
  764: 'THA', 704: 'VNM', 608: 'PHL', 50:  'BGD', 170: 'COL',
  152: 'CHL', 604: 'PER', 404: 'KEN', 288: 'GHA', 834: 'TZA',
  24:  'AGO', 12:  'DZA', 504: 'MAR', 634: 'QAT', 784: 'ARE',
  414: 'KWT', 512: 'OMN', 400: 'JOR', 31:  'AZE', 398: 'KAZ',
  860: 'UZB',
}

function deltaArrow(delta) {
  if (delta == null) return ''
  if (delta > 1) return `↑ +${delta.toFixed(1)}`
  if (delta < -1) return `↓ ${delta.toFixed(1)}`
  return `→ ${delta.toFixed(1)}`
}

function deltaColor(delta) {
  if (delta == null) return '#64748b'
  if (delta > 5) return '#ef4444'
  if (delta > 1) return '#f97316'
  if (delta < -1) return '#22c55e'
  return '#64748b'
}

export default function Globe() {
  const [countries, setCountries] = useState([])
  const [alerts, setAlerts] = useState([])
  const [tooltip, setTooltip] = useState(null)
  const [impact, setImpact] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.countries().then(d => { setCountries(d); setLastRefresh(new Date()) }).catch(() => {})
    api.alerts().then(setAlerts).catch(() => {})
    api.portfolioImpact().then(setImpact).catch(() => {})

    const t = setInterval(() => {
      api.countries().then(d => { setCountries(d); setLastRefresh(new Date()) }).catch(() => {})
      api.alerts().then(setAlerts).catch(() => {})
      api.portfolioImpact().then(setImpact).catch(() => {})
    }, 60000)
    return () => clearInterval(t)
  }, [])

  const byIso3 = Object.fromEntries(countries.map(c => [c.iso3, c]))

  const criticalSet = new Set(
    alerts.filter(a => a.severity === 'critical' && !a.acknowledged).map(a => a.country_iso3)
  )

  const top10 = [...countries]
    .filter(c => c.sovereign_risk_score != null)
    .sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score)
    .slice(0, 10)

  const alertCounts = alerts.reduce((acc, a) => {
    if (!a.acknowledged) acc[a.severity] = (acc[a.severity] || 0) + 1
    return acc
  }, {})

  const handleGeoClick = useCallback((geo) => {
    const numId = parseInt(geo.id)
    const iso3 = NUM_TO_ISO3[numId]
    if (iso3) navigate(`/country/${iso3}`)
  }, [navigate])

  const handleGeoEnter = useCallback((geo, evt) => {
    const numId = parseInt(geo.id)
    const iso3 = NUM_TO_ISO3[numId]
    if (!iso3) return
    const c = byIso3[iso3]
    if (!c) return
    setTooltip({ country: c, x: evt.clientX, y: evt.clientY })
  }, [byIso3])

  const handleGeoLeave = useCallback(() => setTooltip(null), [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Map area */}
      <div className="flex-1 relative">
        <ComposableMap
          projectionConfig={{ scale: 147, center: [10, 10] }}
          style={{ width: '100%', height: '100%' }}
        >
          <ZoomableGroup>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => {
                  const numId = parseInt(geo.id)
                  const iso3 = NUM_TO_ISO3[numId]
                  const c = iso3 ? byIso3[iso3] : null
                  const color = c?.risk_tier ? TIER_COLORS[c.risk_tier] : TIER_COLORS.none
                  const isCritical = iso3 ? criticalSet.has(iso3) : false

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={color}
                      stroke="#0a0a0f"
                      strokeWidth={0.4}
                      style={{
                        default: { outline: 'none', opacity: isCritical ? 1 : 0.85 },
                        hover: { outline: 'none', opacity: 1, filter: 'brightness(1.3)' },
                        pressed: { outline: 'none' },
                      }}
                      onClick={() => handleGeoClick(geo)}
                      onMouseEnter={(evt) => handleGeoEnter(geo, evt)}
                      onMouseLeave={handleGeoLeave}
                    />
                  )
                })
              }
            </Geographies>
          </ZoomableGroup>
        </ComposableMap>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none rounded-lg border shadow-2xl p-3 w-56"
            style={{
              left: tooltip.x + 14,
              top: tooltip.y - 10,
              background: 'rgba(18,18,26,0.97)',
              borderColor: '#2e2e42',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-slate-100">{tooltip.country.name}</span>
              <span className="font-mono text-xs text-slate-500">{tooltip.country.iso3}</span>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <RiskBadge tier={tooltip.country.risk_tier} />
              <span className="font-mono text-sm font-bold"
                    style={{ color: TIER_COLORS[tooltip.country.risk_tier] || '#64748b' }}>
                {tooltip.country.sovereign_risk_score?.toFixed(1) ?? '—'}
              </span>
              <span className="text-xs font-mono"
                    style={{ color: deltaColor(tooltip.country.risk_delta_7d) }}>
                {deltaArrow(tooltip.country.risk_delta_7d)}
              </span>
            </div>
            {tooltip.country.top_risk_drivers?.[0] && (
              <p className="text-xs text-slate-400">
                ⚡ {tooltip.country.top_risk_drivers[0]}
              </p>
            )}
          </div>
        )}

        {/* Bottom status bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-6 px-4 py-2 text-xs font-mono"
             style={{ background: 'rgba(10,10,15,0.9)', borderTop: '1px solid #1e1e2e' }}>
          <span className="text-slate-500">ALERTS:</span>
          {alertCounts.critical > 0 && (
            <span className="text-red-400">🔴 {alertCounts.critical} critical</span>
          )}
          {alertCounts.warning > 0 && (
            <span className="text-yellow-400">⚠️ {alertCounts.warning} warning</span>
          )}
          {alertCounts.watch > 0 && (
            <span className="text-indigo-400">👁 {alertCounts.watch} watch</span>
          )}
          {!alertCounts.critical && !alertCounts.warning && !alertCounts.watch && (
            <span className="text-green-500">No active alerts</span>
          )}
          <span className="ml-auto text-slate-500">
            PORTFOLIO EST:{' '}
            <span className={impact?.total_shock_pct < -0.01 ? 'text-red-400' : 'text-green-400'}>
              {impact ? `${(impact.total_shock_pct * 100).toFixed(2)}%` : '—'}
            </span>
          </span>
          <span className="text-slate-600">
            REFRESHED {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
          </span>
        </div>
      </div>

      {/* Right sidebar */}
      <div className="w-72 flex flex-col border-l overflow-hidden"
           style={{ borderColor: '#1e1e2e', background: '#0d0d14' }}>
        <div className="px-4 pt-4 pb-2 border-b" style={{ borderColor: '#1e1e2e' }}>
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase">Top Risk Countries</h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {top10.map((c, i) => (
            <div
              key={c.iso3}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b hover:bg-white/5 transition-colors"
              style={{ borderColor: '#1e1e2e' }}
              onClick={() => navigate(`/country/${c.iso3}`)}
            >
              <span className="text-slate-600 font-mono text-xs w-4">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-slate-200 text-sm truncate font-medium">{c.name}</span>
                  {criticalSet.has(c.iso3) && <span className="text-red-400 text-xs">🔴</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <RiskBadge tier={c.risk_tier} size="xs" />
                  <span className="text-xs font-mono"
                        style={{ color: deltaColor(c.risk_delta_7d) }}>
                    {deltaArrow(c.risk_delta_7d)}
                  </span>
                </div>
              </div>
              <span className="font-mono text-sm font-bold shrink-0"
                    style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                {c.sovereign_risk_score?.toFixed(0)}
              </span>
            </div>
          ))}
        </div>

        {/* Alert feed */}
        <div className="border-t" style={{ borderColor: '#1e1e2e' }}>
          <div className="px-4 pt-3 pb-1">
            <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase">Live Alerts</h2>
          </div>
          <div className="px-2 pb-3 max-h-48 overflow-y-auto">
            <AlertFeed limit={5} compact />
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-3 border-t" style={{ borderColor: '#1e1e2e' }}>
          <div className="flex items-center gap-3 text-xs font-mono">
            {[['low','#22c55e'],['elevated','#eab308'],['high','#f97316'],['severe','#ef4444']].map(([t, c]) => (
              <span key={t} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
                <span className="text-slate-500">{t}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
