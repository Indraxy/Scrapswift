import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCheck,
  Clock,
  Coins,
  MapPin,
  MessageSquare,
  Package,
  Send,
  Sparkles,
  Truck,
  X,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { chat as chatApi } from '../services/api'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { rupee } from './ui'

export default function ChatModal({ lot, onClose, onUpdated }) {
  const { t, tMaterial } = useI18n()
  const user = useCurrentUser()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef(null)

  const isCollector = user?.role === 'collector'
  const counterpartName = isCollector
    ? lot.recycler_name || t('recycler')
    : lot.collector_name || t('collector')

  const counterpartRoleLabel = isCollector ? t('authorised') : t('collector')

  const quickChips = [
    { label: t('quickPickupTime'), action: 'TIME', icon: <Clock size={13} /> },
    { label: t('quickConfirmRate'), action: 'RATE', icon: <Coins size={13} /> },
    { label: t('quickShareLocation'), action: 'LOCATION', icon: <MapPin size={13} /> },
    { label: t('quickReadyInspect'), action: 'READY', icon: <Package size={13} /> },
  ]

  const loadMessages = async () => {
    try {
      const msgs = await chatApi.messages(lot.lot_id)
      setMessages(msgs || [])
      await chatApi.markRead(lot.lot_id).catch(() => {})
      if (onUpdated) onUpdated()
    } catch {
      // silently handle network stutter during polling
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMessages()
    const timer = setInterval(loadMessages, 3000)
    return () => clearInterval(timer)
  }, [lot.lot_id])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleSend = async (textToSend, action = '') => {
    const text = (textToSend || input).trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    try {
      await chatApi.send(lot.lot_id, { message: text, quick_action: action })
      await loadMessages()
    } catch (err) {
      alert(err.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const formatMsgTime = (dateStr) => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  const renderActionBadge = (action) => {
    if (!action) return null
    const badges = {
      PICKUP_SCHEDULED: { label: 'Pickup Scheduled', icon: <Truck size={12} />, bg: 'bg-mint text-board' },
      LOCATION_CONFIRMED: { label: 'Location Logged', icon: <MapPin size={12} />, bg: 'bg-mint text-board' },
      RATE_CONFIRMED: { label: 'Rate Locked', icon: <Coins size={12} />, bg: 'bg-brass/30 text-ink font-semibold' },
      INSPECTION_READY: { label: 'Ready for Scales', icon: <Package size={12} />, bg: 'bg-mint text-board' },
      GREETING: { label: 'Direct Connected', icon: <Sparkles size={12} />, bg: 'bg-brass/20 text-ink' },
    }
    const b = badges[action]
    if (!b) return null
    return (
      <span className={`inline-flex items-center gap-1 rounded-none px-2 py-0.5 text-[11px] border border-ink/20 font-bold ${b.bg}`}>
        {b.icon} {b.label}
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/75 p-3 backdrop-blur-sm animate-fadeIn">
      <div className="flex h-[92vh] max-h-[720px] w-full max-w-lg flex-col border-[3px] border-ink bg-sand shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-ink bg-board px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-10 w-10 items-center justify-center border-2 border-white bg-mint text-board font-display font-bold text-lg">
              {isCollector ? '♻️' : '📦'}
              <span className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-board bg-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-bold leading-tight truncate max-w-[210px]">
                  {counterpartName}
                </span>
                <span className="chip bg-white text-board font-semibold py-0 px-1.5 text-[10px]">
                  {counterpartRoleLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-brass/90">
                <span className="num font-bold">#{lot.lot_id}</span>
                <span>·</span>
                <span>{tMaterial(lot.material_category)}</span>
                <span>·</span>
                <span className="num">{lot.weight} kg</span>
                {lot.quoted_price > 0 && (
                  <>
                    <span>·</span>
                    <span className="num font-bold">{rupee(lot.quoted_price)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center border-2 border-white bg-transparent text-white hover:bg-white hover:text-board transition-colors"
            aria-label="Close Chat"
          >
            <X size={18} />
          </button>
        </div>

        {/* Messages Scroll Area */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto p-4 bg-[#F5F2EB]/95"
        >
          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate2">
              <span className="animate-pulse font-semibold">Connecting secure chat…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-slate2">
              <MessageSquare size={32} className="mb-2 text-slate2/60" />
              <p className="text-sm font-semibold">No messages yet</p>
              <p className="text-xs">Ask about pickup schedule, location, or rates below.</p>
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.sender_role === user?.role
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5 px-1 text-[11px] text-slate2">
                    <span className="font-bold text-ink">{m.sender_name}</span>
                    <span>·</span>
                    <span className="num">{formatMsgTime(m.created_at)}</span>
                  </div>

                  <div
                    className={`max-w-[85%] border-2 border-ink p-3 shadow-sm ${
                      isMe
                        ? 'bg-board text-white shadow-[-2px_2px_0px_0px_#12211C]'
                        : 'bg-white text-ink shadow-[2px_2px_0px_0px_#12211C]'
                    }`}
                  >
                    {m.quick_action && (
                      <div className="mb-1.5">{renderActionBadge(m.quick_action)}</div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap font-sans">
                      {m.message}
                    </p>
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-75">
                      {isMe && (m.read ? <CheckCheck size={12} /> : <Check size={12} />)}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Quick Action Chips Bar */}
        <div className="border-t-2 border-ink bg-mint px-3 py-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {quickChips.map((q) => (
              <button
                key={q.action}
                type="button"
                disabled={sending}
                onClick={() => handleSend(q.label, q.action)}
                className="flex shrink-0 items-center gap-1 border border-ink bg-white px-2.5 py-1 text-xs font-semibold text-ink shadow-[1px_1px_0px_0px_#12211C] hover:bg-board hover:text-white transition-colors"
              >
                {q.icon}
                <span>{q.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Input Footer */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend(input)
          }}
          className="flex items-center gap-2 border-t-2 border-ink bg-white p-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('typeMessage')}
            disabled={sending}
            className="flex-1 border-2 border-ink bg-sand px-3 py-2 text-sm text-ink placeholder-slate2 outline-none focus:bg-white"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="btn-primary flex items-center gap-1 px-4 py-2 text-sm disabled:opacity-50"
          >
            <Send size={15} />
            <span className="hidden sm:inline">{t('send')}</span>
          </button>
        </form>
      </div>
    </div>
  )
}
