import { useNavigate } from 'react-router-dom'
import { ArrowRight, BadgeCheck, IndianRupee, ShieldCheck } from 'lucide-react'
import { useI18n } from '../i18n'
import { LanguageSwitcher } from '../components/Shell'

/**
 * Landing page — the first thing anyone sees, before the login form.
 *
 * Deliberately does three things and stops: says what the app is for in one
 * line, lets the visitor pick their language before reading anything else,
 * and gets them to the login. No marketing filler, because the audience is a
 * collector standing in a scrapyard, not a desktop browser.
 */
export default function Welcome() {
  const { t } = useI18n()
  const navigate = useNavigate()

  const points = [
    { icon: IndianRupee, key: 'welcomePointPrice' },
    { icon: BadgeCheck, key: 'welcomePointAuthorised' },
    { icon: ShieldCheck, key: 'welcomePointRecord' },
  ]

  return (
    <div className="min-h-dvh bg-mint paper-grid">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6">
        {/* Language first: the visitor chooses before they have to read. */}
        <div className="flex items-center justify-between">
          <span className="font-display text-xl tracking-wide">{t('appName')}</span>
          <LanguageSwitcher />
        </div>

        <div className="mt-8 border-[3px] border-ink bg-boardDark p-6 shadow-plate">
          <p className="font-display text-4xl leading-[1.1] text-white">
            {t('welcomeHeadline1')}
            <br />
            <span className="bg-brass px-2 text-ink">{t('welcomeHeadline2')}</span>
          </p>
          <p className="mt-4 text-sm leading-snug text-white/75">{t('welcomeSub')}</p>
        </div>

        <ul className="mt-5 space-y-2">
          {points.map(({ icon: Icon, key }) => (
            <li key={key} className="plate flex items-center gap-3 p-3">
              <span className="border-2 border-ink bg-brass p-1.5">
                <Icon size={18} strokeWidth={2.5} />
              </span>
              <span className="text-sm font-semibold leading-snug">{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-6">
          <button className="btn-primary w-full py-4 text-lg" onClick={() => navigate('/login')}>
            {t('welcomeCta')} <ArrowRight size={20} strokeWidth={2.5} />
          </button>
          <p className="mt-3 text-center text-[11px] text-slate2">{t('welcomeNote')}</p>
        </div>
      </div>
    </div>
  )
}
