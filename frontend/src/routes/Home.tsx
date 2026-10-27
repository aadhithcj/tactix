import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { BoardPitch } from '../components/BoardPitch'
import { competitionName, ScoreBug, SiteFooter, SiteHeader, teamCode } from '../components/Chrome'
import { MiniPitch } from '../components/MiniPitch'
import { ShotMap } from '../components/ShotMap'
import { TACTICS, TacticGlyph } from '../components/TacticGlyph'
import { api } from '../lib/api'
import { getHero } from '../lib/hero'
import { kitVars } from '../lib/kits'
import { shortName } from '../lib/names'
import { buildScene, whereInWords } from '../lib/scene'
import type { ScenarioSummary, TacticKey } from '../lib/types'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

// The analyst teaser always shows the 2022 final, whose shots ship with the app.
const SHOTS_MATCH = 3869685
const SHOTS_HOME = 779

export default function Home() {
  const navigate = useNavigate()
  const reduce = usePrefersReducedMotion()
  // A different famous moment on each load, chosen before render (see main.tsx).
  const HERO = getHero()
  const snap = HERO.snapshot
  const homeSide = snap.sides[String(snap.match.home_team_id)]
  const awaySide = snap.sides[String(snap.match.away_team_id)]
  const [teamId, setTeamId] = useState(snap.hero?.default_team_id ?? homeSide.team_id)
  const [tactic, setTactic] = useState<TacticKey | null>(null)
  const [plan, setPlan] = useState('')
  const [locking, setLocking] = useState(false)
  const [flash, setFlash] = useState(0)
  const firstCard = useRef<HTMLButtonElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const sceneId = useId().replace(/:/g, '')

  const scene = useMemo(() => buildScene(HERO, teamId, tactic), [HERO, teamId, tactic])
  const { side, opp, hero } = scene
  const threatName = side.key_threat ? shortName(side.key_threat.name) : 'their danger man'
  const copy = snap.hero?.by_team[String(teamId)] ?? {
    headline: HERO.title,
    hook: side.dilemma,
    ask: 'What’s your plan?',
  }
  const caption = `${snap.hero?.caption ?? snap.match.venue}, ${new Date(snap.match.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const canLock = tactic !== null && (tactic !== 'custom' || plan.trim().length >= 6)
  const tacticTitle = (key: TacticKey) => (key === 'mark_threat' ? `Mark ${threatName}` : TACTICS.find((t) => t.key === key)!.title)

  const makeTheCall = () => {
    firstCard.current?.focus({ preventScroll: true })
    // Bring the whole dock up with room to spare (scroll-margin below), not just the first card.
    dock.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' })
    setFlash((f) => f + 1)
  }

  const lockIn = () => {
    if (!canLock || locking) return
    setLocking(true)
    // The clock only starts once the call is made; then the game takes over.
    window.setTimeout(
      () =>
        navigate(`/play/${HERO.slug}?team=${teamId}&tactic=${tactic}`, {
          state: { plan: tactic === 'custom' ? plan.trim() : undefined, fromPreview: true },
        }),
      reduce ? 0 : 650,
    )
  }

  const switchSide = (id: number) => {
    setTeamId(id)
    setTactic(null)
  }

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section aria-labelledby="hero-title" className="relative bg-cream" style={kitVars(side.name, opp.name)}>
          <div className="mx-auto grid max-w-[1320px] gap-x-10 gap-y-6 px-4 pt-6 sm:px-6 sm:pt-8 lg:grid-cols-12 lg:pt-9">
            {/* Story */}
            <div className="tx-slide lg:col-span-5 lg:row-start-1 lg:self-end">
              <h1 id="hero-title" className="max-w-[14ch] text-hero font-[850] tracking-[-0.035em]">
                {copy.headline}
              </h1>
              <p className="mt-4 max-w-[32ch] text-lede font-[600] text-ink">{copy.hook}</p>
            </div>

            {/* The moment */}
            <figure className="tx-rise min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1" style={{ animationDelay: '90ms' }}>
              <div className="panel overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-ink px-3 py-2.5 sm:px-4">
                  <ScoreBug
                    home={homeSide.code}
                    away={awaySide.code}
                    score={snap.score}
                    minute={snap.minute}
                    second={snap.second ?? 0}
                    running={locking}
                    status={locking ? 'LIVE' : 'PAUSED'}
                    size="md"
                  />
                  <figcaption className="text-sm font-semibold text-ink-soft">{caption}</figcaption>
                </div>
                <div className="relative bg-pitch">
                  <div className="mx-auto w-full max-w-[34rem] lg:w-[min(100%,calc((100dvh-26rem)*1.1))] lg:min-w-[22rem] lg:max-w-none">
                    <BoardPitch
                      tokens={scene.tokens}
                      beyond={scene.beyond}
                      hero={hero}
                      marker={scene.marker}
                      describedBy={sceneId}
                      title={`${side.name}'s half at ${snap.minute} minutes`}
                    />
                  </div>
                  {tactic && (
                    <p className="tx-fade-in absolute bottom-3 left-3 rounded-full border-2 border-ink bg-yellow px-3 py-1 text-sm font-[800]">
                      Preview: {tactic === 'custom' ? 'your own plan' : tacticTitle(tactic)}
                    </p>
                  )}
                </div>
                <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t-2 border-ink px-3 py-2.5 text-sm font-semibold sm:px-4" aria-label="Key">
                  <li className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" fill="var(--kit-you, var(--color-sky))" stroke="var(--color-ink)" strokeWidth="1.6" />
                    </svg>
                    {side.name} (you)
                  </li>
                  <li className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="var(--kit-them, var(--color-vermilion))" stroke="var(--color-ink)" strokeWidth="1.6" />
                    </svg>
                    {opp.name}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--color-ink)" strokeWidth="1.6" strokeDasharray="3 2" />
                    </svg>
                    Their key threat
                  </li>
                </ul>
              </div>
              <SceneDescription id={sceneId} scene={scene} minute={snap.minute} />
            </figure>

            {/* The call */}
            <div className="tx-rise lg:col-span-5 lg:row-start-2 lg:self-start" style={{ animationDelay: '60ms' }}>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={makeTheCall} className="btn btn-primary lift min-h-14 px-7 text-xl">
                  Make the call
                </button>
                <SideToggle teamId={teamId} onChange={switchSide} options={[snap.hero?.default_team_id === awaySide.team_id ? awaySide : homeSide, snap.hero?.default_team_id === awaySide.team_id ? homeSide : awaySide].map((t) => ({ id: t.team_id, label: t.name }))} />
              </div>
              <RatingStamp />
            </div>
          </div>

          {/* Tactic dock: sticks to the bottom on phones, sits under the hero on desktop */}
          <div
            id="make-the-call"
            ref={dock}
            className="tx-rise scroll-mb-16 sticky bottom-0 z-20 mt-6 border-t-2 border-ink bg-cream/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] lg:static lg:mt-7 lg:border-t-0 lg:bg-cream lg:pb-10"
            style={{ animationDelay: '180ms' }}
          >
            <div className="relative mx-auto max-w-[1320px] px-4 pt-3 sm:px-6 lg:pt-0">
              {flash > 0 && <span key={flash} className="tx-flash pointer-events-none absolute inset-x-2 -top-1 bottom-0 rounded-[16px] border-4 border-yellow sm:inset-x-4" aria-hidden="true" />}
              {/* DOM order is heading, cards, plan, lock: the order you tab through. */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
                <h2 id="dock-title" className="col-start-1 row-start-1 py-1.5 text-lg font-[850] sm:text-xl">
                  {copy.ask}
                </h2>
              <div
                role="group"
                aria-labelledby="dock-title"
                className="col-span-2 row-start-2 mt-1.5 grid auto-cols-[minmax(12.5rem,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-1 lg:grid-flow-row lg:grid-cols-4 lg:overflow-visible lg:pb-0"
              >
                {TACTICS.map((t, i) => {
                  const active = tactic === t.key
                  return (
                    <button
                      key={t.key}
                      ref={i === 0 ? firstCard : undefined}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTactic(active ? null : t.key)}
                      className={`tx-card lift flex min-h-16 items-center gap-3 rounded-[12px] border-2 border-ink p-2.5 text-left lg:p-3 ${active ? 'bg-yellow' : 'bg-paper hover:bg-cream-deep'}`}
                    >
                      <TacticGlyph tactic={t.key} threat={threatName} />
                      <span className="min-w-0">
                        <span className="block text-[1.05rem] font-[800] leading-tight lg:text-lg">{tacticTitle(t.key)}</span>
                        <span className="hidden text-[0.95rem] leading-snug text-ink-soft lg:block">{t.blurb}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              {tactic === 'custom' && (
                <div className="tx-fade-in col-span-2 row-start-3 mt-3 max-w-[720px]">
                  <label htmlFor="home-plan" className="font-[750]">
                    Your plan, in a sentence or two
                  </label>
                  <textarea
                    id="home-plan"
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    rows={2}
                    maxLength={600}
                    placeholder={`e.g. Drop into a back five, double up on ${threatName} and break on the counter.`}
                    className="mt-1 w-full resize-y rounded-[10px] border-2 border-ink bg-paper px-3 py-2.5 text-body"
                  />
                </div>
              )}
              {canLock && (
                <button type="button" onClick={lockIn} className="tx-pop btn btn-ink lift col-start-2 row-start-1 min-h-12" disabled={locking}>
                  {locking ? 'Kick-off…' : 'Lock it in'}
                </button>
              )}
              </div>
              <p className="sr-only" aria-live="polite">
                {tactic ? `Previewing ${tactic === 'custom' ? 'your own plan' : tacticTitle(tactic)}. Choose Lock it in to play it out.` : ''}
              </p>
            </div>
          </div>
        </section>

        <MoreMoments />
        <HowItPlays />
        <AnalystBand />
      </main>
      <SiteFooter />
    </>
  )
}

function SideToggle({
  teamId,
  onChange,
  options,
}: {
  teamId: number
  onChange: (id: number) => void
  options: { id: number; label: string }[]
}) {
  return (
    <div role="group" aria-labelledby="managing-label" className="flex items-center gap-2">
      <span id="managing-label" className="text-[0.95rem] font-semibold text-ink-soft">
        Managing
      </span>
      <div className="flex rounded-full border-2 border-ink bg-paper p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={teamId === o.id}
            onClick={() => onChange(o.id)}
            className={`min-h-10 rounded-full px-3.5 font-[750] transition-colors ${teamId === o.id ? 'bg-ink text-cream' : 'hover:bg-cream-deep'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function RatingStamp() {
  return (
    <p className="mt-6 inline-flex -rotate-3 items-center gap-3 rounded-[12px] border-2 border-dashed border-ink px-4 py-2" aria-label="Your Gaffer Rating: not played yet">
      <span className="text-sm font-[800] leading-tight">
        Your Gaffer
        <br />
        Rating
      </span>
      <span className="score text-3xl" aria-hidden="true">
        ?<span className="text-lg">/10</span>
      </span>
    </p>
  )
}

function SceneDescription({ id, scene, minute }: { id: string; scene: ReturnType<typeof buildScene>; minute: number }) {
  const { side, opp } = scene
  const key = side.key_threat
  // Words use the real coordinates, not the nudged drawing positions.
  return (
    <div id={id} className="sr-only">
      <p>
        {`Your half at ${minute} minutes, your goal at the bottom. You manage ${side.name} in a ${side.formation}.`}
        {key ? ` ${key.name}, ${opp.name}'s main threat, is ${whereInWords(key.x, key.y)}.` : ''}
      </p>
      <p>Your players:</p>
      <ul>
        {side.players.map((p) => (
          <li key={p.id}>{`${p.number ?? ''} ${p.name}, ${p.position}: ${whereInWords(p.x, p.y)}`}</li>
        ))}
      </ul>
      <p>{opp.name} players:</p>
      <ul>
        {opp.players.map((p) => (
          <li key={p.id}>{`${p.number ?? ''} ${p.name}, ${p.position}: ${whereInWords(120 - p.x, 80 - p.y)}`}</li>
        ))}
      </ul>
    </div>
  )
}

function MoreMoments() {
  const list = useQuery({ queryKey: ['scenarios'], queryFn: api.scenarios })
  const heroSlug = getHero().slug
  const others = list.data?.filter((s) => s.slug !== heroSlug)
  return (
    <section aria-labelledby="moments-title" className="border-t-2 border-ink bg-cream">
      <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr] md:items-end">
          <h2 id="moments-title" className="text-[clamp(2.2rem,5vw,3.75rem)] font-[850] leading-[1]">
            More moments to manage
          </h2>
          <p className="max-w-[52ch] text-body text-ink-soft md:justify-self-end">
            Each one is frozen at the minute it turned, with both sides' real positions. Pick a side and see if you'd have
            done better.
          </p>
        </div>
        {list.error && (
          <p role="alert" className="panel mt-10 p-5 font-semibold">
            Couldn't load the moments: {list.error.message}
          </p>
        )}
        {!others && !list.error && <div className="mt-10 h-72 rounded-[14px] border-2 border-ink bg-cream-deep" aria-busy="true" />}
        {others && (
          <ol className="mt-10 overflow-hidden rounded-[14px] border-2 border-ink bg-paper">
            {others.map((s, i) => (
              <MomentRow key={s.slug} s={s} first={i === 0} />
            ))}
          </ol>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[14px] border-2 border-dashed border-ink px-5 py-5 sm:px-7">
          <p className="max-w-[52ch] text-body">
            <span className="font-[850]">Got a match in mind?</span> Pick any game in StatsBomb's free data, freeze it at
            any minute and take charge.
          </p>
          <Link to="/moments/new" className="btn btn-ink lift min-h-12">
            Pick any match
          </Link>
        </div>
      </div>
    </section>
  )
}

function MomentRow({ s, first }: { s: ScenarioSummary; first: boolean }) {
  const detail = useQuery({ queryKey: ['scenario', s.slug], queryFn: () => api.scenario(s.slug) })
  const snap = detail.data?.snapshot
  const homeSide = snap?.sides[String(snap.match.home_team_id)]
  const awaySide = snap?.sides[String(snap.match.away_team_id)]
  return (
    <li
      style={kitVars(s.home, s.away)}
      className={`grid gap-5 p-4 sm:p-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)_auto] lg:items-center lg:gap-8 ${first ? '' : 'border-t-2 border-ink'}`}
    >
      <div className="overflow-hidden rounded-[10px] border-2 border-ink">
        {homeSide && awaySide ? (
          <MiniPitch home={homeSide.players} away={awaySide.players} label={`${s.home} as circles and ${s.away} as squares, in their kit colours, at minute ${s.minute}`} />
        ) : (
          <div className="aspect-[3/2] bg-pitch" aria-busy="true" />
        )}
      </div>
      <div>
        <ScoreBug home={teamCode(s.home)} away={teamCode(s.away)} score={s.score} minute={s.minute} size="md" />
        <h3 className="mt-3 text-xl font-[800]">{s.title}</h3>
        <p className="text-sm font-semibold text-ink-soft">
          {competitionName(s.competition)} final, {new Date(s.date).getFullYear()}
        </p>
        <p className="mt-2 max-w-[56ch] text-body text-ink-soft">{s.tagline}</p>
      </div>
      <div className="flex flex-wrap gap-2 md:col-span-2 lg:col-span-1 lg:flex-col lg:items-stretch">
        {s.sides.map((side) => (
          <Link key={side.team_id} to={`/play/${s.slug}?team=${side.team_id}`} className="btn btn-plain lift min-h-12 text-base">
            Manage {side.name}
          </Link>
        ))}
      </div>
    </li>
  )
}

function HowItPlays() {
  const steps = [
    ['Read the moment', 'A real scoreline, a real minute, and both teams where they actually stood.'],
    ['Take a side', 'Pick who you manage. Every moment works from both dugouts.'],
    ['Make the call', 'Choose a plan, drag players into place, make substitutions.'],
    ['Get the verdict', 'A Gaffer Rating, the pundit’s take, and what really happened next.'],
  ]
  return (
    <section aria-labelledby="how-title" className="border-t-2 border-ink bg-yellow">
      <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6 sm:py-20">
        <h2 id="how-title" className="text-[clamp(2rem,4.4vw,3.25rem)] font-[850] leading-[1.02]">
          One moment, four steps, as many replays as you like.
        </h2>
        <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, text], i) => (
            <li key={title} className="border-t-2 border-ink pt-4">
              <span className="score text-5xl">{i + 1}</span>
              <h3 className="mt-3 text-xl font-[800]">{title}</h3>
              <p className="mt-1 text-body text-ink/80">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function AnalystBand() {
  const shots = useQuery({ queryKey: ['shots', SHOTS_MATCH], queryFn: () => api.shots(SHOTS_MATCH) })
  return (
    <section aria-labelledby="analyst-title" className="border-t-2 border-ink bg-sky">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <h2 id="analyst-title" className="text-[clamp(2.2rem,5vw,3.75rem)] font-[850] leading-[1]">
            Want the evidence?
          </h2>
          <p className="mt-4 max-w-[46ch] text-body">
            Analyst Mode opens up every match behind the moments: shot maps, passing networks, momentum swings and xG,
            plus an analyst you can ask about what you're looking at.
          </p>
          <Link to={`/analyst/${SHOTS_MATCH}`} className="btn btn-ink lift mt-7 min-h-12">
            Open Analyst Mode
          </Link>
        </div>
        <figure className="panel overflow-hidden" style={kitVars('Argentina', 'France')}>
          {shots.data ? (
            <ShotMap shots={shots.data} homeId={SHOTS_HOME} homeName="Argentina" awayName="France" compact />
          ) : (
            <div className="aspect-[3/2] bg-pitch" aria-busy="true" />
          )}
          <figcaption className="border-t-2 border-ink px-4 py-3 text-sm font-semibold">
            Every shot from the 2022 World Cup Final, sized by xG. Penalty shootout excluded.
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
