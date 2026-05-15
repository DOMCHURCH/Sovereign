import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import GlobeGL from 'react-globe.gl'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'
import AlertFeed from '../components/AlertFeed'

const GEO_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

const TIER_COLORS = {
  low:      '#4ade80',  // brighter green
  elevated: '#fbbf24',  // amber
  high:     '#fb923c',  // orange
  severe:   '#f87171',  // red
  none:     '#1e2d3d',  // dark blue-grey (ocean-ish, not pure black)
}

const TIER_ALT = {
  severe:   0.03,
  high:     0.018,
  elevated: 0.008,
  low:      0.003,
  none:     0.001,
}

const TIER_CAP_ALPHA = {
  severe:   0.9,
  high:     0.8,
  elevated: 0.7,
  low:      0.65,
  none:     0.5,
}

const CAPITALS = {
  AFG:{lat:34.5,lng:69.2}, AGO:{lat:-8.8,lng:13.2}, ARE:{lat:24.5,lng:54.4},
  ARG:{lat:-34.6,lng:-58.4}, AUS:{lat:-35.3,lng:149.1}, AZE:{lat:40.4,lng:49.9},
  BGD:{lat:23.7,lng:90.4}, BLR:{lat:53.9,lng:27.6}, BRA:{lat:-15.8,lng:-47.9},
  CAN:{lat:45.4,lng:-75.7}, CHE:{lat:46.9,lng:7.5}, CHL:{lat:-33.5,lng:-70.6},
  CHN:{lat:39.9,lng:116.4}, COL:{lat:4.7,lng:-74.1}, CUB:{lat:23.1,lng:-82.4},
  DEU:{lat:52.5,lng:13.4}, DZA:{lat:36.7,lng:3.0}, EGY:{lat:30.1,lng:31.2},
  ESP:{lat:40.4,lng:-3.7}, ETH:{lat:9.0,lng:38.7}, FRA:{lat:48.9,lng:2.3},
  GBR:{lat:51.5,lng:-0.1}, GHA:{lat:5.6,lng:-0.2}, HKG:{lat:22.3,lng:114.2},
  IDN:{lat:-6.2,lng:106.8}, IND:{lat:28.6,lng:77.2}, IRN:{lat:35.7,lng:51.4},
  IRQ:{lat:33.3,lng:44.4}, ISR:{lat:31.8,lng:35.2}, ITA:{lat:41.9,lng:12.5},
  JOR:{lat:31.9,lng:35.9}, JPN:{lat:35.7,lng:139.7}, KAZ:{lat:51.2,lng:71.5},
  KEN:{lat:-1.3,lng:36.8}, KOR:{lat:37.6,lng:127.0}, KWT:{lat:29.4,lng:47.9},
  LBN:{lat:33.9,lng:35.5}, LBY:{lat:32.9,lng:13.2}, MAR:{lat:34.0,lng:-6.8},
  MEX:{lat:19.4,lng:-99.1}, MMR:{lat:19.7,lng:96.1}, MYS:{lat:3.2,lng:101.7},
  NGA:{lat:9.1,lng:7.2}, NIC:{lat:12.1,lng:-86.3}, NLD:{lat:52.1,lng:4.3},
  NOR:{lat:59.9,lng:10.7}, OMN:{lat:23.6,lng:58.6}, PAK:{lat:33.7,lng:73.1},
  PER:{lat:-12.0,lng:-77.0}, PHL:{lat:14.6,lng:121.0}, POL:{lat:52.2,lng:21.0},
  PRK:{lat:39.0,lng:125.8}, QAT:{lat:25.3,lng:51.5}, RUS:{lat:55.8,lng:37.6},
  SAU:{lat:24.7,lng:46.7}, SDN:{lat:15.6,lng:32.5}, SGP:{lat:1.3,lng:103.8},
  SWE:{lat:59.3,lng:18.1}, SYR:{lat:33.5,lng:36.3}, THA:{lat:13.8,lng:100.5},
  TUR:{lat:39.9,lng:32.9}, TWN:{lat:25.0,lng:121.5}, TZA:{lat:-6.2,lng:35.7},
  UKR:{lat:50.4,lng:30.5}, USA:{lat:38.9,lng:-77.0}, UZB:{lat:41.3,lng:69.3},
  VEN:{lat:10.5,lng:-66.9}, VNM:{lat:21.0,lng:105.8}, YEM:{lat:15.4,lng:44.2},
  ZAF:{lat:-25.7,lng:28.2}, ZWE:{lat:-17.8,lng:31.1},
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

// ISO_A3 of -99 means unassigned/disputed — use ADM0_A3 as fallback
function getIso3(feat) {
  const iso = feat?.properties?.ISO_A3
  return (iso && iso !== '-99') ? iso : (feat?.properties?.ADM0_A3 || null)
}

const CONFLICT_COLORS = { major: '#ff4444', significant: '#ff8c00', minor: '#ffd700' }
const CONFLICT_ALT    = { major: 0.07, significant: 0.045, minor: 0.025 }
const CONFLICT_RADIUS = { major: 0.55, significant: 0.38, minor: 0.22 }

// Cache GeoJSON at module level so it survives navigation (no CDN round-trip on remount)
let _geoCache = null

export default function Globe() {
  const [countries, setCountries] = useState([])
  const [alerts, setAlerts] = useState([])
  const [impact, setImpact] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [geoData, setGeoData] = useState(_geoCache || [])
  const [dims, setDims] = useState({ w: window.innerWidth - 288, h: window.innerHeight - 48 })
  const [conflicts, setConflicts] = useState([])
  const [showConflicts, setShowConflicts] = useState(true)
  const globeRef = useRef(null)
  const navigate = useNavigate()

  // Data fetching
  useEffect(() => {
    api.countries().then(d => { setCountries(d); setLastRefresh(new Date()) }).catch(() => {})
    api.alerts().then(setAlerts).catch(() => {})
    api.portfolioImpact().then(setImpact).catch(() => {})
    api.conflicts().then(setConflicts).catch(() => {})

    const t = setInterval(() => {
      api.countries().then(d => { setCountries(d); setLastRefresh(new Date()) }).catch(() => {})
      api.alerts().then(setAlerts).catch(() => {})
      api.portfolioImpact().then(setImpact).catch(() => {})
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // GeoJSON — skip fetch if already cached
  useEffect(() => {
    if (_geoCache) return
    fetch(GEO_URL)
      .then(r => r.json())
      .then(d => {
        _geoCache = d.features || []
        setGeoData(_geoCache)
      })
      .catch(() => {})
  }, [])

  // Responsive dimensions
  useEffect(() => {
    const update = () => setDims({ w: window.innerWidth - 288, h: window.innerHeight - 48 })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Auto-rotate — use onGlobeReady instead of useEffect([globeRef.current])
  // (refs don't trigger re-renders, so useEffect([ref.current]) silently fails on remount)
  const onGlobeReady = useCallback(() => {
    if (!globeRef.current) return
    const controls = globeRef.current.controls()
    if (!controls) return
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    controls.enableZoom = true
  }, [])

  const byIso3 = useMemo(
    () => Object.fromEntries(countries.map(c => [c.iso3, c])),
    [countries]
  )

  const criticalSet = useMemo(
    () => new Set(alerts.filter(a => a.severity === 'critical' && !a.acknowledged).map(a => a.country_iso3)),
    [alerts]
  )

  const top10 = useMemo(
    () => [...countries]
      .filter(c => c.sovereign_risk_score != null)
      .sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score)
      .slice(0, 10),
    [countries]
  )

  const alertCounts = useMemo(
    () => alerts.reduce((acc, a) => {
      if (!a.acknowledged) acc[a.severity] = (acc[a.severity] || 0) + 1
      return acc
    }, {}),
    [alerts]
  )

  // Pulsing rings for severe/high countries
  const ringsData = useMemo(() =>
    countries
      .filter(c => (c.risk_tier === 'severe' || c.risk_tier === 'high') && CAPITALS[c.iso3])
      .map(c => ({ lat: CAPITALS[c.iso3].lat, lng: CAPITALS[c.iso3].lng, iso3: c.iso3, tier: c.risk_tier })),
    [countries]
  )

  const handleClick = useCallback((feat) => {
    const iso3 = getIso3(feat)
    if (iso3) navigate(`/country/${iso3}`)
  }, [navigate])

  const handleHover = useCallback((feat) => {
    setHovered(feat || null)
    const controls = globeRef.current?.controls()
    if (controls) controls.autoRotate = !feat
  }, [])

  const polygonColor = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    const tier = c?.risk_tier || 'none'
    const color = TIER_COLORS[tier] || TIER_COLORS.none
    const isHov = hovered && getIso3(hovered) === iso3
    return hexToRgba(color, isHov ? 0.95 : (TIER_CAP_ALPHA[tier] ?? 0.5))
  }, [byIso3, hovered])

  const polygonSideColor = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    const tier = c?.risk_tier || 'none'
    return hexToRgba(TIER_COLORS[tier] || TIER_COLORS.none, 0.3)
  }, [byIso3])

  const polygonAlt = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    const tier = c?.risk_tier || 'none'
    return TIER_ALT[tier] ?? TIER_ALT.none
  }, [byIso3])

  const polygonLabel = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    if (!c) return ''
    const score = c.sovereign_risk_score?.toFixed(1) ?? '—'
    const delta = deltaArrow(c.risk_delta_7d)
    const tier = c.risk_tier || 'unknown'
    const driver = c.top_risk_drivers?.[0] || ''
    return `<div style="background:rgba(12,12,20,0.97);border:1px solid #2e2e42;border-radius:8px;padding:10px 14px;font-family:monospace;min-width:180px;max-width:220px">
      <div style="color:#e2e8f0;font-size:13px;font-weight:600;margin-bottom:4px">${c.name}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;padding:1px 6px;border-radius:4px;background:${TIER_COLORS[tier]}25;color:${TIER_COLORS[tier]};text-transform:uppercase">${tier}</span>
        <span style="color:${TIER_COLORS[tier]};font-size:14px;font-weight:bold">${score}</span>
        <span style="color:${deltaColor(c.risk_delta_7d)};font-size:11px">${delta}</span>
      </div>
      ${driver ? `<div style="color:#94a3b8;font-size:11px">⚡ ${driver}</div>` : ''}
    </div>`
  }, [byIso3])

  // Stable stroke color — must not be inline arrow or it recreates every render
  const polygonStroke = useCallback(() => 'rgba(148,163,184,0.15)', [])

  const conflictColor  = useCallback(d => CONFLICT_COLORS[d.intensity] || '#ffd700', [])
  const conflictAlt    = useCallback(d => CONFLICT_ALT[d.intensity]    || 0.03, [])
  const conflictRadius = useCallback(d => CONFLICT_RADIUS[d.intensity] || 0.3, [])

  const conflictLabel = useCallback(d => {
    const color = CONFLICT_COLORS[d.intensity] || '#ffd700'
    const typeLabel = { interstate: 'Interstate War', civil_war: 'Civil War', insurgency: 'Insurgency', territorial: 'Territorial Dispute' }[d.type] || d.type
    return `<div style="background:rgba(10,8,18,0.97);border:1px solid ${color}55;border-radius:9px;padding:11px 14px;font-family:monospace;min-width:200px;max-width:260px;box-shadow:0 4px 24px rgba(0,0,0,0.6)">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};flex-shrink:0"></span>
        <span style="color:#f1f5f9;font-size:13px;font-weight:700">${d.name}</span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:${color}22;color:${color};border:1px solid ${color}44;text-transform:uppercase;letter-spacing:0.05em">${d.intensity}</span>
        <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:rgba(255,255,255,0.06);color:#94a3b8;border:1px solid rgba(255,255,255,0.1)">${typeLabel}</span>
      </div>
      <div style="color:#94a3b8;font-size:11px;margin-bottom:4px">⚔️ ${d.parties}</div>
      <div style="color:#64748b;font-size:10px;line-height:1.5">${d.description}</div>
      <div style="color:#475569;font-size:10px;margin-top:5px">Since ${d.since}</div>
    </div>`
  }, [])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#070710' }}>
      {/* Globe area */}
      <div className="flex-1 relative overflow-hidden">
        <GlobeGL
          ref={globeRef}
          width={dims.w}
          height={dims.h}
          onGlobeReady={onGlobeReady}
          backgroundColor="#070710"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          globeImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
          atmosphereColor="#a78bfa"
          atmosphereAltitude={0.25}
          polygonsData={geoData}
          polygonCapColor={polygonColor}
          polygonSideColor={polygonSideColor}
          polygonStrokeColor={polygonStroke}
          polygonAltitude={polygonAlt}
          polygonLabel={polygonLabel}
          onPolygonClick={handleClick}
          onPolygonHover={handleHover}
          polygonsTransitionDuration={200}
          pointsData={showConflicts ? conflicts : []}
          pointLat="lat"
          pointLng="lng"
          pointColor={conflictColor}
          pointAltitude={conflictAlt}
          pointRadius={conflictRadius}
          pointLabel={conflictLabel}
          pointsTransitionDuration={400}
          ringsData={ringsData}
          ringColor={r => r.tier === 'severe' ? '#ef444488' : '#f9731666'}
          ringMaxRadius={r => r.tier === 'severe' ? 4 : 3}
          ringPropagationSpeed={r => r.tier === 'severe' ? 3 : 2}
          ringRepeatPeriod={r => r.tier === 'severe' ? 900 : 1400}
          ringAltitude={0.01}
        />

        {/* Drag hint */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-xs text-slate-600 font-mono pointer-events-none select-none">
          Drag to rotate · Click country to explore
        </div>

        {/* Bottom status bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-6 px-4 py-2 text-xs font-mono"
             style={{ background: 'rgba(7,7,16,0.92)', borderTop: '1px solid #1e1e2e', backdropFilter: 'blur(16px)' }}>
          <span className="text-slate-500">ALERTS:</span>
          {alertCounts.critical > 0 && <span className="text-red-400">🔴 {alertCounts.critical} critical</span>}
          {alertCounts.warning > 0 && <span className="text-yellow-400">⚠️ {alertCounts.warning} warning</span>}
          {alertCounts.watch > 0 && <span className="text-indigo-400">👁 {alertCounts.watch} watch</span>}
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
      <div className="w-72 flex flex-col overflow-hidden"
           style={{
             borderLeft: '1px solid #1e1e2e',
             background: 'linear-gradient(180deg, #0d0d18 0%, #0a0a14 100%)',
           }}>
        {/* Section header: Top Risk Countries */}
        <div className="px-4 pt-4 pb-2 border-b" style={{ borderColor: '#1e1e2e' }}>
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: '#f87171' }} />
            Top Risk Countries
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {top10.map((c, i) => {
            const score = c.sovereign_risk_score ?? 0
            const barColor = TIER_COLORS[c.risk_tier] || '#64748b'
            return (
              <div
                key={c.iso3}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b hover:bg-white/5 transition-colors"
                style={{
                  borderColor: '#1e1e2e',
                  borderLeft: `3px solid ${barColor}40`,
                }}
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
                  {/* Score bar */}
                  <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(score, 100)}%`,
                        background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
                      }}
                    />
                  </div>
                </div>
                <span className="font-mono text-sm font-bold shrink-0"
                      style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                  {c.sovereign_risk_score?.toFixed(0)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Section header: Live Alerts */}
        <div className="border-t" style={{ borderColor: '#1e1e2e' }}>
          <div className="px-4 pt-3 pb-1">
            <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: '#fbbf24' }} />
              Live Alerts
            </h2>
          </div>
          <div className="px-2 pb-3 max-h-48 overflow-y-auto">
            <AlertFeed limit={5} compact />
          </div>
        </div>

        {/* Legend + conflict toggle */}
        <div className="px-4 py-3 border-t space-y-2.5" style={{ borderColor: '#1e1e2e' }}>
          <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
            {[['low', TIER_COLORS.low], ['elevated', TIER_COLORS.elevated], ['high', TIER_COLORS.high], ['severe', TIER_COLORS.severe]].map(([t, c]) => (
              <span key={t} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
                <span className="text-slate-500">{t}</span>
              </span>
            ))}
          </div>
          {/* Conflict zones toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ff4444', boxShadow: '0 0 5px #ff4444' }} />
              <span className="text-slate-400">Conflict zones</span>
              {conflicts.length > 0 && (
                <span className="text-slate-600">({conflicts.length})</span>
              )}
            </div>
            <button
              onClick={() => setShowConflicts(v => !v)}
              className="text-xs font-mono px-2 py-0.5 rounded transition-all"
              style={{
                background: showConflicts ? 'rgba(255,68,68,0.15)' : 'rgba(255,255,255,0.04)',
                color: showConflicts ? '#ff6666' : '#475569',
                border: `1px solid ${showConflicts ? 'rgba(255,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {showConflicts ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
