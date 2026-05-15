import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Globe from './pages/Globe'
import Country from './pages/Country'
import Markets from './pages/Markets'
import Analyst from './pages/Analyst'

function Nav() {
  const base = 'px-4 py-2 text-sm font-medium rounded transition-colors'
  const active = `${base} bg-indigo-600/20 text-indigo-400 border border-indigo-500/30`
  const inactive = `${base} text-slate-400 hover:text-slate-200 hover:bg-white/5`

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center gap-1 px-4 h-12 border-b"
         style={{ background: 'rgba(10,10,15,0.95)', borderColor: '#1e1e2e', backdropFilter: 'blur(12px)' }}>
      <span className="text-sm font-semibold text-indigo-400 tracking-widest mr-4 font-mono">SOVEREIGN</span>
      <NavLink to="/" end className={({ isActive }) => isActive ? active : inactive}>Globe</NavLink>
      <NavLink to="/markets" className={({ isActive }) => isActive ? active : inactive}>Markets</NavLink>
      <NavLink to="/analyst" className={({ isActive }) => isActive ? active : inactive}>Analyst</NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <div style={{ paddingTop: '48px', minHeight: '100vh' }}>
        <Routes>
          <Route path="/" element={<Globe />} />
          <Route path="/country/:iso3" element={<Country />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/analyst" element={<Analyst />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
