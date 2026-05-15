import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { api, streamAnalyst } from '../api'

const TIER_COLORS = { low: '#22c55e', elevated: '#eab308', high: '#f97316', severe: '#ef4444' }

const SUGGESTED = [
  "What are the top geopolitical risks right now?",
  "Which countries pose the highest contagion risk?",
  "Summarize portfolio exposure to high-risk nations",
  "What's driving elevated risk in emerging markets?",
]

function Message({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
        isUser ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
      }`}>
        {isUser ? 'U' : 'AI'}
      </div>
      <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? 'bg-indigo-600/20 border border-indigo-500/30 text-slate-200'
          : 'bg-slate-800/60 border border-slate-700/50 text-slate-300'
      }`}>
        {msg.content}
        {msg.streaming && (
          <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-1 animate-pulse align-text-bottom" />
        )}
      </div>
    </div>
  )
}

function CountryCard({ c, onClick }) {
  return (
    <button
      onClick={() => onClick(c.iso3)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-white/5 transition-colors text-left w-full"
      style={{ borderColor: '#2e2e42', background: '#12121a' }}
    >
      <span className="font-mono text-xs text-slate-500 w-8">{c.iso3}</span>
      <span className="text-sm text-slate-300 flex-1 truncate">{c.name}</span>
      <span className="font-mono text-xs font-bold shrink-0"
            style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
        {c.sovereign_risk_score?.toFixed(0)}
      </span>
    </button>
  )
}

export default function Analyst() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const countryParam = searchParams.get('country')

  const [countries, setCountries] = useState([])
  const [focusCountry, setFocusCountry] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    api.countries().then(d => {
      const sorted = d.filter(c => c.sovereign_risk_score != null)
        .sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score)
      setCountries(sorted)

      if (countryParam) {
        const c = d.find(x => x.iso3 === countryParam.toUpperCase())
        if (c) {
          setFocusCountry(c)
          const welcome = {
            role: 'assistant',
            content: `I'm analyzing ${c.name} (risk score: ${c.sovereign_risk_score?.toFixed(1)}, tier: ${c.risk_tier}). What would you like to know?`,
          }
          setMessages([welcome])
        }
      }
    }).catch(() => {})
  }, [countryParam])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const filteredCountries = countries.filter(c =>
    !countrySearch || c.name.toLowerCase().includes(countrySearch.toLowerCase()) || c.iso3.toLowerCase().includes(countrySearch.toLowerCase())
  )

  const selectCountry = (iso3) => {
    const c = countries.find(x => x.iso3 === iso3)
    setFocusCountry(c || null)
    setShowCountryPicker(false)
    setCountrySearch('')
    if (c) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Switching focus to ${c.name} (risk score: ${c.sovereign_risk_score?.toFixed(1)}, tier: ${c.risk_tier}). What would you like to know?`,
        }
      ])
    }
  }

  const clearCountry = () => {
    setFocusCountry(null)
    setMessages(prev => [...prev, { role: 'assistant', content: 'Cleared country focus. I can now answer questions about any country or the global situation.' }])
  }

  const send = async (text) => {
    const msg = text || input.trim()
    if (!msg || streaming) return
    setInput('')

    const userMsg = { role: 'user', content: msg }
    const assistantMsg = { role: 'assistant', content: '', streaming: true }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    const history = messages.map(m => ({ role: m.role, content: m.content }))
    const context = focusCountry ? focusCountry.iso3 : null

    try {
      await streamAnalyst(
        msg,
        history,
        context,
        (chunk) => {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.streaming) {
              return [...prev.slice(0, -1), { ...last, content: last.content + chunk }]
            }
            return prev
          })
        },
        () => {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.streaming) {
              return [...prev.slice(0, -1), { ...last, streaming: false }]
            }
            return prev
          })
          setStreaming(false)
        }
      )
    } catch (err) {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.streaming) {
          return [...prev.slice(0, -1), { role: 'assistant', content: 'Error connecting to analyst. Please try again.' }]
        }
        return prev
      })
      setStreaming(false)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Left sidebar */}
      <div className="w-64 flex flex-col border-r shrink-0" style={{ borderColor: '#1e1e2e', background: '#0d0d14' }}>
        <div className="p-4 border-b" style={{ borderColor: '#1e1e2e' }}>
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase mb-3">Country Focus</h2>

          {focusCountry ? (
            <div className="rounded-lg border p-3" style={{ borderColor: '#2e2e42', background: '#12121a' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-200 truncate">{focusCountry.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                          style={{ background: `${TIER_COLORS[focusCountry.risk_tier]}20`, color: TIER_COLORS[focusCountry.risk_tier] }}>
                      {focusCountry.risk_tier?.toUpperCase()}
                    </span>
                    <span className="font-mono text-sm font-bold"
                          style={{ color: TIER_COLORS[focusCountry.risk_tier] || '#64748b' }}>
                      {focusCountry.sovereign_risk_score?.toFixed(1)}
                    </span>
                  </div>
                </div>
                <button onClick={clearCountry} className="text-slate-600 hover:text-slate-400 text-lg leading-none mt-0.5">×</button>
              </div>
              <button
                onClick={() => navigate(`/country/${focusCountry.iso3}`)}
                className="mt-2 w-full text-xs text-indigo-400 hover:text-indigo-300 text-left transition-colors"
              >
                View full analysis →
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCountryPicker(p => !p)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-dashed text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-colors"
              style={{ borderColor: '#2e2e42' }}
            >
              + Focus on a country
            </button>
          )}

          {showCountryPicker && (
            <div className="mt-2">
              <input
                value={countrySearch}
                onChange={e => setCountrySearch(e.target.value)}
                placeholder="Search..."
                autoFocus
                className="w-full text-xs px-2 py-1.5 rounded border bg-transparent text-slate-300 placeholder-slate-600 outline-none"
                style={{ borderColor: '#2e2e42' }}
              />
              <div className="mt-1 max-h-48 overflow-y-auto space-y-0.5">
                {filteredCountries.slice(0, 20).map(c => (
                  <CountryCard key={c.iso3} c={c} onClick={selectCountry} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Suggested questions */}
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase mb-3">Suggested</h2>
          <div className="space-y-2">
            {SUGGESTED.map(q => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={streaming}
                className="w-full text-left text-xs text-slate-400 hover:text-slate-200 px-3 py-2 rounded-lg border hover:bg-white/5 transition-colors disabled:opacity-40"
                style={{ borderColor: '#1e1e2e' }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-3 border-b flex items-center gap-3" style={{ borderColor: '#1e1e2e', background: '#0a0a0f' }}>
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-mono text-slate-400">
            Sovereign AI Analyst
            {focusCountry && (
              <span className="text-indigo-400"> · {focusCountry.name}</span>
            )}
          </span>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Clear chat
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                <span className="text-2xl">🌐</span>
              </div>
              <h3 className="text-slate-300 font-semibold mb-2">Sovereign Intelligence Analyst</h3>
              <p className="text-slate-500 text-sm max-w-sm">
                Ask me anything about geopolitical risk, country stability, or portfolio exposure.
                {!focusCountry && ' Focus on a specific country for targeted analysis.'}
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <Message key={i} msg={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t" style={{ borderColor: '#1e1e2e', background: '#0a0a0f' }}>
          <div className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={streaming}
              placeholder={focusCountry ? `Ask about ${focusCountry.name}...` : 'Ask about geopolitical risk...'}
              rows={1}
              className="flex-1 text-sm px-4 py-3 rounded-xl border bg-transparent text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500 transition-colors resize-none disabled:opacity-50"
              style={{ borderColor: '#2e2e42', minHeight: 48, maxHeight: 120 }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || streaming}
              className="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
              style={{ height: 48 }}
            >
              {streaming ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                </span>
              ) : '↑'}
            </button>
          </div>
          <p className="text-xs text-slate-700 mt-2">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  )
}
