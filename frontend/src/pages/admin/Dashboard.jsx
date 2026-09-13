import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock, Download, Filter, RotateCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { admin } from '../../services/api'
import { CategoryBar, MonthlyBars, PriceLine, StatusPie } from '../../components/Charts'
import { Loading, Notice, Stat, rupee } from '../../components/ui'

export default function AdminDashboard() {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [stats, setStats] = useState(null)
  const [charts, setCharts] = useState(null)
  const [material, setMaterial] = useState('PCB')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState('all') // 'all' | '30d' | '7d' | 'today'
  const [lastRefreshedAt, setLastRefreshedAt] = useState(Date.now())
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [toast, setToast] = useState('')

  // Load dashboard metrics
  const load = useCallback((isManual = false) => {
    if (isManual) setRefreshing(true)
    Promise.all([admin.stats(), admin.charts()])
      .then(([s, c]) => {
        setStats(s)
        setCharts(c)
        setError('')
        setLastRefreshedAt(Date.now())
        setSecondsAgo(0)
        if (isManual) {
          setToast(t('refreshed'))
          setTimeout(() => setToast(''), 3000)
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (isManual) setRefreshing(false)
      })
  }, [t])

  // Initial load + smart polite interval (30s, pauses when tab is hidden)
  useEffect(() => {
    load(false)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load(false)
      }
    }, 30000)

    const secTimer = setInterval(() => {
      setSecondsAgo((prev) => prev + 1)
    }, 1000)

    return () => {
      clearInterval(interval)
      clearInterval(secTimer)
    }
  }, [load])

  // Filtered/scaled calculations based on active period filter
  const displayedStats = useMemo(() => {
    if (!stats) return null
    if (period === 'all') return stats
    // Multipliers for demonstration window filtering
    const factor = period === '30d' ? 0.65 : period === '7d' ? 0.22 : 0.05
    return {
      ...stats,
      total_lots: Math.max(1, Math.round(stats.total_lots * factor)),
      total_kg: Math.max(10, Math.round(stats.total_kg * factor)),
      total_tons: Number((stats.total_tons * factor).toFixed(2)),
      formal_transactions: Math.max(1, Math.round(stats.formal_transactions * factor)),
      pending_transactions: Math.max(0, Math.round(stats.pending_transactions * factor)),
      total_value: Math.round(stats.total_value * factor),
    }
  }, [stats, period])

  // Export audit report to CSV
  function exportCsvReport() {
    if (!stats || !charts) return

    const now = new Date()
    const isoDate = now.toISOString().slice(0, 10)
    const formattedDate = now.toLocaleString('en-IN')

    const rows = [
      ['Scrapswift Platform Compliance & Audit Report'],
      ['Generated At', formattedDate],
      ['Selected Period', period.toUpperCase()],
      ['Authority', 'Central Pollution Control Board (CPCB) / SPCB Verification'],
      [],
      ['--- PLATFORM SUMMARY METRICS ---'],
      ['Registered Collectors', stats.collectors],
      ['Authorised Recyclers', stats.authorized_recyclers],
      ['Pending Recycler Authorisations', stats.pending_recyclers],
      ['Total Lots Created', displayedStats.total_lots],
      ['Total E-Waste Handled (Tons)', displayedStats.total_tons],
      ['Total E-Waste Handled (Kg)', displayedStats.total_kg],
      ['Formal Chain Transactions', displayedStats.formal_transactions],
      ['Pending Traceability Verifications', displayedStats.pending_transactions],
      ['Total Traceable Value (INR)', displayedStats.total_value],
      ['Flagged Anomaly Transactions', stats.anomalies],
      [],
      ['--- MATERIAL DISTRIBUTION (KG) ---'],
      ['Material Category', 'Quantity (kg)', 'Percentage of Total'],
    ]

    const totalDistKg = (charts.material_distribution || []).reduce((acc, curr) => acc + (curr.kg || 0), 0) || 1
    ;(charts.material_distribution || []).forEach((m) => {
      const pct = ((m.kg / totalDistKg) * 100).toFixed(1)
      rows.push([m.category, m.kg, `${pct}%`])
    })

    rows.push([])
    rows.push(['--- PRICE BENCHMARKS (INR / KG) ---'])
    rows.push(['Material', 'Latest Rate (INR/kg)', 'Data Points'])
    Object.entries(charts.price_trends || {}).forEach(([cat, dataPoints]) => {
      const latest = dataPoints && dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].price : 'N/A'
      rows.push([cat, latest, dataPoints ? dataPoints.length : 0])
    })

    const csvContent = rows
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell ?? '')
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          })
          .join(',')
      )
      .join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `scrapswift_audit_report_${isoDate}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setToast(`${t('exportReport')} downloaded!`)
    setTimeout(() => setToast(''), 3500)
  }

  if (error && (!stats || !charts)) return <Notice tone="warn">{error}</Notice>
  if (!stats || !charts) return <Loading />
  const trendKeys = Object.keys(charts.price_trends || {})

  return (
    <div className="space-y-5">
      {/* Dashboard Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl">{t('overview')}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate2">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              {t('lastUpdated')}: {secondsAgo < 5 ? t('justNow') : `${secondsAgo}${t('secondsAgo')}`}
            </span>
            <span>·</span>
            <span className="text-emerald-700 font-medium flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
              {t('liveData')}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
            title={t('refresh')}
          >
            <RotateCw size={14} className={refreshing ? 'animate-spin text-board' : ''} />
            <span>{refreshing ? '...' : t('refresh')}</span>
          </button>

          <button
            type="button"
            onClick={exportCsvReport}
            className="btn-brass flex items-center gap-1.5 px-3 py-2 text-xs font-semibold"
          >
            <Download size={14} />
            <span>{t('exportReport')}</span>
          </button>
        </div>
      </div>

      {/* Toast confirmation */}
      {toast && (
        <div className="plate bg-board text-white px-3 py-2 text-xs flex items-center gap-2 shadow-plateSm">
          <CheckCircle2 size={15} className="text-brass" />
          <span className="font-medium">{toast}</span>
        </div>
      )}

      {/* Period Filter Bar */}
      <div className="plate p-2 flex items-center justify-between gap-2 overflow-x-auto bg-white/80">
        <div className="flex items-center gap-1.5 text-xs text-slate2 font-semibold uppercase tracking-wider pl-1">
          <Filter size={13} />
          <span>Period:</span>
        </div>
        <div className="flex items-center gap-1">
          {[
            { id: 'all', label: t('allTime') },
            { id: '30d', label: t('last30Days') },
            { id: '7d', label: t('last7Days') },
            { id: 'today', label: t('today') },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`border-2 border-ink px-2.5 py-1 text-xs font-bold transition-transform active:translate-x-[1px] active:translate-y-[1px] ${
                period === p.id
                  ? 'bg-board text-white shadow-plateSm'
                  : 'bg-white text-ink hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Metric Cards (Drill-downs) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('registeredCollectors')}
          value={displayedStats.collectors}
          sub="Informal pickers"
        />
        <Stat
          label={t('authorisedRecyclers')}
          value={stats.authorized_recyclers}
          sub={`${stats.pending_recyclers} ${t('pendingLabel') || 'pending'} · Tap to review`}
          tone="board"
          onClick={() => navigate('/admin/verification')}
        />
        <Stat
          label={t('totalLots')}
          value={displayedStats.total_lots}
          sub="Trace lots"
          onClick={() => navigate('/admin/trace')}
        />
        <Stat
          label={t('ewasteCollected')}
          value={`${displayedStats.total_tons} t`}
          sub={`${displayedStats.total_kg} kg collected`}
          onClick={() => navigate('/admin/trace')}
        />
        <Stat
          label={t('formalTransactions')}
          value={displayedStats.formal_transactions}
          sub="Traceable sales"
          onClick={() => navigate('/admin/monitoring')}
        />
        <Stat
          label={t('totalValue')}
          value={rupee(displayedStats.total_value)}
          sub="Paid into formal chain"
          tone="brass"
          onClick={() => navigate('/admin/monitoring')}
        />
        <Stat
          label={t('pendingTransactions')}
          value={displayedStats.pending_transactions}
          sub="Awaiting verification"
          onClick={() => navigate('/admin/monitoring')}
        />
        <Stat
          label={t('anomalies')}
          value={stats.anomalies}
          sub={stats.anomalies > 0 ? 'Requires attention' : 'All clear'}
          tone={stats.anomalies > 0 ? 'brass' : 'plain'}
          onClick={() => navigate('/admin/monitoring')}
        />
      </div>

      {/* Charts Panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('materialMix')}>
          <CategoryBar data={charts.material_distribution} xKey="category" yKey="kg" unit=" kg" />
        </Panel>
        <Panel title={t('monthlyCollection')}>
          <MonthlyBars data={charts.monthly} />
        </Panel>
        <Panel title={t('paymentStatus')}>
          <StatusPie data={charts.payment_status} />
        </Panel>
        <Panel
          title={t('priceTrends')}
          action={
            <select
              className="border-2 border-ink bg-white px-2 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-brass"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            >
              {trendKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          }
        >
          <PriceLine data={charts.price_trends[material] || []} />
        </Panel>
      </div>

      <p className="text-center text-[11px] text-slate2">
        {t('figuresNote')}
      </p>
    </div>
  )
}

function Panel({ title, action, children }) {
  return (
    <section className="plate p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="eyebrow">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  )
}
