import { useEffect, useState } from 'react'
import { MessageSquare, Package, ChevronRight, User, Recycle } from 'lucide-react'
import { useI18n } from '../i18n'
import { chat as chatApi } from '../services/api'
import { Empty, Loading, Notice, formatDate } from '../components/ui'
import ChatDrawer from '../components/ChatDrawer'

export default function Messages() {
  const { t, tMaterial } = useI18n()
  const [threads, setThreads] = useState(null)
  const [error, setError] = useState('')
  const [activeThread, setActiveThread] = useState(null)

  const loadThreads = () => {
    chatApi
      .threads()
      .then((data) => {
        setThreads(data)
        setError('')
      })
      .catch((err) => {
        setError(err.message || 'Failed to load conversations')
        setThreads([])
      })
  }

  useEffect(() => {
    loadThreads()
    const timer = setInterval(loadThreads, 5000)
    return () => clearInterval(timer)
  }, [])

  if (error && !threads) return <Notice tone="warn">{error}</Notice>
  if (!threads) return <Loading />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl tracking-wide">{t('messages')}</h1>
      </div>

      {threads.length === 0 ? (
        <Empty
          title={t('messages')}
          body={t('noMessagesYet')}
        />
      ) : (
        <div className="space-y-2.5">
          {threads.map((thread) => {
            const isRecycler = thread.other_user_role === 'recycler'
            return (
              <button
                key={thread.thread_id}
                onClick={() =>
                  setActiveThread({
                    recipient: {
                      id: thread.other_user_id,
                      name: thread.other_user_name,
                      role: thread.other_user_role,
                      contact: thread.other_user_contact,
                    },
                    lot: thread.lot_id
                      ? {
                          lot_id: thread.lot_id,
                          material_category: thread.lot_category,
                          weight: thread.lot_weight,
                        }
                      : null,
                  })
                }
                className="plate flex w-full items-center gap-3 p-3.5 text-left transition hover:border-brass"
              >
                <span
                  className={`flex h-12 w-12 flex-shrink-0 items-center justify-center border-2 border-ink ${
                    isRecycler ? 'bg-boardDark text-brass' : 'bg-mint text-ink'
                  }`}
                >
                  {isRecycler ? <Recycle size={22} /> : <User size={22} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="truncate font-bold text-ink">{thread.other_user_name}</span>
                      <span className="border border-ink/30 bg-paper px-1 py-0.2 text-[10px] font-semibold uppercase text-slate2">
                        {t(thread.other_user_role || 'user')}
                      </span>
                    </div>
                    {thread.last_message_at && (
                      <span className="flex-shrink-0 text-[11px] text-slate2">
                        {formatDate(thread.last_message_at)}
                      </span>
                    )}
                  </div>

                  {thread.lot_id && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate2">
                      <Package size={12} />
                      <span className="font-semibold text-ink">{thread.lot_id}</span>
                      {thread.lot_category && (
                        <span>({tMaterial(thread.lot_category)})</span>
                      )}
                    </div>
                  )}

                  <p className="mt-1 truncate text-xs text-slate2">
                    {thread.last_message || t('noMessagesYet')}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  {thread.unread_count > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brass px-1.5 text-[10px] font-bold text-ink">
                      {thread.unread_count}
                    </span>
                  )}
                  <ChevronRight size={16} className="text-slate2" />
                </div>
              </button>
            )
          })}
        </div>
      )}

      {activeThread && (
        <ChatDrawer
          isOpen={Boolean(activeThread)}
          onClose={() => {
            setActiveThread(null)
            loadThreads()
          }}
          recipient={activeThread.recipient}
          lot={activeThread.lot}
        />
      )}
    </div>
  )
}
