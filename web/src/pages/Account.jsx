import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../api'

function Section({ title, children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-slate-500">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function Field({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
      <span className="text-xs font-mono text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono' : ''} text-slate-200`}>{value || '—'}</span>
    </div>
  )
}

export default function Account() {
  const navigate = useNavigate()

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('sov:user') || 'null') } catch { return null }
  })()

  const [apiKey, setApiKey]   = useState(localStorage.getItem('sov:user_api_key') || '')
  const [showKey, setShowKey] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [keyError, setKeyError] = useState('')

  useEffect(() => {
    if (!localStorage.getItem('sov:token')) navigate('/login', { replace: true })
  }, [])

  const handleSaveKey = async () => {
    setSaving(true); setKeyError(''); setSaved(false)
    try {
      await auth.updateKey(apiKey.trim())
      apiKey.trim()
        ? localStorage.setItem('sov:user_api_key', apiKey.trim())
        : localStorage.removeItem('sov:user_api_key')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setKeyError('Failed to save — check your connection')
    } finally { setSaving(false) }
  }

  const handleLogout = () => {
    auth.logout()
    navigate('/login', { replace: true })
  }

  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean).map(s => s[0].toUpperCase()).join('') || user?.email?.[0]?.toUpperCase() || '?'

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold font-mono text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)' }}
        >
          {initials}
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            {[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Your Account'}
          </h1>
          <p className="text-sm text-slate-500 font-mono mt-0.5">{user?.email}</p>
          {user?.role && (
            <p className="text-xs text-slate-600 mt-0.5">{user.role}</p>
          )}
        </div>
      </div>

      {/* Profile info */}
      <Section title="Profile">
        <Field label="First Name"  value={user?.firstName} />
        <Field label="Last Name"   value={user?.lastName} />
        <Field label="Email"       value={user?.email} mono />
        <Field label="Role"        value={user?.role} />
      </Section>

      {/* API Key */}
      <Section title="Groq API Key">
        <p className="text-xs text-slate-500 leading-relaxed mb-4">
          The AI Analyst works out of the box using the platform's shared key. Add your own free{' '}
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
             className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
            Groq API key
          </a>{' '}
          for dedicated rate limits and priority access.
        </p>

        {/* Status banner */}
        {localStorage.getItem('sov:user_api_key') ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-xs font-mono"
               style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}>
            <span>✓</span>
            <span>Personal key active — unthrottled access enabled</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-xs font-mono"
               style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>
            <span>·</span>
            <span>Using platform shared key</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-mono text-slate-500 uppercase tracking-wide mb-1.5">
              API Key
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center rounded-lg overflow-hidden"
                   style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="gsk_… leave blank to use platform key"
                  className="flex-1 bg-transparent text-sm font-mono text-slate-300 placeholder-slate-600 outline-none px-3 py-2.5"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(s => !s)}
                  className="px-3 text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {showKey ? (
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <button
                onClick={handleSaveKey}
                disabled={saving}
                className="px-4 py-2.5 rounded-lg text-sm font-mono font-semibold transition-all shrink-0"
                style={{
                  background: saved ? 'rgba(74,222,128,0.15)' : 'rgba(99,102,241,0.2)',
                  border: `1px solid ${saved ? 'rgba(74,222,128,0.3)' : 'rgba(99,102,241,0.35)'}`,
                  color: saved ? '#4ade80' : '#a78bfa',
                }}
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </div>
          {keyError && (
            <p className="text-xs text-red-400 font-mono">{keyError}</p>
          )}
          {apiKey && (
            <button
              onClick={() => { setApiKey(''); localStorage.removeItem('sov:user_api_key') }}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors font-mono"
            >
              Remove key and use platform default
            </button>
          )}
        </div>
      </Section>

      {/* Platform stats */}
      <Section title="Platform">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Countries', value: '50+' },
            { label: 'Data Refresh', value: '15 min' },
            { label: 'Risk Tiers', value: '4-Level' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg px-3 py-3 text-center"
                 style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)' }}>
              <div className="text-base font-bold font-mono text-slate-200">{value}</div>
              <div className="text-xs text-slate-600 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Sign out */}
      <div className="pt-2">
        <button
          onClick={handleLogout}
          className="w-full py-3 rounded-xl text-sm font-mono font-semibold transition-all"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}
        >
          Sign Out
        </button>
      </div>

    </div>
  )
}
