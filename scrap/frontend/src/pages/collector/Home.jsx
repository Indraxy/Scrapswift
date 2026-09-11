import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Calculator, Coins, Download, Package, Receipt, Recycle, Wallet, LogOut, Smartphone, X, CheckCircle } from 'lucide-react'
import { useI18n } from '../../i18n'
import { catalog, auth } from '../../services/api'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { getCache, putCache } from '../../offline/db'
import { RateBoard, SpeakButton } from '../../components/ui'
import { priceSentence } from '../../services/voice'

const TILES = [
  { to: '/app/new', key: 'sellEwaste', icon: Package, tone: 'bg-board text-white' },
  { to: '/app/prices', key: 'todaysPrices', icon: Coins, tone: 'bg-brass text-ink' },
  { to: '/app/recyclers', key: 'findRecycler', icon: Recycle, tone: 'bg-white' },
  { to: '/app/earnings', key: 'myEarnings', icon: Wallet, tone: 'bg-white' },
  { to: '/app/lots', key: 'myLots', icon: Receipt, tone: 'bg-white' },
  { to: '/app/estimate', key: 'estimator', icon: Calculator, tone: 'bg-brass text-ink' },
  { to: '/app/safety', key: 'safety', icon: AlertTriangle, tone: 'bg-copper text-white' },
]

export default function Home() {
  const { t, lang } = useI18n()
  const user = useCurrentUser()
  const navigate = useNavigate()
  const [board, setBoard] = useState([])
  // Re-check window.deferredInstallPrompt on every render so we pick it up
  // even if it fired slightly after component mount.
  const [, tick] = useState(0)
  const [installStatus, setInstallStatus] = useState(null) // null | 'accepted' | 'dismissed' | 'guide'
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    let alive = true
    getCache('price-board').then((cached) => {
      if (alive && cached && !board.length) setBoard(cached)
    })
    catalog.prices().then((rows) => {
      if (!alive) return
      setBoard(rows)
      putCache('price-board', rows)
    }).catch(() => {})

    // Listen for the prompt arriving late (e.g. slow PWA criteria check)
    const onPrompt = (e) => { e.preventDefault(); window.deferredInstallPrompt = e; tick(n => n + 1) }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // Hide the button once the app is installed
    const onInstalled = () => { window.deferredInstallPrompt = null; setInstallStatus('accepted') }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      alive = false
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = () => {
    auth.logout()
    navigate('/')
  }

  const handleInstall = async () => {
    const prompt = window.deferredInstallPrompt
    if (prompt) {
      // Trigger the native Android "Add to Home Screen" install sheet immediately
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      window.deferredInstallPrompt = null
      setInstallStatus(outcome === 'accepted' ? 'accepted' : 'dismissed')
    } else {
      // Browser never fired the event: already installed, or iOS/unsupported
      setShowGuide(true)
    }
  }

  const top = board.slice(0, 4)
  const spoken = top
    .map((r) => priceSentence({ category: r.category, min: r.min_price, max: r.max_price, trend: r.trend }, lang))
    .join(' ')

  const canInstall = Boolean(window.deferredInstallPrompt)

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-display text-3xl leading-none">
            {t('greeting')}{user?.name ? `, ${user.name}` : ''} 👋
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate2">
            <div>
              <Link to="/app/profile" className="underline">{user?.name ?? '—'}</Link>
              {user?.location ? ` · ${user.location}` : ''}
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-red-600 hover:text-red-700 transition-colors"
              title="Sign Out"
            >
              <LogOut size={14} />
              <span className="text-xs font-medium">Sign out</span>
            </button>
          </div>
        </div>
        {top.length > 0 && <SpeakButton text={spoken} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {TILES.map(({ to, key, icon: Icon, tone }) => (
          <Link key={key} to={to} className={`tile min-h-[112px] ${tone}`}>
            <Icon size={30} strokeWidth={2.2} />
            <span className="mt-2 text-[17px] font-bold leading-tight">{t(key)}</span>
          </Link>
        ))}
      </div>

      {top.length > 0 && <RateBoard rows={top} />}

      {/* Install success toast */}
      {installStatus === 'accepted' && (
        <div className="flex items-center gap-2 rounded-xl border-2 border-green-600 bg-green-50 p-3 text-sm font-semibold text-green-700">
          <CheckCircle size={18} />
          App installed! Open it from your home screen.
        </div>
      )}

      {/* Dismissed toast */}
      {installStatus === 'dismissed' && (
        <div className="flex items-center justify-between rounded-xl border-2 border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
          <span>You can install later from the browser menu.</span>
          <button onClick={() => setInstallStatus(null)}><X size={15} /></button>
        </div>
      )}

      {/* Manual guide — only shown when browser never fired the prompt */}
      {showGuide && (
        <div className="relative rounded-xl border-2 border-board bg-board/5 p-4">
          <button
            onClick={() => setShowGuide(false)}
            className="absolute right-3 top-3 text-slate2 hover:text-ink"
          >
            <X size={16} />
          </button>
          <div className="flex items-center gap-2 font-bold text-board">
            <Smartphone size={18} /> Install Scrapswift on your phone
          </div>
          <ol className="mt-3 space-y-2 text-sm text-ink">
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-board text-[11px] font-bold text-white">1</span>
              Tap the <strong>⋮ menu</strong> (three dots) in Chrome&apos;s top-right corner
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-board text-[11px] font-bold text-white">2</span>
              Tap <strong>&quot;Add to Home screen&quot;</strong> or <strong>&quot;Install app&quot;</strong>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-board text-[11px] font-bold text-white">3</span>
              Tap <strong>Add</strong> — the Scrapswift icon appears on your home screen
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-slate2">
            If the app is already installed, open it from your home screen instead.
          </p>
        </div>
      )}

      {/* Install button — hidden once accepted */}
      {installStatus !== 'accepted' && (
        <button
          type="button"
          className={`btn-ghost w-full ${canInstall ? 'border-board text-board font-bold' : ''}`}
          onClick={handleInstall}
        >
          <Download size={18} />
          {canInstall ? '📲 Tap to install app' : t('installApp')}
        </button>
      )}

      <p className="pb-2 text-center text-[11px] text-slate2">
        {t('demoDataNote')}
      </p>
    </div>
  )
}
