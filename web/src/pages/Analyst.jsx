import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, streamAnalyst } from '../api'
import StreamingText from '../components/StreamingText'

const SUGGESTED = [
  'Which countries are most likely to have a crisis in the next 6 months?',
  'Walk me through China\'s current risk profile',
  'How exposed is my portfolio to Middle East instability?',
  'If Turkey has a currency crisis, what\'s the contagion path?',
  'Explain my factor exposures in plain English',
  'Compare Russia and Brazil risk scores',
]

const SOURCE_PILLS = ['World Bank', 'OFAC', 'Markets', 'NewsAPI']

export default function Analyst() {
  const [searchParams] = useSearchParams()
  const countryCtx = searchParams.get('country')

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [meta, setMeta] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    Promise.all([api.countries(), api.alerts(), api.portfolioImpact()])
      .then(([countries, alerts, impact]) => {
        const activeAlerts = alerts.filter(a => !a.acknowledged)
        setMeta({
          countryCount: countries.length,
          alertCount: activeAlerts.length,
          impact: impact?.total_shock_pct,
        })
      }).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text) => {
    if (!text.trim() || streaming) return

    const userMsg = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    const assistantMsg = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, assistantMsg])

    const history = messages.map(m => ({ role: m.role, content: m.content }))

    await streamAnalyst(
      text,
      history,
      countryCtx || undefined,
      (chunk) => {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + chunk,
          }
          return updated
        })
      },
      () => setStreaming(false),
    )
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col h-screen" style={{ paddingTop: 0 }}>
      {/* Context bar */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs border-b"
           style={{ background: '#0d0d14', borderColor: '#1e1e2e' }}>
        <span className="font-mono text-indigo-400 font-semibold">SOVEREIGN ANALYST</span>
        {meta && (
          <>
            <span className="text-slate-500">{meta.countryCount} countries monitored</span>
            <span className="text-slate-500">·</span>
            <span className={meta.alertCount > 0 ? 'text-red-400' : 'text-slate-500'}>
              {meta.alertCount} alerts
            </span>
            <span className="text-slate-500">·</span>
            <span className={meta.impact < -0.01 ? 'text-red-400' : 'text-green-400'}>
              Portfolio: {meta.impact != null ? `${(meta.impact * 100).toFixed(2)}%` : '—'} est. P&amp;L
            </span>
          </>
        )}
        {countryCtx && (
          <>
            <span className="text-slate-500">·</span>
            <span className="text-indigo-400 font-mono">Context: {countryCtx}</span>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8 mt-8">
              <h2 className="text-lg font-semibold text-slate-300 mb-1">Sovereign Risk Intelligence</h2>
              <p className="text-sm text-slate-500">
                Ask about country risk, portfolio exposure, contagion paths, or macro scenarios.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SUGGESTED.map(q => (
                <button key={q} onClick={() => send(q)}
                        className="text-left px-3 py-2.5 rounded-lg border text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
                        style={{ borderColor: '#1e1e2e' }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-2xl rounded-xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-indigo-600/20 border border-indigo-500/20 text-slate-200'
                : 'border text-slate-300'
            }`}
            style={msg.role !== 'user' ? { background: '#12121a', borderColor: '#1e1e2e' } : {}}>
              {msg.role === 'user' ? (
                <p className="text-sm">{msg.content}</p>
              ) : (
                <div>
                  <StreamingText
                    text={msg.content}
                    isStreaming={streaming && i === messages.length - 1}
                  />
                  {(!streaming || i < messages.length - 1) && msg.content && (
                    <div className="flex gap-1.5 mt-3 flex-wrap">
                      {SOURCE_PILLS.map(s => (
                        <span key={s} className="text-xs px-2 py-0.5 rounded-full font-mono"
                              style={{ background: '#1e1e2e', color: '#64748b' }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t" style={{ background: '#0d0d14', borderColor: '#1e1e2e' }}>
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about a country, scenario, or portfolio exposure..."
            rows={1}
            className="flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 bg-transparent outline-none transition-colors"
            style={{ borderColor: '#2e2e42', background: '#12121a', minHeight: 44, maxHeight: 120 }}
            disabled={streaming}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || streaming}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium transition-colors shrink-0"
          >
            {streaming ? '...' : 'Send'}
          </button>
        </div>
        <p className="text-center text-xs text-slate-600 mt-2">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  )
}
