import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Capture the install prompt as early as possible — before React even mounts.
// If we wait until a component mounts, the browser may have already fired the
// event and it will never fire again in the same session.
window.deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.deferredInstallPrompt = e
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
