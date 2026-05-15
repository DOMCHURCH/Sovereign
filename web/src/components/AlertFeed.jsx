import { useEffect, useState } from 'react'
import { api } from '../api'

const SEV_ICON = { critical: '🔴', warning: '⚠️', watch: '👁' }

export default function AlertFeed({ limit = 20, compact = false }) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    api.alerts().then(setAlerts).catch(() => {})
    const t = setInterval(() => api.alerts().then(setAlerts).catch(() => {}), 30000)
    return () => clearInterval(t)
  }, [])

  const ack = async (id) => {
    await api.acknowledgeAlert(id)
    setAlerts(a => a.filter(x => x.id !== id))
  }

  const ackAll = async () => {
    await api.acknowledgeAllAlerts()
    setAlerts([])
  }

  const shown = alerts.filter(a => !a.acknowledged).slice(0, limit)

  if (!shown.length) {
    return (
      <div className="text-xs text-slate-500 py-3 text-center">
        No active alerts
      </div>
    )
  }

  return (
    <div>
      {shown.length > 0 && (
        <div className="flex justify-end mb-1.5">
          <button onClick={ackAll}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Acknowledge all
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {shown.map(alert => (
          <div key={alert.id}
               className={`flex items-start gap-2 rounded px-3 py-2 border ${compact ? 'text-xs' : 'text-sm'}`}
               style={{ background: 'rgba(18,18,26,0.8)', borderColor: '#1e1e2e' }}>
            <span className="mt-0.5 shrink-0">{SEV_ICON[alert.severity]}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`font-mono text-xs font-semibold badge-${alert.severity} px-1.5 py-0.5 rounded`}>
                  {alert.severity.toUpperCase()}
                </span>
                <span className="text-slate-400 font-mono text-xs">{alert.country_iso3}</span>
              </div>
              <p className="text-slate-300 leading-snug">{alert.message}</p>
            </div>
            <button onClick={() => ack(alert.id)}
                    className="text-slate-600 hover:text-slate-300 text-xs shrink-0 mt-0.5 transition-colors">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
