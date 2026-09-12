import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Package, Send, Volume2, X, Sparkles } from 'lucide-react'
import { useI18n } from '../i18n'
import { chat as chatApi } from '../services/api'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { speak } from '../services/voice'
import { formatDate } from './ui'

export default function ChatDrawer({ isOpen, onClose, lot, recipient }) {
  const { t, tMaterial, speech } = useI18n()
  const currentUser = useCurrentUser()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  const recipientId = recipient?.id || recipient?.user_id
  const lotId = lot?.lot_id || null

  useEffect(() => {
    if (!isOpen || !recipientId) return

    let alive = true
    const load = async () => {
      try {
        const list = await chatApi.messages(recipientId, lotId)
        if (alive) {
          setMessages(list)
          setError('')
        }
      } catch (err) {
        if (alive) setError(err.message || 'Failed to load messages')
      }
    }

    load()
    const timer = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [isOpen, recipientId, lotId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  if (!isOpen || !recipient) return null

  const handleSend = async (contentToSend = null, messageType = 'text') => {
    const msg = (contentToSend || text).trim()
    if (!msg || sending) return

    setSending(true)
    setError('')
    try {
      const sentMsg = await chatApi.send({
        lotId,
        receiverId: recipientId,
        content: msg,
        messageType,
      })
      setText('')
      if (sentMsg) {
        setMessages((prev) => [...prev, sentMsg])
      }
    } catch (err) {
      setError(err.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const quickTemplates = [
    { label: t('quickPickup'), type: 'pickup_query' },
    { label: t('quickBestRate'), type: 'price_query' },
    { label: t('quickDropoff'), type: 'dropoff_query' },
    { label: t('quickPhoto'), type: 'photo_query' },
    { label: t('quickAccepted'), type: 'accept_query' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="flex h-full w-full max-w-md flex-col border-l-[3px] border-ink bg-mint shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b-[3px] border-ink bg-boardDark px-4 py-3 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border-2 border-brass bg-boardDark text-brass">
              <MessageSquare size={20} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-display text-lg tracking-wide text-white">
                  {recipient.name || recipient.display_name}
                </span>
                <span className="border border-brass/40 bg-brass/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brass">
                  {t(recipient.role || 'recycler')}
                </span>
              </div>
              <p className="truncate text-xs text-white/70">
                {recipient.location || recipient.operating_location || recipient.contact || t('chatNegotiation')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center border-2 border-white/20 bg-white/10 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Lot Context Chip */}
        {lot && (
          <div className="flex items-center justify-between border-b-2 border-ink bg-white/80 px-4 py-2 text-xs">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-slate2" />
              <span className="font-bold text-ink">{lot.lot_id}</span>
              <span className="text-slate2">·</span>
              <span className="font-medium text-slate2">{tMaterial(lot.material_category)}</span>
              <span className="num font-bold text-ink">({lot.weight} kg)</span>
            </div>
            <span className="num font-bold text-leaf">
              {lot.quoted_price ? `₹${lot.quoted_price}` : `₹${lot.estimated_min || 0}–₹${lot.estimated_max || 0}`}
            </span>
          </div>
        )}

        {/* Messages Stream */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate2">
              <MessageSquare size={36} className="mb-2 opacity-40" />
              <p className="max-w-[240px] text-xs font-medium">{t('noMessagesYet')}</p>
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.sender_id === currentUser?.id
              return (
                <div key={m.message_id || Math.random()} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-1.5">
                    {!isMe && (
                      <span className="text-[10px] font-bold text-slate2">
                        {m.sender_name}
                      </span>
                    )}
                  </div>
                  <div
                    className={`group relative max-w-[85%] border-2 border-ink p-3 shadow-sm ${
                      isMe ? 'bg-boardDark text-white' : 'bg-white text-ink'
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[10px] opacity-70">
                      <span>{formatDate(m.created_at)}</span>
                      <button
                        type="button"
                        onClick={() => speak(m.content, speech)}
                        className="opacity-60 transition hover:opacity-100"
                        title={t('audioPlay')}
                      >
                        <Volume2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Quick Questions Toolbar */}
        <div className="border-t-2 border-ink/20 bg-white/50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-slate2">
            <Sparkles size={12} className="text-brass" />
            <span>{t('quickReplies')}</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
            {quickTemplates.map((tpl, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(tpl.label, tpl.type)}
                className="whitespace-nowrap border border-ink/40 bg-white px-2.5 py-1 text-[11px] font-medium text-ink shadow-sm transition hover:border-ink hover:bg-brass/20"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error message */}
        {error && <div className="bg-signal-warn/20 px-4 py-1 text-xs text-signal-warn">{error}</div>}

        {/* Input Bar */}
        <div className="border-t-[3px] border-ink bg-white p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('typeMessage')}
              className="flex-1 border-2 border-ink bg-paper px-3 py-2 text-sm text-ink placeholder-slate2 focus:outline-none focus:ring-2 focus:ring-brass"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="btn-primary flex items-center justify-center px-4 py-2 text-sm disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
