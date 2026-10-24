import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { subscribeOffline } from '../lib/api'
import { codeFor, kitPair } from '../lib/kits'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="8" fill="#FF5A36" stroke="#14161F" strokeWidth="2" />
      <path d="M8 9 H20 M14 9 V21" stroke="#14161F" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function SiteHeader({ tone = 'cream' }: { tone?: 'cream' | 'paper' }) {
  return (
    <header className={`border-b-2 border-ink ${tone === 'paper' ? 'bg-paper' : 'bg-cream'}`}>
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-md" aria-label="TACTIX home">
          <Mark />
          <span className="score text-[1.35rem] tracking-tight">TACTIX</span>
        </Link>
        <nav className="flex items-center gap-1 min-[380px]:gap-2 sm:gap-4" aria-label="Main">
          <NavLink
            to="/moments/new"
            className={({ isActive }) =>
              `hidden whitespace-nowrap rounded-md px-2 py-2 font-semibold underline-offset-4 hover:underline md:inline-block ${isActive ? 'underline' : ''}`
            }
          >
            Any match
          </NavLink>
          <NavLink
            to="/analyst"
            className={({ isActive }) =>
              `whitespace-nowrap rounded-md px-1.5 py-2 text-[0.95rem] font-semibold underline-offset-4 hover:underline sm:px-2 sm:text-base ${isActive ? 'underline' : ''}`
            }
            aria-label="Analyst Mode"
          >
            <span className="hidden min-[380px]:inline">Analyst Mode</span>
            <span className="min-[380px]:hidden">Analyst</span>
          </NavLink>
          <Link to="/#make-the-call" className="btn btn-primary lift min-h-11 px-3 text-base min-[380px]:px-4">
            Play
          </Link>
        </nav>
      </div>
      <OfflineNotice />
    </header>
  )
}

function OfflineNotice() {
  const [offline, setOffline] = useState(false)
  useEffect(() => subscribeOffline(setOffline), [])
  if (!offline) return null
  return (
    <div role="status" className="border-t-2 border-ink bg-yellow">
      <p className="mx-auto flex max-w-[1320px] items-center gap-2 px-4 py-2 text-sm font-semibold sm:px-6">
        <WifiOff size={16} strokeWidth={2.5} aria-hidden="true" />
        The TACTIX server isn't answering, so you're playing on a saved copy of the match data. Verdicts come from
        the in-browser model and the pundit is quieter.
      </p>
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-ink bg-ink text-cream">
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="score text-4xl">TACTIX</p>
          <p className="mt-3 max-w-[46ch] text-cream/80">
            Manage the moments that changed football history. Every scenario starts from real event data, and every
            verdict shows its working.
          </p>
        </div>
        <div className="text-sm text-cream/80 md:text-right">
          <p>
            Match data from{' '}
            <a className="font-semibold text-cream underline" href="https://github.com/statsbomb/open-data" target="_blank" rel="noreferrer">
              StatsBomb Open Data
            </a>
            .
          </p>
          <p className="mt-2">Ratings and projections are model estimates, not predictions.</p>
        </div>
      </div>
    </footer>
  )
}

export function Scoreline({
  home,
  away,
  score,
  minute,
  size = 'lg',
}: {
  home: string
  away: string
  score: { home: number; away: number }
  minute?: number
  size?: 'xl' | 'lg' | 'md' | 'sm'
}) {
  const cls = {
    xl: 'text-[clamp(3.6rem,13vw,9.5rem)]',
    lg: 'text-[clamp(2.6rem,7vw,5rem)]',
    md: 'text-3xl sm:text-4xl',
    sm: 'text-xl',
  }[size]
  return (
    <p className={`score flex flex-wrap items-baseline gap-x-[0.3em] ${cls}`} aria-label={`${home} ${score.home}, ${away} ${score.away}${minute ? `, ${minute} minutes played` : ''}`}>
      <span aria-hidden="true">{home}</span>
      <span aria-hidden="true" className="whitespace-nowrap">
        {score.home}–{score.away}
      </span>
      <span aria-hidden="true">{away}</span>
      {minute !== undefined && (
        <span aria-hidden="true" className="relative -top-[0.08em] ml-[0.1em] self-center rounded-[0.18em] bg-vermilion px-[0.22em] py-[0.08em] text-[0.42em] text-ink">
          {minute}'
        </span>
      )}
    </p>
  )
}

/** Broadcast-style score bug. The clock stays frozen until `running` is set. */
export function ScoreBug({
  home = 'ARG',
  away = 'FRA',
  score = { home: 2, away: 0 },
  minute = 70,
  second = 0,
  running = false,
  status,
  size = 'lg',
}: {
  home?: string
  away?: string
  score?: { home: number; away: number }
  minute?: number
  second?: number
  running?: boolean
  status?: string
  size?: 'lg' | 'md'
}) {
  const reduce = usePrefersReducedMotion()
  const [homeKit, awayKit] = kitPair(home, away)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (reduce || !running) return
    const id = window.setInterval(() => setSeconds((s) => (s + 1) % (20 * 60)), 1000)
    return () => window.clearInterval(id)
  }, [reduce, running])
  const elapsed = second + seconds
  const clock = `${minute + Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div
      className={`inline-flex items-stretch overflow-hidden rounded-[10px] border-2 border-ink bg-ink ${
        size === 'lg' ? 'text-[1.35rem] shadow-[0_6px_18px_-8px_rgba(20,22,31,0.55)] sm:text-[1.6rem]' : 'text-[0.98rem] sm:text-[1.3rem]'
      }`}
      role="img"
      aria-label={`${home} ${score.home}, ${away} ${score.away}, ${minute} minutes played${status ? `, ${status.toLowerCase()}` : ''}`}
    >
      <span className="score grid place-items-center px-2 py-1.5 sm:px-3" style={{ background: homeKit.fill, color: homeKit.ink }}>
        {home}
      </span>
      <span className="score grid place-items-center whitespace-nowrap bg-cream px-2.5 text-ink sm:px-3.5">
        {score.home}–{score.away}
      </span>
      <span className="score grid place-items-center px-2 sm:px-3" style={{ background: awayKit.fill, color: awayKit.ink }}>
        {away}
      </span>
      <span className="score-narrow grid min-w-[4.6ch] place-items-center px-2 text-yellow tabular-nums sm:px-3">{clock}</span>
      {status && (
        <span className="grid place-items-center border-l-2 border-cream/25 px-2 text-[0.62em] font-[800] tracking-wide text-cream sm:px-2.5">
          {status}
        </span>
      )}
    </div>
  )
}

export function teamCode(name: string) {
  return codeFor(name)
}

export function competitionName(raw: string) {
  return raw.replace(/^[^-]+ - /, '').replace(/^(FIFA|UEFA) /, '')
}
