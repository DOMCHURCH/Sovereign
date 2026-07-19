import { useMemo, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// 2D fallback shown when the WebGL globe can't render (WebGL unavailable, or the
// 3D renderer threw during init). Built with plain React + inline SVG and a
// simple equirectangular projection so it has ZERO runtime dependencies and is
// guaranteed to render on any device — the live demo stays functional even with
// hardware acceleration off. It reuses the exact GeoJSON already fetched for the
// globe, so there's no extra network cost.
// ─────────────────────────────────────────────────────────────────────────────

// Fixed 2:1 viewBox; the SVG scales to fill its container.
const VB_W = 1000
const VB_H = 500

// Equirectangular projection: lng/lat → viewBox coordinates.
const projX = (lng) => (lng + 180) / 360 * VB_W
const projY = (lat) => (90 - lat) / 180 * VB_H

function ringToPath(ring) {
  let d = ''
  let prevLng = null
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i]
    if (!pt || pt.length < 2) continue
    const lng = pt[0]
    const lat = pt[1]
    const x = projX(lng).toFixed(1)
    const y = projY(lat).toFixed(1)
    // Countries crossing the antimeridian (±180°) would otherwise draw a long
    // horizontal streak; break the subpath on a big longitude jump.
    if (prevLng !== null && Math.abs(lng - prevLng) > 180) {
      d += `M${x},${y}`
    } else {
      d += (d === '' ? 'M' : 'L') + `${x},${y}`
    }
    prevLng = lng
  }
  return d ? d + 'Z' : ''
}

function featureToPath(feat) {
  const g = feat && feat.geometry
  if (!g || !g.coordinates) return ''
  if (g.type === 'Polygon') {
    return g.coordinates.map(ringToPath).join('')
  }
  if (g.type === 'MultiPolygon') {
    return g.coordinates.map(poly => poly.map(ringToPath).join('')).join('')
  }
  return ''
}

export default function GlobeFallback({
  geoData = [],
  colorFor,             // (feature) => css color for the country fill
  conflicts = [],
  conflictColor,        // (conflict) => css color for the marker
  onSelectFeature,      // (feature) => void — click handler (navigate)
  viewMode = 'risk',
  reason = 'unsupported', // 'unsupported' | 'crashed'
  onRetry,              // optional () => void to re-attempt the 3D globe
}) {
  const [hover, setHover] = useState(-1)

  // Precompute one SVG path per country (expensive-ish, so memoize on geoData).
  const paths = useMemo(() => {
    return (geoData || [])
      .map(feat => ({ feat, d: featureToPath(feat) }))
      .filter(p => p.d)
  }, [geoData])

  const conflictDots = useMemo(() => {
    return (conflicts || [])
      .filter(c => c && c.lat != null && c.lng != null)
      .map(c => ({
        c,
        x: projX(c.lng),
        y: projY(c.lat),
        r: c.intensity === 'major' ? 4.5 : c.intensity === 'significant' ? 3 : 2,
      }))
  }, [conflicts])

  const notice = reason === 'crashed'
    ? '3D renderer unavailable on this device'
    : 'WebGL unavailable — 2D map view'

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: '#070710' }}>
      {/* Notice banner */}
      <div
        className="flex items-center gap-2 px-3 py-2 text-xs font-mono shrink-0"
        style={{ background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.15)', color: '#fbbf24' }}
      >
        <span style={{ fontSize: 13 }}>🗺️</span>
        <span className="truncate">{notice}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto shrink-0 px-2 py-0.5 rounded font-mono transition-colors"
            style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a78bfa', fontSize: 10 }}
            title="Try rendering the 3D globe again"
          >
            Retry 3D
          </button>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
          style={{ display: 'block', position: 'absolute', inset: 0, margin: 'auto' }}
        >
          {/* Ocean */}
          <rect x="0" y="0" width={VB_W} height={VB_H} fill="#0b1a30" fillOpacity={0.45} />

          {/* Countries */}
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill={colorFor ? colorFor(p.feat) : '#1e2d3d'}
              fillOpacity={hover === i ? 1 : 0.82}
              stroke={hover === i ? 'rgba(167,139,250,0.9)' : 'rgba(148,163,184,0.18)'}
              strokeWidth={hover === i ? 0.9 : 0.35}
              style={{ cursor: 'pointer', transition: 'fill-opacity 0.15s' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(h => (h === i ? -1 : h))}
              onClick={() => onSelectFeature?.(p.feat)}
            />
          ))}

          {/* Conflict hotspots */}
          {conflictDots.map(({ c, x, y, r }, i) => (
            <circle
              key={`c${i}`}
              cx={x}
              cy={y}
              r={r}
              fill={conflictColor ? conflictColor(c) : '#ef4444'}
              fillOpacity={0.9}
              stroke="#070710"
              strokeWidth={0.5}
            >
              <title>{c.name || c.id}</title>
            </circle>
          ))}
        </svg>

        {/* Legend (mirrors the 3D view's risk legend) */}
        {viewMode === 'risk' && (
          <div
            className="absolute bottom-3 left-3 rounded-lg px-3 py-2 pointer-events-none"
            style={{ background: 'rgba(7,7,16,0.88)', border: '1px solid #1e2d3d', backdropFilter: 'blur(10px)' }}
          >
            <div className="flex items-center gap-3 text-xs font-mono flex-wrap" style={{ maxWidth: 320 }}>
              {[['severe', '#f87171'], ['high', '#fb923c'], ['elevated', '#fbbf24'], ['low', '#4ade80']].map(([t, c]) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
                  <span className="text-slate-400 capitalize" style={{ fontSize: 10 }}>{t}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Hint */}
        <div className="absolute bottom-3 right-3 text-xs text-slate-600 font-mono pointer-events-none select-none">
          Click a country to explore
        </div>
      </div>
    </div>
  )
}
