import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import GlobeGL from 'react-globe.gl'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'
import AlertFeed from '../components/AlertFeed'

const GEO_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

const TIER_COLORS = {
  low:      '#22c55e',
  elevated: '#eab308',
  high:     '#f97316',
  severe:   '#ef4444',
  none:     '#1e293b',
}

const TIER_ALT = {
  severe: 0.025,
  high:   0.015,
  elevated: 0.008,
  low:    0.003,
  none:   0.002,
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${alpha})`
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
  const [impact, setImpact] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [geoData, setGeoData] = useState([])
  const globeRef = useRef(null)
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

  useEffect(() => {
    fetch(GEO_URL)
      .then(r => r.json())
      .then(d => setGeoData(d.features || []))
      .catch(() => {})
  }, [])

  // Auto-rotate setup
  useEffect(() => {
    if (!globeRef.current) return
    const controls = globeRef.current.controls()
    if (!controls) return
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    controls.enableZoom = true
  }, [globeRef.current])

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

  const getCountry = useCallback((feat) => {
    const iso3 = feat?.properties?.ISO_A3 || feat?.properties?.ADM0_A3
    return iso3 ? byIso3[iso3] : null
  }, [byIso3])

  const getIso3 = (feat) => feat?.properties?.ISO_A3 || feat?.properties?.ADM0_A3

  const handleClick = useCallback((feat) => {
    const iso3 = getIso3(feat)
    if (iso3 && iso3 !== '-99') navigate(`/country/${iso3}`)
  }, [navigate])

  const handleHover = useCallback((feat) => {
    setHovered(feat || null)
    if (!globeRef.current) return
    const controls = globeRef.current.controls()
    if (!controls) return
    controls.autoRotate = !feat
  }, [])

  const polygonColor = useCallback((feat) => {
    const c = getCountry(feat)
    const tier = c?.risk_tier || 'none'
    const color = TIER_COLORS[tier] || TIER_COLORS.none
    const isHov = hovered && getIso3(hovered) === getIso3(feat)
    return hexToRgba(color, isHov ? 0.95 : 0.75)
  }, [getCountry, hovered])

  const polygonSideColor = useCallback((feat) => {
    const c = getCountry(feat)
    const tier = c?.risk_tier || 'none'
    const color = TIER_COLORS[tier] || TIER_COLORS.none
    return hexToRgba(color, 0.3)
  }, [getCountry])

  const polygonAlt = useCallback((feat) => {
    const c = getCountry(feat)
    const tier = c?.risk_tier || 'none'
    return TIER_ALT[tier] || TIER_ALT.none
  }, [getCountry])

  const polygonLabel = useCallback((feat) => {
    const c = getCountry(feat)
    if (!c) return ''
    const score = c.sovereign_risk_score?.toFixed(1) ?? '—'
    const delta = deltaArrow(c.risk_delta_7d)
    const tier = c.risk_tier || 'unknown'
    const driver = c.top_risk_drivers?.[0] || ''
    return `
      <div style="background:rgba(12,12,20,0.95);border:1px solid #2e2e42;border-radius:8px;padding:10px 14px;font-family:monospace;min-width:180px;max-width:220px">
        <div style="color:#e2e8f0;font-size:13px;font-weight:600;margin-bottom:4px">${c.name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:11px;padding:1px 6px;border-radius:4px;background:${TIER_COLORS[tier]}25;color:${TIER_COLORS[tier]};text-transform:uppercase">${tier}</span>
          <span style="color:${TIER_COLORS[tier]};font-size:14px;font-weight:bold">${score}</span>
          <span style="color:${deltaColor(c.risk_delta_7d)};font-size:11px">${delta}</span>
        </div>
        ${driver ? `<div style="color:#94a3b8;font-size:11px">⚡ ${driver}</div>` : ''}
      </div>
    `
  }, [getCountry])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#070710' }}>
      {/* Globe area */}
      <div className="flex-1 relative">
        <GlobeGL
          ref={globeRef}
          width={window.innerWidth - 288}
          height={window.innerHeight - 48}
          backgroundColor="#070710"
          globeImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
          atmosphereColor="#6366f1"
          atmosphereAltitude={0.15}
          polygonsData={geoData}
          polygonCapColor={polygonColor}
          polygonSideColor={polygonSideColor}
          polygonStrokeColor={() => 'rgba(99,102,241,0.3)'}
          polygonAltitude={polygonAlt}
          polygonLabel={polygonLabel}
          onPolygonClick={handleClick}
          onPolygonHover={handleHover}
          polygonsTransitionDuration={200}
        />

        {/* Drag hint */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-xs text-slate-600 font-mono pointer-events-none select-none">
          Drag to rotate · Click country to explore
        </div>

        {/* Bottom status bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-6 px-4 py-2 text-xs font-mono"
             style={{ background: 'rgba(7,7,16,0.9)', borderTop: '1px solid #1e1e2e' }}>
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
                  <span className="text-xs font-mono" style={{ color: deltaColor(c.risk_delta_7d) }}>
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
          <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
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
