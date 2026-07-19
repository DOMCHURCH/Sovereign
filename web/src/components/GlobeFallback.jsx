import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { geoOrthographic, geoPath, geoContains, geoDistance, geoCircle, geoGraticule10 } from 'd3-geo'

// ─────────────────────────────────────────────────────────────────────────────
// GPU-free 3D globe. Shown when WebGL is unavailable or the three.js renderer
// crashed at init. Renders an orthographic ("view from space") projection onto a
// plain 2D <canvas> — all the 3D look is math + gradients, zero GPU required,
// so it works on every device including ones where hardware acceleration is
// broken or disabled. Feature parity with the WebGL globe where it matters:
// drag-to-rotate, auto-rotation, risk-coloured countries, conflict hotspots
// with pulsing rings, animated interstate-war arcs, hover tooltips, click to
// open a country.
// ─────────────────────────────────────────────────────────────────────────────

const TIER_COLORS = { low: '#4ade80', elevated: '#fbbf24', high: '#fb923c', severe: '#f87171' }
const ARC_STROKE  = { major: '#ef4444', significant: '#f97316', minor: '#fbbf24' }
const ARC_WIDTH   = { major: 2, significant: 1.5, minor: 1.1 }
const DOT_R       = { major: 5, significant: 3.5, minor: 2.5 }
const PULSE_DEG   = { major: 7, significant: 4.5, minor: 3 }

function hexToRgba(hex, alpha) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return `rgba(255,255,255,${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// Deterministic PRNG so the starfield doesn't reshuffle between renders
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function GlobeFallback({
  geoData = [],
  colorFor,            // (feature) => css hex for country fill
  conflicts = [],
  conflictColor,       // (conflict) => css hex for hotspot marker
  arcs = [],           // interstate wars with startLat/startLng/endLat/endLng
  labelFor,            // (feature) => { name, score, tier } for the tooltip
  onSelectFeature,     // (feature) => void
  onSelectConflict,    // (conflict) => void
  reason = 'unsupported', // 'unsupported' | 'crashed'
  onRetry,             // () => void — re-attempt the WebGL globe
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  // Camera + interaction state live in refs — the render loop is imperative
  // canvas drawing, so we avoid a React re-render per animation frame.
  const rotationRef = useRef([-25, -22])          // [lambda, phi] — start over EU/Africa/MidEast
  const dragRef = useRef(null)                    // { x, y, rot0, moved }
  const hoverRef = useRef(null)                   // { feat } | { conflict }
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const lastHoverCheck = useRef(0)

  const [tip, setTip] = useState(null)            // tooltip: { x, y, kind, data }
  const [cursor, setCursor] = useState('grab')

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    []
  )

  // Starfield — fixed normalized positions, twinkle phase per star
  const stars = useMemo(() => {
    const rnd = mulberry32(1337)
    return Array.from({ length: 150 }, () => ({
      x: rnd(), y: rnd(),
      r: 0.3 + rnd() * 1.0,
      base: 0.25 + rnd() * 0.5,
      phase: rnd() * Math.PI * 2,
      speed: 0.5 + rnd() * 1.5,
    }))
  }, [])

  // Latest props for the render loop without re-subscribing it
  const propsRef = useRef({})
  propsRef.current = { geoData, colorFor, conflicts, conflictColor, arcs }

  // ── Render loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      sizeRef.current = { w, h, dpr }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    let raf = 0
    let lastDraw = 0

    const draw = (t) => {
      const { w, h, dpr } = sizeRef.current
      const { geoData, colorFor, conflicts, conflictColor, arcs } = propsRef.current
      if (w < 10 || h < 10) return

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const cx = w / 2
      const cy = h / 2
      const R = Math.max(40, Math.min(w, h) * 0.42)
      const [lam, phi] = rotationRef.current
      const projection = geoOrthographic().translate([cx, cy]).scale(R).rotate([lam, phi]).clipAngle(90)
      const path = geoPath(projection, ctx)
      const viewCenter = [-lam, -phi]
      const visible = (lng, lat) => geoDistance([lng, lat], viewCenter) < Math.PI / 2 - 0.03

      // 1 ── Stars
      for (const s of stars) {
        const a = reduced ? s.base : s.base * (0.55 + 0.45 * Math.sin(t * 0.001 * s.speed + s.phase))
        ctx.fillStyle = `rgba(226,232,240,${a.toFixed(3)})`
        ctx.fillRect(s.x * w, s.y * h, s.r, s.r)
      }

      // 2 ── Atmosphere glow (behind the sphere)
      const atmo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.25)
      atmo.addColorStop(0, 'rgba(99,102,241,0.28)')
      atmo.addColorStop(0.55, 'rgba(99,102,241,0.10)')
      atmo.addColorStop(1, 'rgba(99,102,241,0)')
      ctx.fillStyle = atmo
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2)
      ctx.fill()

      // 3 ── Ocean sphere with an off-center "lit" gradient
      const ocean = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.1, cx, cy, R * 1.05)
      ocean.addColorStop(0, '#16345c')
      ocean.addColorStop(0.5, '#0d2140')
      ocean.addColorStop(1, '#060f21')
      ctx.beginPath()
      path({ type: 'Sphere' })
      ctx.fillStyle = ocean
      ctx.fill()

      // 4 ── Graticule
      ctx.beginPath()
      path(geoGraticule10())
      ctx.strokeStyle = 'rgba(148,163,184,0.08)'
      ctx.lineWidth = 0.5
      ctx.stroke()

      // 5 ── Countries
      const hovFeat = hoverRef.current?.feat
      for (const feat of geoData) {
        ctx.beginPath()
        path(feat)
        ctx.fillStyle = hexToRgba(colorFor ? colorFor(feat) : '#1e2d3d', feat === hovFeat ? 1 : 0.88)
        ctx.fill()
        ctx.strokeStyle = feat === hovFeat ? 'rgba(226,232,240,0.9)' : 'rgba(5,10,24,0.65)'
        ctx.lineWidth = feat === hovFeat ? 1.2 : 0.5
        ctx.stroke()
      }

      // 6 ── Sphere shading overlay: specular highlight + limb darkening.
      // This is what sells the 3D ball illusion.
      const shade = ctx.createRadialGradient(cx - R * 0.42, cy - R * 0.46, R * 0.08, cx, cy, R * 1.02)
      shade.addColorStop(0, 'rgba(255,255,255,0.12)')
      shade.addColorStop(0.35, 'rgba(255,255,255,0.02)')
      shade.addColorStop(0.72, 'rgba(2,6,18,0.12)')
      shade.addColorStop(1, 'rgba(2,6,18,0.62)')
      ctx.beginPath()
      path({ type: 'Sphere' })
      ctx.fillStyle = shade
      ctx.fill()

      // 7 ── Rim light
      ctx.beginPath()
      path({ type: 'Sphere' })
      ctx.strokeStyle = 'rgba(129,140,248,0.55)'
      ctx.lineWidth = 1.4
      ctx.shadowColor = '#6366f1'
      ctx.shadowBlur = 14
      ctx.stroke()
      ctx.shadowBlur = 0

      // 8 ── Interstate-war arcs — great circles, marching-dash animation
      for (const a of arcs) {
        if (a.startLng == null || a.endLng == null) continue
        ctx.beginPath()
        path({ type: 'LineString', coordinates: [[a.startLng, a.startLat], [a.endLng, a.endLat]] })
        ctx.strokeStyle = ARC_STROKE[a.intensity] || ARC_STROKE.minor
        ctx.lineWidth = ARC_WIDTH[a.intensity] || 1.1
        ctx.setLineDash([7, 5])
        ctx.lineDashOffset = reduced ? 0 : -(t * 0.02) % 12
        ctx.shadowColor = ctx.strokeStyle
        ctx.shadowBlur = 5
        ctx.stroke()
        ctx.setLineDash([])
        ctx.shadowBlur = 0
      }

      // 9 ── Conflict hotspots: glowing dot + expanding pulse ring
      const hovConflict = hoverRef.current?.conflict
      conflicts.forEach((c, i) => {
        if (c.lat == null || c.lng == null || !visible(c.lng, c.lat)) return
        const color = conflictColor ? conflictColor(c) : '#ef4444'

        // Pulse ring drawn on the sphere surface (a small geo circle), so it
        // foreshortens near the limb like the WebGL rings do.
        if (c.intensity === 'major' || c.intensity === 'significant') {
          const period = c.intensity === 'major' ? 1500 : 2100
          const k = reduced ? 0.45 : ((t + i * 331) % period) / period
          const ring = geoCircle().center([c.lng, c.lat]).radius(0.4 + k * (PULSE_DEG[c.intensity] || 4))()
          ctx.beginPath()
          path(ring)
          ctx.strokeStyle = hexToRgba(color, (1 - k) * 0.6)
          ctx.lineWidth = 1.2
          ctx.stroke()
        }

        const p = projection([c.lng, c.lat])
        if (!p) return
        const rr = (DOT_R[c.intensity] || 2.5) * (c === hovConflict ? 1.5 : 1)
          * (reduced ? 1 : 1 + 0.12 * Math.sin(t * 0.004 + i))
        ctx.beginPath()
        ctx.arc(p[0], p[1], rr, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = 8
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = 'rgba(7,7,16,0.9)'
        ctx.lineWidth = 1
        ctx.stroke()
      })
    }

    const frame = (t) => {
      raf = requestAnimationFrame(frame)
      const dt = t - lastDraw
      if (dt < 33) return   // ~30fps cap — kind to the CPUs this fallback runs on
      // Auto-rotate while idle (matches the WebGL globe's behaviour)
      if (!reduced && !dragRef.current && !hoverRef.current) {
        rotationRef.current[0] += Math.min(dt, 100) * 0.0035
      }
      draw(t)
      lastDraw = t
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [stars, reduced])

  // ── Interaction ─────────────────────────────────────────────────────────────
  const project = useCallback(() => {
    const { w, h } = sizeRef.current
    const R = Math.max(40, Math.min(w, h) * 0.42)
    const [lam, phi] = rotationRef.current
    return {
      projection: geoOrthographic().translate([w / 2, h / 2]).scale(R).rotate([lam, phi]).clipAngle(90),
      R, cx: w / 2, cy: h / 2, lam, phi,
    }
  }, [])

  const hitTest = useCallback((mx, my) => {
    const { geoData, conflicts } = propsRef.current
    const { projection, R, cx, cy, lam, phi } = project()

    // Conflict dots first (they sit on top and are small targets)
    const viewCenter = [-lam, -phi]
    for (const c of conflicts) {
      if (c.lat == null || c.lng == null) continue
      if (geoDistance([c.lng, c.lat], viewCenter) >= Math.PI / 2 - 0.03) continue
      const p = projection([c.lng, c.lat])
      if (p && Math.hypot(p[0] - mx, p[1] - my) < (DOT_R[c.intensity] || 2.5) + 5) {
        return { conflict: c }
      }
    }

    // Then countries — invert the pointer into lng/lat and test containment
    if (Math.hypot(mx - cx, my - cy) > R) return null
    const geo = projection.invert?.([mx, my])
    if (!geo || isNaN(geo[0])) return null
    const feat = geoData.find(f => geoContains(f, geo))
    return feat ? { feat } : null
  }, [project])

  const onPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = {
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      rot0: [...rotationRef.current], moved: 0,
    }
    setCursor('grabbing')
    setTip(null)
  }, [])

  const onPointerMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const d = dragRef.current
    if (d) {
      const dx = mx - d.x
      const dy = my - d.y
      d.moved = Math.max(d.moved, Math.hypot(dx, dy))
      const { R } = project()
      const k = 70 / R   // degrees per pixel, scaled to globe size
      rotationRef.current = [
        d.rot0[0] + dx * k,
        Math.max(-80, Math.min(80, d.rot0[1] - dy * k)),
      ]
      return
    }

    // Hover (throttled — geoContains over ~180 countries isn't free)
    const now = performance.now()
    if (now - lastHoverCheck.current < 45) return
    lastHoverCheck.current = now
    const hit = hitTest(mx, my)
    hoverRef.current = hit
    if (hit?.conflict) {
      setCursor('pointer')
      setTip({ x: mx, y: my, kind: 'conflict', data: hit.conflict })
    } else if (hit?.feat) {
      setCursor('pointer')
      setTip({ x: mx, y: my, kind: 'country', data: labelFor ? labelFor(hit.feat) : { name: '' } })
    } else {
      setCursor('grab')
      setTip(null)
    }
  }, [hitTest, labelFor, project])

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current
    dragRef.current = null
    setCursor('grab')
    if (!d || d.moved > 5) return   // it was a drag, not a click
    const rect = e.currentTarget.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (hit?.conflict) onSelectConflict?.(hit.conflict)
    else if (hit?.feat) onSelectFeature?.(hit.feat)
  }, [hitTest, onSelectFeature, onSelectConflict])

  const onPointerLeave = useCallback(() => {
    dragRef.current = null
    hoverRef.current = null
    setCursor('grab')
    setTip(null)
  }, [])

  const notice = reason === 'crashed'
    ? '3D acceleration failed on this device — GPU-free globe active'
    : 'WebGL unavailable — GPU-free globe active'

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden select-none" style={{ background: '#070710', cursor }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      {/* Status pill */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full font-mono pointer-events-none"
        style={{
          top: 10, fontSize: 10, letterSpacing: '0.04em',
          background: 'rgba(7,7,16,0.85)', border: '1px solid rgba(251,191,36,0.25)',
          color: '#fbbf24', backdropFilter: 'blur(8px)', maxWidth: 'calc(100% - 220px)',
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#fbbf24', boxShadow: '0 0 6px #fbbf24aa' }} />
        <span className="truncate">{notice}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 px-2 py-0.5 rounded-full font-mono transition-colors pointer-events-auto"
            style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a78bfa', fontSize: 9 }}
            title="Try the hardware-accelerated 3D globe again"
          >
            RETRY 3D
          </button>
        )}
      </div>

      {/* Hover tooltip */}
      {tip && (
        <div
          className="absolute pointer-events-none rounded-lg px-3 py-2 font-mono"
          style={{
            left: Math.min(tip.x + 16, (sizeRef.current.w || 300) - 190),
            top: Math.min(tip.y + 14, (sizeRef.current.h || 300) - 80),
            background: 'rgba(7,5,16,0.96)',
            border: `1px solid ${tip.kind === 'conflict'
              ? hexToRgba(conflictColor ? conflictColor(tip.data) : '#ef4444', 0.5)
              : hexToRgba(TIER_COLORS[tip.data.tier] || '#334155', 0.55)}`,
            boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
            minWidth: 150, maxWidth: 220, zIndex: 10,
          }}
        >
          {tip.kind === 'conflict' ? (
            <>
              <div className="text-xs font-bold" style={{ color: '#f8fafc' }}>{tip.data.name}</div>
              <div className="mt-1" style={{ fontSize: 10, color: '#94a3b8' }}>⚔️ {tip.data.parties}</div>
              <div style={{ fontSize: 9, color: '#475569', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {tip.data.intensity} · click to explore
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold" style={{ color: '#f8fafc' }}>{tip.data.name}</span>
                {tip.data.score != null && (
                  <span className="text-xs font-bold" style={{ color: TIER_COLORS[tip.data.tier] || '#64748b' }}>
                    {Math.round(tip.data.score)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 9, color: '#475569', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {tip.data.tier ? `${tip.data.tier} risk · ` : ''}click to explore
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
