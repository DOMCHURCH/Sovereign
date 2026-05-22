import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Globe2, ShieldAlert, Zap, BarChart3, Lock } from 'lucide-react'
import { auth } from '../api'

// Animated stat cards shown on the right hero panel
const STATS = [
  { icon: Globe2,     label: 'Countries Monitored', value: '50+' },
  { icon: ShieldAlert,label: 'Risk Tiers',          value: '4-Level' },
  { icon: Zap,        label: 'Data Refresh',         value: '15 min' },
  { icon: BarChart3,  label: 'Portfolio Metrics',    value: 'Live' },
]

const TESTIMONIALS = [
  {
    initials: 'DR',
    name: 'D. Reyes',
    role: 'Risk Analyst',
    text: 'Best geopolitical dashboard I\'ve used — the contagion model alone is worth it.',
  },
  {
    initials: 'MS',
    name: 'M. Schmidt',
    role: 'Portfolio Manager',
    text: 'Sovereign surfaces risks I\'d have missed. The AI analyst answers in seconds.',
  },
]

function GlassInput({ label, type = 'text', value, onChange, placeholder, onKeyDown, rightEl }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontFamily: 'monospace', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </label>
      <div style={{
        borderRadius: 12, border: '1px solid #1e2d3d',
        background: 'rgba(255,255,255,0.03)',
        transition: 'border-color 0.2s',
        display: 'flex', alignItems: 'center',
      }}
        onFocusCapture={e => e.currentTarget.style.borderColor = '#6366f1'}
        onBlurCapture={e => e.currentTarget.style.borderColor = '#1e2d3d'}
      >
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            padding: '13px 16px', fontSize: 14, fontFamily: 'monospace',
            color: '#e2e8f0', paddingRight: rightEl ? 0 : 16,
          }}
        />
        {rightEl && <div style={{ paddingRight: 12 }}>{rightEl}</div>}
      </div>
    </div>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from || '/'

  const [step, setStep] = useState('auth')   // 'auth' | 'key'
  const [tab, setTab] = useState('signin')   // 'signin' | 'signup'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [apiKey, setApiKey]     = useState('')
  const [showKey, setShowKey]   = useState(false)
  const [keyLoading, setKeyLoading] = useState(false)
  const [showSharedWarning, setShowSharedWarning] = useState(false)
  const [animIn, setAnimIn] = useState(false)

  useEffect(() => {
    // Redirect if already logged in
    if (localStorage.getItem('sov:token')) {
      navigate(from, { replace: true })
    }
    setTimeout(() => setAnimIn(true), 30)
  }, [])

  const reset = () => { setError(''); setEmail(''); setPassword('') }

  const handleAuth = async () => {
    if (!email || !password) { setError('Email and password are required'); return }
    if (tab === 'signup' && password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    try {
      const fn = tab === 'signup' ? auth.register : auth.login
      const res = await fn(email, password)
      localStorage.setItem('sov:token', res.token)
      localStorage.setItem('sov:user', JSON.stringify({ email: res.email }))
      if (res.groq_api_key) localStorage.setItem('sov:user_api_key', res.groq_api_key)
      setStep('key')
    } catch (e) {
      if (e.message.includes('409')) setError('An account with that email already exists')
      else if (e.message.includes('401')) setError('Invalid email or password')
      else setError('Something went wrong — check your connection')
    } finally { setLoading(false) }
  }

  const handleSaveKey = async () => {
    setKeyLoading(true)
    try {
      if (apiKey.trim()) {
        await auth.updateKey(apiKey.trim())
        localStorage.setItem('sov:user_api_key', apiKey.trim())
      }
    } catch {}
    finally { setKeyLoading(false) }
    navigate(from, { replace: true })
  }

  const handleSkipKey = () => {
    setShowSharedWarning(true)
  }

  const confirmSkip = () => {
    navigate(from, { replace: true })
  }

  const onEnter = e => e.key === 'Enter' && handleAuth()

  const fadeStyle = (delay = 0) => ({
    opacity: animIn ? 1 : 0,
    transform: animIn ? 'translateY(0)' : 'translateY(12px)',
    transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
  })

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#07070f', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Left: form ─────────────────────────────────────────────────────── */}
      <div style={{
        flex: '0 0 auto', width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '48px 48px', gap: 0,
      }}>

        {/* Logo */}
        <div style={{ ...fadeStyle(0), marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1, #a78bfa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Globe2 size={16} color="white" />
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
              SOVEREIGN
            </span>
          </div>
          <p style={{ fontSize: 12, color: '#334155', fontFamily: 'monospace', letterSpacing: '0.06em' }}>
            Geopolitical Risk Intelligence Platform
          </p>
        </div>

        {step === 'auth' && (
          <>
            {/* Heading */}
            <div style={{ ...fadeStyle(80), marginBottom: 28 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9', margin: 0, marginBottom: 6, lineHeight: 1.2 }}>
                {tab === 'signin' ? 'Welcome back' : 'Create account'}
              </h1>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                {tab === 'signin'
                  ? 'Sign in to access the AI Analyst and full platform features'
                  : 'Join to get personalized risk analysis and AI-powered intelligence'}
              </p>
            </div>

            {/* Tab switcher */}
            <div style={{ ...fadeStyle(120), display: 'flex', gap: 4, padding: 4, borderRadius: 10, background: '#0f0f1a', border: '1px solid #1e1e2e', marginBottom: 24 }}>
              {[['signin', 'Sign In'], ['signup', 'Sign Up']].map(([t, label]) => (
                <button key={t} onClick={() => { reset(); setTab(t) }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                    fontFamily: 'monospace', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
                    background: tab === t ? 'rgba(99,102,241,0.25)' : 'transparent',
                    color: tab === t ? '#a78bfa' : '#475569',
                    transition: 'all 0.2s',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Error */}
            {error && (
              <div style={{
                marginBottom: 16, padding: '10px 14px', borderRadius: 10,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                fontSize: 12, fontFamily: 'monospace', color: '#f87171',
              }}>
                {error}
              </div>
            )}

            {/* Fields */}
            <div style={{ ...fadeStyle(160), display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
              <GlassInput label="Email Address" type="email" value={email} onChange={setEmail}
                placeholder="you@example.com" onKeyDown={onEnter} />
              <GlassInput label="Password" value={password} onChange={setPassword}
                placeholder={tab === 'signup' ? 'Min 6 characters' : '••••••••'}
                type={showPw ? 'text' : 'password'} onKeyDown={onEnter}
                rightEl={
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', padding: 4 }}>
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                } />
            </div>

            {/* Submit */}
            <div style={fadeStyle(200)}>
              <button onClick={handleAuth} disabled={loading}
                style={{
                  width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  background: loading ? 'rgba(99,102,241,0.15)' : 'linear-gradient(135deg, #6366f1, #7c3aed)',
                  color: loading ? '#6366f1' : 'white',
                  fontSize: 14, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.06em',
                  transition: 'all 0.2s', boxShadow: loading ? 'none' : '0 4px 20px rgba(99,102,241,0.3)',
                }}>
                {loading ? '...' : tab === 'signin' ? 'Sign In →' : 'Create Account →'}
              </button>
            </div>

            {/* Footer */}
            <p style={{ ...fadeStyle(240), textAlign: 'center', fontSize: 12, color: '#475569', fontFamily: 'monospace', marginTop: 16 }}>
              {tab === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={() => { reset(); setTab(tab === 'signin' ? 'signup' : 'signin') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', padding: 0, fontFamily: 'monospace', fontSize: 12, textDecoration: 'underline' }}>
                {tab === 'signin' ? 'Sign up free' : 'Sign in'}
              </button>
            </p>

            {/* Skip to app */}
            <div style={{ ...fadeStyle(280), textAlign: 'center', marginTop: 28, paddingTop: 20, borderTop: '1px solid #1e1e2e' }}>
              <button onClick={() => navigate(from, { replace: true })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.06em' }}>
                Continue without signing in (AI Analyst unavailable) →
              </button>
            </div>
          </>
        )}

        {step === 'key' && !showSharedWarning && (
          <>
            <div style={{ ...fadeStyle(0), marginBottom: 28 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>✓</span>
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9', margin: 0, marginBottom: 6 }}>You're in!</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
                One optional step — add your own Groq API key for dedicated AI access.
              </p>
            </div>

            {/* Info banner */}
            <div style={{ ...fadeStyle(80), padding: '12px 14px', borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#818cf8', fontWeight: 700, marginBottom: 4 }}>✓ PLATFORM KEY ACTIVE</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                The AI Analyst works right now using the platform's shared key. If many users are active simultaneously, responses may be rate-limited. Adding your own key guarantees unthrottled access.
              </div>
            </div>

            <div style={{ ...fadeStyle(120), marginBottom: 16 }}>
              <GlassInput label="Your Groq API Key (optional — free at groq.com)"
                value={apiKey} onChange={setApiKey}
                placeholder="gsk_... leave blank to use the platform key"
                type={showKey ? 'text' : 'password'}
                rightEl={
                  <button type="button" onClick={() => setShowKey(s => !s)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', padding: 4 }}>
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                } />
            </div>

            <div style={{ ...fadeStyle(160), display: 'flex', gap: 8 }}>
              <button onClick={handleSaveKey} disabled={keyLoading}
                style={{
                  flex: 1, padding: '13px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
                  color: 'white', fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
                  boxShadow: '0 4px 20px rgba(99,102,241,0.3)',
                }}>
                {keyLoading ? 'Saving…' : apiKey.trim() ? 'Save & Continue →' : 'Continue →'}
              </button>
              <button onClick={handleSkipKey}
                style={{
                  padding: '13px 20px', borderRadius: 12, border: '1px solid #1e2d3d',
                  background: 'transparent', color: '#475569', fontSize: 13, fontFamily: 'monospace',
                  cursor: 'pointer',
                }}>
                Skip
              </button>
            </div>

            <p style={{ ...fadeStyle(200), textAlign: 'center', fontSize: 11, color: '#334155', fontFamily: 'monospace', marginTop: 14 }}>
              You can always add a key later from the account menu.
            </p>
          </>
        )}

        {/* Shared key warning confirmation */}
        {step === 'key' && showSharedWarning && (
          <div style={fadeStyle(0)}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <ShieldAlert size={22} color="#fbbf24" />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0, marginBottom: 10 }}>Heads up</h2>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, marginBottom: 24 }}>
              The platform's shared Groq key is rate-limited across all users. During peak usage the AI Analyst may respond slowly or temporarily return an error. You can add your own key at any time from the account menu — it takes 30 seconds and Groq's free tier is generous.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={confirmSkip}
                style={{
                  padding: '13px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: 'rgba(99,102,241,0.15)', color: '#a78bfa',
                  border: '1px solid rgba(99,102,241,0.3)',
                  fontSize: 13, fontWeight: 600, fontFamily: 'monospace',
                }}>
                Continue anyway →
              </button>
              <button onClick={() => setShowSharedWarning(false)}
                style={{
                  padding: '13px', borderRadius: 12, border: '1px solid #1e2d3d',
                  background: 'transparent', color: '#64748b',
                  fontSize: 13, fontFamily: 'monospace', cursor: 'pointer',
                }}>
                ← Add my own key
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: hero panel ──────────────────────────────────────────────── */}
      <div style={{
        flex: 1, position: 'relative', overflow: 'hidden',
        display: 'none',
      }}
        className="md:block"
      >
        {/* Background gradient */}
        <div style={{
          position: 'absolute', inset: 16, borderRadius: 20,
          background: 'linear-gradient(135deg, #0d0d20 0%, #0a0a18 50%, #070712 100%)',
          border: '1px solid #1e1e2e', overflow: 'hidden',
        }}>
          {/* Grid overlay */}
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.04,
            backgroundImage: 'linear-gradient(#6366f1 1px, transparent 1px), linear-gradient(90deg, #6366f1 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }} />

          {/* Glow orb */}
          <div style={{
            position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 400, height: 400, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Branding */}
          <div style={{ position: 'absolute', top: 36, left: 36, right: 36 }}>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              LIVE INTELLIGENCE
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', lineHeight: 1.2, fontFamily: 'monospace' }}>
              Geopolitical risk<br />
              <span style={{ color: '#818cf8' }}>quantified.</span>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{
            position: 'absolute', top: '50%', left: 36, right: 36,
            transform: 'translateY(-50%)',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
          }}>
            {STATS.map(({ icon: Icon, label, value }) => (
              <div key={label} style={{
                padding: '16px', borderRadius: 14,
                background: 'rgba(255,255,255,0.03)', border: '1px solid #1e2d3d',
                backdropFilter: 'blur(10px)',
              }}>
                <Icon size={18} color="#6366f1" style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace', marginBottom: 2 }}>{value}</div>
                <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Testimonials */}
          <div style={{ position: 'absolute', bottom: 28, left: 28, right: 28, display: 'flex', gap: 12 }}>
            {TESTIMONIALS.map(t => (
              <div key={t.name} style={{
                flex: 1, padding: '14px', borderRadius: 14,
                background: 'rgba(255,255,255,0.03)', border: '1px solid #1e2d3d',
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: 'white', fontFamily: 'monospace',
                  }}>{t.initials}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{t.role}</div>
                  </div>
                </div>
                <p style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6, margin: 0 }}>"{t.text}"</p>
              </div>
            ))}
          </div>

          {/* Live indicator */}
          <div style={{
            position: 'absolute', top: 28, right: 28,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 20,
            background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', animation: 'pulse-ring 2s infinite' }} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#4ade80', fontWeight: 600, letterSpacing: '0.08em' }}>LIVE</span>
          </div>
        </div>
      </div>
    </div>
  )
}
