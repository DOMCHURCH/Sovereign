const BASE = import.meta.env.VITE_API_URL || '/api'

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

// ── Stale-while-revalidate localStorage cache ──────────────────────────────
// On cache hit: return stored data immediately, silently refresh in background.
// On cold load: fetch and wait normally, then cache result.
// localStorage failures (private browsing, storage full) are silently ignored.

function _cacheGet(key) {
  try {
    const raw = localStorage.getItem(`sov2:${key}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    return { data, age: Date.now() / 1000 - ts }
  } catch { return null }
}

function _cacheSet(key, data) {
  try {
    localStorage.setItem(`sov2:${key}`, JSON.stringify({ data, ts: Date.now() / 1000 }))
  } catch {}
}

/**
 * Stale-while-revalidate fetch.
 * ttl: seconds before cached data is considered stale.
 * - Fresh cache (age < ttl): return immediately; pre-warm if >80% expired.
 * - Stale cache (age ≥ ttl): return stale immediately + refresh background.
 * - No cache: await fresh fetch.
 */
async function cachedGet(path, ttl) {
  const cacheKey = path
  const fetchFresh = () => get(path).then(data => { _cacheSet(cacheKey, data); return data })

  const cached = _cacheGet(cacheKey)

  if (cached) {
    if (cached.age < ttl) {
      if (cached.age > ttl * 0.8) fetchFresh().catch(() => {})  // pre-warm near expiry
      return cached.data
    }
    // Stale — return immediately, refresh silently
    fetchFresh().catch(() => {})
    return cached.data
  }

  // Cold — must wait
  return fetchFresh()
}

// ── API surface ────────────────────────────────────────────────────────────────
// Cached endpoints use stale-while-revalidate; TTLs match backend cache.
// Write operations (POST) and per-country detail views bypass cache.

export const api = {
  // Cached list endpoints
  countries:       ()      => cachedGet('/countries',        300),   // 5 min
  alerts:          ()      => cachedGet('/alerts',            60),   // 1 min
  portfolio:       ()      => cachedGet('/portfolio',        600),   // 10 min
  portfolioImpact: ()      => cachedGet('/portfolio/impact', 600),   // 10 min
  conflicts:       ()      => cachedGet('/conflicts',        1800),  // 30 min
  gti:             ()      => cachedGet('/gti',              900),   // 15 min
  marketSnapshot:  ()      => cachedGet('/market/snapshot',  300),   // 5 min
  dashboard:       ()      => cachedGet('/dashboard',        120),   // 2 min
  weather:         ()      => cachedGet('/weather',          600),   // 10 min
  newsFeed:        (iso3)  => iso3
                               ? get(`/news/feed?iso3=${iso3}`)      // per-country, not cached
                               : cachedGet('/news/feed', 180),       // 3 min

  // Per-entity lookups — not cached (content changes with each visit)
  country:         (iso3)  => get(`/countries/${iso3}`),
  countryHistory:  (iso3)  => get(`/countries/${iso3}/history`),
  countryContagion:(iso3)  => get(`/countries/${iso3}/contagion`),
  countryNews:     (iso3)  => get(`/countries/${iso3}/news`),
  countryWeather:  (iso3)  => get(`/countries/${iso3}/weather`),
  countryReport:   (iso3)  => get(`/countries/${iso3}/report`),

  // Write operations and misc
  acknowledgeAlert:    (id)  => post(`/alerts/${id}/acknowledge`, {}),
  acknowledgeAllAlerts: ()   => post('/alerts/acknowledge-all', {}),
  portfolioStress: (country, shock) => post('/portfolio/stress', { country, shock_magnitude: shock }),
  runScenario: (country, shock_type, shock_magnitude) =>
                              post('/scenario', { country, shock_type, shock_magnitude }),
  conflictsSource: ()  => get('/conflicts/source'),
  graph:           ()  => get('/graph'),
  ingestStatus:    ()  => get('/ingest/status'),
  dataFreshness:   ()  => get('/data-freshness'),
  runIngest:       ()  => post('/ingest/run', {}),
}

export async function streamAnalyst(message, history, countryContext, onChunk, onDone) {
  const res = await fetch(`${BASE}/analyst`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, country_context: countryContext }),
  })

  if (!res.ok) { onDone(); return; }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') { onDone(); return; }
      try {
        const parsed = JSON.parse(data)
        if (parsed.text) onChunk(parsed.text)
      } catch {}
    }
  }
  onDone()
}
