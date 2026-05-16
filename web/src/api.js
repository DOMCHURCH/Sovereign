const BASE = import.meta.env.VITE_API_URL || '/api'

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
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

export const api = {
  countries: () => get('/countries'),
  country: (iso3) => get(`/countries/${iso3}`),
  countryHistory: (iso3) => get(`/countries/${iso3}/history`),
  countryContagion: (iso3) => get(`/countries/${iso3}/contagion`),
  alerts: () => get('/alerts'),
  acknowledgeAlert: (id) => post(`/alerts/${id}/acknowledge`, {}),
  portfolio: () => get('/portfolio'),
  portfolioImpact: () => get('/portfolio/impact'),
  portfolioStress: (country, shock) => post('/portfolio/stress', { country, shock_magnitude: shock }),
  countryNews: (iso3) => get(`/countries/${iso3}/news`),
  acknowledgeAllAlerts: () => post('/alerts/acknowledge-all', {}),
  conflicts: () => get('/conflicts'),
  conflictsSource: () => get('/conflicts/source'),
  graph: () => get('/graph'),
  ingestStatus: () => get('/ingest/status'),
  runIngest: () => post('/ingest/run', {}),
  gti: () => get('/gti'),
  newsFeed: (iso3) => iso3 ? get(`/news/feed?iso3=${iso3}`) : get('/news/feed'),
  marketSnapshot: () => get('/market/snapshot'),
}

export async function streamAnalyst(message, history, countryContext, onChunk, onDone) {
  const res = await fetch(`${BASE}/analyst`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, country_context: countryContext }),
  })

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
