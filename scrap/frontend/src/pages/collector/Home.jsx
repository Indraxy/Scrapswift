import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Calculator, Coins, Download, Package, Receipt, Recycle, Wallet } from 'lucide-react'
import { useI18n } from '../../i18n'
import { catalog } from '../../services/api'
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
  const [board, setBoard] = useState([])
  const [installer, setInstaller] = useState(null)

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
    const onPrompt = (e) => { e.preventDefault(); setInstaller(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => { alive = false; window.removeEventListener('beforeinstallprompt', onPrompt) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const top = board.slice(0, 4)
  const spoken = top
    .map((r) => priceSentence({ category: r.category, min: r.min_price, max: r.max_price, trend: r.trend }, lang))
    .join(' ')

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-display text-3xl leading-none">
            {t('greeting')}{user?.name ? `, ${user.name}` : ''} 👋
          </div>
          <div className="mt-1 text-sm text-slate2">
            <Link to="/app/profile" className="underline">{user?.name ?? '—'}</Link>
            {user?.location ? ` · ${user.location}` : ''}
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

      {installer && (
        <button
          type="button"
          className="btn-ghost w-full"
          onClick={() => { installer.prompt(); setInstaller(null) }}
        >
          <Download size={18} /> {t('installApp')}
        </button>
      )}

      <p className="pb-2 text-center text-[11px] text-slate2">
        {t('demoDataNote')}
      </p>
    </div>
  )
}
