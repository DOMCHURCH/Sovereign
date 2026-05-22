import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Remove the HTML boot screen once React takes over
function hideBoot() {
  const el = document.getElementById('boot')
  if (!el) return
  el.classList.add('gone')
  setTimeout(() => el.remove(), 450)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App onReady={hideBoot} />
  </React.StrictMode>
)
