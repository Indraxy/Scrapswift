import { ArrowRight, MoveRight, TrendingDown, TrendingUp, Volume2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { speak } from '../services/voice'

export const rupee = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export function SpeakButton({ text, className = '', label }) {
  const { speech, t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => speak(text, speech)}
      aria-label={label || t('listen')}
      className={`btn border-2 border-ink bg-brass text-ink px-2.5 py-2 shadow-plateSm ${className}`}
    >
      <Volume2 size={18} strokeWidth={2.5} />
    </button>
  )
}

export function Trend({ trend, size = 16 }) {
  const { t } = useI18n()
  if (trend === 'rising')
    return (
      <span className="inline-flex items-center gap-1 font-bold text-board">
        <TrendingUp size={size} strokeWidth={2.75} /> {t('rising')}
      </span>
    )
  if (trend === 'falling')
    return (
      <span className="inline-flex items-center gap-1 font-bold text-copper">
        <TrendingDown size={size} strokeWidth={2.75} /> {t('falling')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 font-bold text-slate2">
      <MoveRight size={size} strokeWidth={2.75} /> {t('stable')}
    </span>
  )
}

const STATUS_TONE = {
  COMPLETED: 'bg-board text-white',
  PAID: 'bg-board text-white',
  PAYMENT_PENDING: 'bg-brass text-ink',
  PENDING: 'bg-brass text-ink',
  HANDOVER_PENDING: 'bg-white text-ink',
  HANDED_OVER: 'bg-boardLight text-white',
  RECYCLER_VERIFIED: 'bg-boardLight text-white',
  RECYCLER_MATCHED: 'bg-white text-ink',
  PRICE_ESTIMATED: 'bg-white text-ink',
  LOT_CREATED: 'bg-white text-ink',
  ANOMALY_FLAGGED: 'bg-copper text-white',
}

export function StatusChip({ status }) {
  const { tStatus } = useI18n()
  return <span className={`chip ${STATUS_TONE[status] || 'bg-white text-ink'}`}>{tStatus(status)}</span>
}

/**
 * The signature element: a painted rate board. Dark enamel plate, brass
 * tabular numerals, one line per material — the board that already hangs in
 * every scrap shop, made live.
 */
export function RateBoard({ rows, onSelect, compact = false }) {
  const { tMaterial, t } = useI18n()
  return (
    <div className="border-[3px] border-ink bg-boardDark shadow-plate">
      <div className="flex items-baseline justify-between border-b-2 border-brass/40 px-4 py-2.5">
        <span className="font-display text-brass tracking-[0.18em] text-sm uppercase">
          {t('todaysBoard')}
        </span>
        <span className="num text-[11px] text-white/50">₹ / {t('perKg')}</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li key={row.category}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(row.category)}
              className="flex w-full items-center gap-3 border-b border-white/10 px-4 py-3 text-left last:border-b-0 disabled:cursor-default hover:bg-white/5"
            >
              <span className="text-xl leading-none">{row.icon}</span>
              <span className="flex-1 text-white/90 font-semibold leading-tight">
                {tMaterial(row.category)}
              </span>
              <span className="num text-brass text-lg font-bold whitespace-nowrap">
                {row.min_price}–{row.max_price}
              </span>
              {!compact && (
                <span className="w-6 text-right">
                  {row.trend === 'rising' && <TrendingUp size={16} className="inline text-emerald-300" strokeWidth={2.75} />}
                  {row.trend === 'falling' && <TrendingDown size={16} className="inline text-orange-300" strokeWidth={2.75} />}
                  {row.trend === 'stable' && <MoveRight size={16} className="inline text-white/40" strokeWidth={2.75} />}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Stat({ label, value, sub, tone = 'plain' }) {
  const tones = {
    plain: 'bg-white',
    board: 'bg-board text-white',
    brass: 'bg-brass text-ink',
  }
  return (
    <div className={`plate p-3.5 ${tones[tone]}`}>
      <div className={`eyebrow ${tone === 'board' ? 'text-white/60' : ''}`}>{label}</div>
      <div className="num mt-1 text-2xl font-bold leading-none">{value}</div>
      {sub && <div className={`mt-1 text-xs ${tone === 'board' ? 'text-white/70' : 'text-slate2'}`}>{sub}</div>}
    </div>
  )
}

export function Timeline({ events }) {
  const { tStatus } = useI18n()
  return (
    <ol className="relative ml-2 border-l-2 border-ink/25 pl-5">
      {events.map((e, i) => (
        <li key={`${e.status}-${i}`} className="relative pb-4 last:pb-0">
          <span
            className={`absolute -left-[27px] top-1 h-3.5 w-3.5 border-2 border-ink ${
              e.status === 'ANOMALY_FLAGGED' ? 'bg-copper' : i === events.length - 1 ? 'bg-brass' : 'bg-board'
            }`}
          />
          <div className="font-semibold leading-tight">{tStatus(e.status)}</div>
          {e.note && <div className="text-sm text-slate2">{e.note}</div>}
          <div className="num text-[11px] text-slate2/80">
            {formatDate(e.at)} {e.actor && e.actor !== 'system' ? `· ${e.actor}` : ''}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-3 p-6 text-slate2">
      <span className="h-4 w-4 animate-spin border-2 border-ink border-t-transparent rounded-full" />
      {label}…
    </div>
  )
}

export function Empty({ title, body, action }) {
  return (
    <div className="plate p-6 text-center">
      <p className="font-display text-xl">{title}</p>
      {body && <p className="mt-1 text-sm text-slate2">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Notice({ children, tone = 'info' }) {
  const tones = {
    info: 'bg-white border-ink',
    warn: 'bg-brass/20 border-copper',
    good: 'bg-board text-white border-ink',
  }
  return <div className={`border-2 p-3 text-sm ${tones[tone]}`}>{children}</div>
}

export function NextButton({ children, ...props }) {
  return (
    <button className="btn-primary w-full text-lg" {...props}>
      {children} <ArrowRight size={20} strokeWidth={2.5} />
    </button>
  )
}

export function DemoTag({ className = '' }) {
  const { t } = useI18n()
  return (
    <span className={`chip border-ink/40 bg-white/70 text-[10px] text-slate2 ${className}`}>
      {t('demoData')}
    </span>
  )
}
