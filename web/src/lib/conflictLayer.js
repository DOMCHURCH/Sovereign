/**
 * Isolated conflict visualization layer — pure computation only.
 * Reads from existing fetched data; never calls APIs, never imports React.
 * Used exclusively by Globe.jsx as a modular overlay layer.
 */

// ── Color palettes ────────────────────────────────────────────────────────────

export const CONFLICT_VIEW_COLORS = {
  active_war:  '#ef4444',  // red   — major interstate or civil war
  insurgency:  '#f97316',  // orange — significant conflict / terrorism
  tension:     '#fbbf24',  // amber — minor / territorial dispute
  sanctions:   '#a78bfa',  // purple — sanctions target, no active conflict
  stable:      '#22c55e',  // green — no conflicts
}

const CAT_COLORS = {
  interstate_war:       '#ef4444',
  terrorist_insurgency: '#f97316',
  civil_war:            '#a855f7',
  territorial_dispute:  '#fbbf24',
  gang_crisis:          '#ec4899',
}

const TIER_COLORS_TT = {
  low:      '#4ade80',
  elevated: '#fbbf24',
  high:     '#fb923c',
  severe:   '#f87171',
  none:     '#4a4a6a',
}

// ── Conflict index ────────────────────────────────────────────────────────────

/** Build a map of iso3 → [conflict, ...] from the conflicts array. */
export function buildConflictsByCountry(conflicts) {
  const map = {}
  for (const c of conflicts) {
    for (const iso3 of (c.countries || [])) {
      if (!map[iso3]) map[iso3] = []
      map[iso3].push(c)
    }
  }
  return map
}

// ── Conflict View ─────────────────────────────────────────────────────────────

/** Color a country polygon for Conflict View. */
export function getConflictViewColor(iso3, conflictsByCountry, country) {
  const cs = conflictsByCountry[iso3] || []
  if (cs.some(c => c.intensity === 'major' && (c.category === 'interstate_war' || c.category === 'civil_war')))
    return CONFLICT_VIEW_COLORS.active_war
  if (cs.some(c => c.intensity === 'major' || c.intensity === 'significant'))
    return CONFLICT_VIEW_COLORS.insurgency
  if (cs.some(c => c.intensity === 'minor'))
    return CONFLICT_VIEW_COLORS.tension
  if (country?.is_primary_sanctions_target)
    return CONFLICT_VIEW_COLORS.sanctions
  return CONFLICT_VIEW_COLORS.stable
}

// ── Contagion View ────────────────────────────────────────────────────────────

/**
 * Compute a "contagion exposure" score (0-100) for each country.
 * Distinct from sovereign risk: answers "if the worst hotspots escalate,
 * which countries get pulled in next?" — weighted by direct conflict
 * involvement, regional proximity, GTI tension, and sanctions exposure.
 */
export function computeContagionScores(countries, conflicts, gtiByIso3) {
  // Direct conflict involvement weights
  const directConflict = {}
  for (const c of conflicts) {
    const w = c.intensity === 'major' ? 55 : c.intensity === 'significant' ? 32 : 14
    for (const iso3 of (c.countries || [])) {
      directConflict[iso3] = Math.max(directConflict[iso3] || 0, w)
    }
  }

  // Regional proximity index — conflict load per region
  const regionLoad = {}
  for (const [iso3, w] of Object.entries(directConflict)) {
    const c = countries.find(x => x.iso3 === iso3)
    if (c?.region) regionLoad[c.region] = (regionLoad[c.region] || 0) + w
  }

  const raw = {}
  for (const c of countries) {
    let score = 0
    score += directConflict[c.iso3] || 0                        // direct involvement
    if (!directConflict[c.iso3]) {
      score += Math.min((regionLoad[c.region] || 0) * 0.35, 20) // regional bleed
    }
    const gti = gtiByIso3[c.iso3]
    score += (gti?.gti || 0) * 0.28                             // GTI tension signal
    if (c.is_primary_sanctions_target) score += 10              // financial channel
    score += (c.sovereign_risk_score || 0) * 0.12               // baseline risk
    raw[c.iso3] = score
  }

  // Normalize so the maximum maps to ~100
  const maxRaw = Math.max(...Object.values(raw), 1)
  const factor = maxRaw < 85 ? (100 / maxRaw) : 1
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.min(100, v * factor)]))
}

// Smooth gradient from deep-forest → green → amber → orange → red
function _lerp(a, b, t) { return a + (b - a) * t }
function _hex2rgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
}
function _lerpHex(hexA, hexB, t) {
  const [r1,g1,b1] = _hex2rgb(hexA)
  const [r2,g2,b2] = _hex2rgb(hexB)
  return `rgb(${Math.round(_lerp(r1,r2,t))},${Math.round(_lerp(g1,g2,t))},${Math.round(_lerp(b1,b2,t))})`
}

const _GRADIENT = ['#182c22', '#22c55e', '#fbbf24', '#f97316', '#ef4444']

/** Map a 0-100 contagion score to a gradient color. */
export function getContagionViewColor(iso3, scores) {
  const t = Math.min(scores[iso3] || 0, 100) / 100
  const seg = Math.min(Math.floor(t * (_GRADIENT.length - 1)), _GRADIENT.length - 2)
  const localT = t * (_GRADIENT.length - 1) - seg
  return _lerpHex(_GRADIENT[seg], _GRADIENT[seg + 1], localT)
}

// ── Conflict clustering ───────────────────────────────────────────────────────

/**
 * Merge nearby conflict hotspots into clusters to reduce WebGL point count.
 * Returns a new array; original conflicts are never mutated.
 */
export function clusterConflicts(conflicts, thresholdDeg = 8.5) {
  const used = new Set()
  const clusters = []
  const intensityOrder = { major: 3, significant: 2, minor: 1 }

  for (let i = 0; i < conflicts.length; i++) {
    if (used.has(i)) continue
    const group = [conflicts[i]]
    used.add(i)

    for (let j = i + 1; j < conflicts.length; j++) {
      if (used.has(j)) continue
      const dlat = conflicts[i].lat - conflicts[j].lat
      const dlng = conflicts[i].lng - conflicts[j].lng
      if (Math.sqrt(dlat * dlat + dlng * dlng) < thresholdDeg) {
        group.push(conflicts[j])
        used.add(j)
      }
    }

    if (group.length === 1) {
      clusters.push(conflicts[i])
    } else {
      const sorted = [...group].sort((a, b) =>
        (intensityOrder[b.intensity] || 0) - (intensityOrder[a.intensity] || 0)
      )
      const leader = sorted[0]
      clusters.push({
        ...leader,
        _clusterSize: group.length,
        name: `${leader.name} (+${group.length - 1})`,
        description: group.map(g => g.name).join('; '),
        parties: group.map(g => g.parties).filter(Boolean).join(' / '),
      })
    }
  }
  return clusters
}

// ── Enriched tooltip ──────────────────────────────────────────────────────────

/**
 * Build a rich HTML tooltip for a country polygon hover.
 * Includes: risk tier/score, active conflicts, GTI, sanctions status, alerts.
 */
export function buildEnrichedTooltip(country, conflicts, gtiEntry, activeAlerts) {
  if (!country) return ''

  const tier = country.risk_tier || 'none'
  const tc = TIER_COLORS_TT[tier] || TIER_COLORS_TT.none
  const score = country.sovereign_risk_score?.toFixed(1) ?? '—'
  const delta = country.risk_delta_7d
  const dStr = delta == null ? ''
    : delta > 1  ? `↑ +${delta.toFixed(1)}`
    : delta < -1 ? `↓ ${delta.toFixed(1)}`
    : `→ ${delta.toFixed(1)}`
  const dColor = delta == null ? '#64748b'
    : delta > 5  ? '#ef4444'
    : delta > 1  ? '#f97316'
    : delta < -1 ? '#22c55e'
    : '#64748b'

  // Active conflicts section
  const conflictHtml = conflicts.length
    ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,0.07)">
        <div style="color:#334155;font-size:9px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">
          Active Conflicts&ensp;(${conflicts.length})
        </div>
        ${conflicts.slice(0, 3).map(c => {
          const cc = CAT_COLORS[c.category] || '#ef4444'
          return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
            <span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${cc};box-shadow:0 0 5px ${cc}88"></span>
            <span style="color:#cbd5e1;font-size:10px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</span>
            <span style="color:${cc};font-size:9px;white-space:nowrap;margin-left:4px">${c.intensity}</span>
          </div>`
        }).join('')}
        ${conflicts.length > 3 ? `<div style="color:#334155;font-size:9px">+${conflicts.length - 3} more</div>` : ''}
      </div>`
    : ''

  // GTI bar
  const gtiHtml = gtiEntry
    ? (() => {
        const gc = gtiEntry.gti >= 75 ? '#ef4444' : gtiEntry.gti >= 55 ? '#f97316' : gtiEntry.gti >= 35 ? '#fbbf24' : '#4ade80'
        return `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:7px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06)">
          <span style="color:#334155;font-size:9px;text-transform:uppercase;letter-spacing:.06em">GTI Tension</span>
          <div style="display:flex;align-items:center;gap:5px">
            <div style="width:44px;height:3px;border-radius:2px;background:rgba(255,255,255,0.07);overflow:hidden">
              <div style="height:100%;width:${Math.min(gtiEntry.gti, 100)}%;background:linear-gradient(90deg,${gc}88,${gc});border-radius:2px;transition:width 0.4s ease"></div>
            </div>
            <span style="color:${gc};font-size:12px;font-weight:700;min-width:24px;text-align:right">${gtiEntry.gti.toFixed(0)}</span>
          </div>
        </div>`
      })()
    : ''

  // Sanctions badge
  const sanctionsHtml = country.is_primary_sanctions_target
    ? `<div style="margin-top:6px">
        <span style="font-size:9px;padding:2px 7px;border-radius:3px;background:rgba(168,85,247,0.12);color:#a78bfa;border:1px solid rgba(168,85,247,0.3);letter-spacing:.05em;text-transform:uppercase">
          ⚠ Primary Sanctions Target
        </span>
      </div>`
    : ''

  // Alerts
  const alertsHtml = activeAlerts.length
    ? `<div style="display:flex;align-items:flex-start;gap:4px;margin-top:6px;color:#fbbf24;font-size:9px">
        <span style="flex-shrink:0">🔔</span>
        <span>${activeAlerts.length} active alert${activeAlerts.length > 1 ? 's' : ''}
          ${activeAlerts[0]?.message ? `<span style="color:#475569;display:block;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${activeAlerts[0].message.slice(0, 60)}</span>` : ''}
        </span>
      </div>`
    : ''

  const drivers = (country.top_risk_drivers || []).slice(0, 2)
    .map(d => d.replace(/_/g, ' '))
    .join(' · ')

  return `<div style="background:rgba(6,4,16,0.98);border:1px solid rgba(99,102,241,0.22);border-radius:10px;padding:12px 15px;font-family:monospace;min-width:210px;max-width:270px;box-shadow:0 8px 48px rgba(0,0,0,0.95),0 0 0 1px rgba(99,102,241,0.08)">
    <div style="color:#f1f5f9;font-size:14px;font-weight:800;margin-bottom:7px;letter-spacing:-.01em">${country.name}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:10px;padding:1px 7px;border-radius:4px;background:${tc}18;color:${tc};border:1px solid ${tc}40;text-transform:uppercase;font-weight:700;letter-spacing:.06em">${tier}</span>
      <span style="color:${tc};font-size:18px;font-weight:900;line-height:1">${score}</span>
      ${dStr ? `<span style="color:${dColor};font-size:11px">${dStr}</span>` : ''}
    </div>
    ${drivers ? `<div style="color:#334155;font-size:9px;margin-top:4px;text-transform:capitalize">${drivers}</div>` : ''}
    ${sanctionsHtml}
    ${conflictHtml}
    ${gtiHtml}
    ${alertsHtml}
  </div>`
}
