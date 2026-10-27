import { FastForward, Pause, Play } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Call, CallOption, LiveEngine, LiveEvent } from '../lib/engine'
import { PITCH_X, PITCH_Y } from '../lib/model'
import type { ScenarioDetail } from '../lib/types'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { useVertical } from './Pitch'
import { PitchLines } from './PitchLines'

/** Match seconds per real second at 1x: the last half hour takes about four minutes. */
const SIM_RATE = 7
/** How far the clock slows as an attack builds towards a shot. */
const CHANCE_SLOWDOWN = 0.3
export const SPEEDS = [1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]
const GOAL_HOLD_MS = 1800

export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
// 71:27 is the 72nd minute; 98:00 is still the 98th.
const minuteOf = (t: number) => `${Math.max(1, Math.ceil(t / 60))}'`

interface LiveMatchProps {
  detail: ScenarioDetail
  engine: LiveEngine
  /** Stop the clock and go back to the board. */
  onPause: () => void
  onFullTime: () => void
  reporting: boolean
  error: string | null
  /** A call was answered with a change: the parent updates the board and the engine. */
  onDecide: (option: CallOption) => void
  /** Kept by the parent so a pause doesn't reset it. */
  speed: Speed
  onSpeed: (s: Speed) => void
}

export function LiveMatch({ detail, engine, onPause, onFullTime, reporting, error, speed, onSpeed, onDecide }: LiveMatchProps) {
  const snap = detail.snapshot
  const side = snap.sides[String(engine.teamId)]
  const opp = Object.values(snap.sides).find((s) => s.team_id !== engine.teamId)!
  const reduce = usePrefersReducedMotion()
  const [call, setCall] = useState<Call | null>(engine.pending)
  const [running, setRunning] = useState(() => !reduce && !engine.done && !engine.pending)
  const [events, setEvents] = useState<LiveEvent[]>(() => [...engine.events])
  const [flash, setFlash] = useState<LiveEvent | null>(null)
  // Re-render once a match minute for the chance bar; the clock and players move without React.
  const [, setMinute] = useState(engine.minute)
  const clockRef = useRef<HTMLSpanElement>(null)
  const pitch = useRef<LivePitchHandle>(null)
  const hold = useRef(0)
  const logged = useRef(engine.events.length)
  const finished = useRef(engine.done)

  const fullTime = () => {
    if (finished.current) return
    finished.current = true
    setRunning(false)
    onFullTime()
  }

  const take = (fresh: LiveEvent[]) => {
    // Changes made from the board are logged outside advance(), so follow the log itself.
    if (engine.events.length !== logged.current) {
      logged.current = engine.events.length
      setEvents([...engine.events])
    }
    if (!fresh.length) return
    const goal = fresh.findLast((e) => e.kind === 'goal')
    if (goal) {
      setFlash(goal)
      hold.current = performance.now() + GOAL_HOLD_MS
      window.setTimeout(() => setFlash((f) => (f === goal ? null : f)), GOAL_HOLD_MS + 400)
    }
    for (const e of fresh) if (e.at) pitch.current?.shot(e)
  }

  const draw = () => {
    pitch.current?.draw(engine)
    if (clockRef.current) clockRef.current.textContent = clock(engine.t)
  }

  useLayoutEffect(draw)

  useEffect(() => {
    if (!running) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // Quiet spells run at speed; the clock eases off as a chance builds, so you see it coming.
      const rate = SIM_RATE * speed * (1 - (1 - CHANCE_SLOWDOWN) * engine.tension())
      if (now >= hold.current) take(engine.advance(dt * rate))
      setMinute(engine.minute)
      draw()
      if (engine.pending) {
        // The clock waits for the manager.
        setCall(engine.pending)
        setRunning(false)
        return
      }
      if (engine.done) {
        fullTime()
        return
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
    // The loop reads the engine directly; it restarts only on play/pause or speed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speed])

  const answer = (option: CallOption) => {
    engine.answer(option.key)
    if (option.tactic || option.sub) onDecide(option)
    setEvents([...engine.events])
    setCall(null)
    setRunning(true)
  }

  const skip = () => {
    setCall(null)
    setRunning(false)
    hold.current = 0
    take(engine.runToEnd())
    setFlash(null)
    draw()
    fullTime()
  }

  const home = snap.sides[String(snap.match.home_team_id)]
  const away = snap.sides[String(snap.match.away_team_id)]
  const { for: f, against: a } = engine.score
  const score = side.is_home ? { home: f, away: a } : { home: a, away: f }
  const done = engine.done
  const announce = events.filter((e) => e.kind === 'goal' || e.kind === 'fulltime').at(-1)

  return (
    <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] lg:py-8">
      <section aria-labelledby="live-title" className="min-w-0">
        <h1 id="live-title" className="sr-only">
          The match, live
        </h1>
        <p className="sr-only" aria-live="polite">
          {announce?.text}
        </p>
        <div className="overflow-hidden rounded-[14px] border-2 border-ink bg-pitch">
          {/* Score bug */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-ink px-3 py-2 text-cream sm:px-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <TeamChip name={home.name} code={home.code} kit={home.team_id === side.team_id ? 'you' : 'them'} />
              <span className="score text-2xl tabular-nums sm:text-3xl">
                {score.home}–{score.away}
              </span>
              <TeamChip name={away.name} code={away.code} kit={away.team_id === side.team_id ? 'you' : 'them'} />
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-yellow px-2 py-0.5 text-ink">
                <span ref={clockRef} className="score-narrow text-xl tabular-nums" aria-label="Match clock">
                  {clock(engine.t)}
                </span>
              </span>
              <span className={`text-xs font-[750] uppercase tracking-wide ${done ? 'text-yellow' : running ? 'text-cream' : 'text-cream/70'}`}>
                {done ? 'Full time' : running ? 'Live' : 'Paused'}
              </span>
            </div>
          </div>
          <div className="relative">
            <LivePitch ref={pitch} engine={engine} keyThreatId={side.key_threat?.player_id} label={`${side.name} attacking ${'right'}, ${opp.name} attacking left.`} />
            {flash && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <p
                  className="tx-goal rounded-[12px] border-[3px] border-ink px-6 py-3 text-center shadow-[6px_6px_0_var(--color-ink)]"
                  style={
                    flash.team === 'you'
                      ? { background: 'var(--kit-you, var(--color-sky))', color: 'var(--kit-you-ink, var(--color-ink))' }
                      : { background: 'var(--kit-them, var(--color-vermilion))', color: 'var(--kit-them-ink, var(--color-ink))' }
                  }
                >
                  <span className="score block text-[clamp(2.4rem,7vw,4.5rem)] leading-none">GOAL</span>
                  <span className="mt-1 block font-[800]">
                    {flash.player}, {minuteOf(flash.t)}
                  </span>
                </p>
              </div>
            )}
            {call && !done && <CallCard call={call} onAnswer={answer} />}
            {done && (
              <div className="absolute inset-0 grid place-items-center bg-ink/55">
                <div className="panel max-w-[30ch] p-5 text-center">
                  <p className="score text-4xl">Full time</p>
                  <p className="mt-2 font-[750]">
                    {home.code} {score.home}–{score.away} {away.code}
                  </p>
                  <p className="mt-2 text-sm text-ink-soft" role={error ? 'alert' : undefined}>
                    {error ?? (reporting ? 'The pundit is writing up your match…' : 'Here comes the verdict.')}
                  </p>
                  {error && (
                    <button type="button" onClick={onFullTime} className="btn btn-primary lift mt-3">
                      Try again
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <ChanceBar engine={engine} events={events} you={side.code} them={opp.code} />
        </div>
        {reduce && !done && !running && (
          <p className="mt-3 rounded-[10px] border-2 border-ink bg-paper px-3 py-2.5 text-sm">
            Your device asks for reduced motion, so the match waits for you. Play it to watch the players move, or skip
            straight to the result.
          </p>
        )}
      </section>

      <aside aria-labelledby="touchline-title" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <div className="panel p-4 sm:p-5">
          <h2 id="touchline-title" className="text-2xl font-[850]">
            On the touchline
          </h2>
          <p className="mt-1 text-ink-soft">Not working? Stop the clock and change it.</p>
          <button type="button" onClick={onPause} disabled={done || Boolean(call)} className="btn btn-primary lift mt-4 w-full text-lg">
            <Pause size={18} strokeWidth={2.75} aria-hidden="true" />
            Pause and change tactics
          </button>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRunning((r) => !r)}
              disabled={done || Boolean(call)}
              aria-label={running ? 'Pause the clock' : 'Play'}
              className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper enabled:hover:bg-yellow disabled:opacity-40"
            >
              {running ? <Pause size={18} strokeWidth={2.75} aria-hidden="true" /> : <Play size={18} strokeWidth={2.75} aria-hidden="true" />}
            </button>
            <div role="radiogroup" aria-label="Match speed" className="flex flex-1 overflow-hidden rounded-full border-2 border-ink">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={speed === s}
                  disabled={done}
                  onClick={() => onSpeed(s)}
                  className={`flex-1 border-ink py-2 text-sm font-[800] tabular-nums not-first:border-l-2 ${speed === s ? 'bg-ink text-cream' : 'bg-paper enabled:hover:bg-cream-deep'}`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={skip} disabled={done} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-ink bg-paper px-4 py-2 font-[750] enabled:hover:bg-cream-deep disabled:opacity-40">
            <FastForward size={16} strokeWidth={2.75} aria-hidden="true" />
            Skip to the result
          </button>
        </div>
        <Feed events={events} />
      </aside>
    </div>
  )
}

/** A note from the bench: the clock is stopped until you answer. */
function CallCard({ call, onAnswer }: { call: Call; onAnswer: (o: CallOption) => void }) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus({ preventScroll: true }), [call])
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/45 p-3">
      <section
        role="alertdialog"
        aria-labelledby="call-title"
        aria-describedby="call-body"
        className="tx-pop w-full max-w-[420px] overflow-hidden rounded-[14px] border-[3px] border-ink bg-paper shadow-[6px_6px_0_var(--color-ink)]"
      >
        <p className="flex items-center justify-between border-b-2 border-ink bg-yellow px-4 py-1.5">
          <span className="score-narrow text-sm tracking-wide">YOUR CALL</span>
          <span className="score-narrow text-sm tabular-nums">{minuteOf(call.t)}</span>
        </p>
        <div className="px-4 pb-4 pt-3">
          <h2 id="call-title" className="text-2xl font-[850] leading-tight">
            {call.title}
          </h2>
          <p id="call-body" className="mt-1 text-ink-soft">
            {call.body}
          </p>
          <div className="mt-3 grid gap-2">
            {call.options.map((o, i) => {
              const hold = !o.tactic && !o.sub
              return (
                <button
                  key={o.key}
                  ref={i === 0 ? first : undefined}
                  type="button"
                  onClick={() => onAnswer(o)}
                  className={`lift rounded-[10px] border-2 border-ink px-3 py-2 text-left ${hold ? 'bg-cream hover:bg-cream-deep' : 'bg-paper hover:bg-yellow'}`}
                >
                  <span className="block font-[800] leading-tight">{o.label}</span>
                  <span className="block text-sm leading-snug text-ink-soft">{o.hint}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

function TeamChip({ name, code, kit }: { name: string; code: string; kit: 'you' | 'them' }) {
  return (
    <span
      className="score-narrow rounded-md border-2 border-cream/0 px-2 py-0.5 text-lg"
      title={name}
      style={{ background: `var(--kit-${kit})`, color: `var(--kit-${kit}-ink)` }}
    >
      {code}
    </span>
  )
}

function Feed({ events }: { events: LiveEvent[] }) {
  const shown = events.slice(-40).reverse()
  return (
    <section aria-labelledby="feed-title" className="panel flex max-h-[min(60vh,520px)] flex-col overflow-hidden">
      <h2 id="feed-title" className="border-b-2 border-ink px-4 py-3 text-lg font-[850] sm:px-5">
        Match feed
      </h2>
      <ol className="grid gap-px overflow-y-auto bg-ink/10">
        {shown.map((e, i) => (
          <li
            key={`${e.t}-${i}-${e.kind}`}
            className={`flex gap-3 px-4 py-2.5 text-sm sm:px-5 ${e.kind === 'goal' ? 'bg-yellow font-[750]' : e.kind === 'change' || e.kind === 'decision' ? 'bg-ink text-cream' : e.kind === 'play' ? 'bg-paper text-ink-soft' : 'bg-paper'}`}
          >
            <span className="score-narrow w-8 shrink-0 tabular-nums">{minuteOf(e.t)}</span>
            <span className="leading-snug">
              {(e.kind === 'change' || e.kind === 'decision') && <span className="font-[800]">Your call: </span>}
              {e.kind === 'card' && <span className="mr-1.5 inline-block h-3.5 w-2.5 translate-y-0.5 rounded-[2px] border border-ink bg-yellow" aria-label="Yellow card" />}
              {e.text}
              {e.xg !== undefined && <span className={`ml-1 tabular-nums ${e.kind === 'goal' ? '' : 'text-ink-soft'}`}>({e.xg.toFixed(2)} xG)</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Chances so far: the scoreline has luck in it, the expected goals less so. */
function ChanceBar({ engine, events, you, them }: { engine: LiveEngine; events: LiveEvent[]; you: string; them: string }) {
  // Re-read whenever something happens on the pitch.
  void events
  const s = engine.summary()
  const total = Math.max(0.3, s.xg_for + s.xg_against)
  return (
    <div className="flex items-center gap-3 border-t-2 border-ink bg-paper px-3 py-2 text-sm sm:px-4">
      <span className="font-[750]">
        {you} <span className="tabular-nums">{s.xg_for.toFixed(2)}</span>
      </span>
      <div className="flex h-2.5 flex-1 overflow-hidden rounded-full border-2 border-ink bg-cream" role="img" aria-label={`Expected goals so far: ${you} ${s.xg_for.toFixed(2)}, ${them} ${s.xg_against.toFixed(2)}`}>
        <div style={{ width: `${(s.xg_for / total) * 100}%`, background: 'var(--kit-you, var(--color-sky))' }} />
        <div className="ml-auto" style={{ width: `${(s.xg_against / total) * 100}%`, background: 'var(--kit-them, var(--color-vermilion))' }} />
      </div>
      <span className="font-[750]">
        <span className="tabular-nums">{s.xg_against.toFixed(2)}</span> {them}
      </span>
      <span className="hidden text-ink-soft sm:inline">xG since {Math.floor(engine.start / 60)}'</span>
    </div>
  )
}

interface LivePitchHandle {
  draw: (engine: LiveEngine) => void
  shot: (e: LiveEvent) => void
}

/** The pitch, moved every frame by writing transforms straight to the SVG. */
function LivePitch({
  engine,
  keyThreatId,
  label,
  ref,
}: {
  engine: LiveEngine
  keyThreatId?: number | null
  label: string
  ref: React.Ref<LivePitchHandle>
}) {
  const vertical = useVertical('auto')
  const nodes = useRef(new Map<string, SVGGElement>())
  const ball = useRef<SVGGElement>(null)
  const trail = useRef<SVGLineElement>(null)
  const shotAt = useRef<{ x1: number; y1: number; x2: number; y2: number; until: number } | null>(null)
  // What's on screen, easing towards where the engine wants everyone.
  const shown = useRef(new Map<string, { x: number; y: number }>())
  const lastDraw = useRef(0)

  const setRef = (key: string) => (el: SVGGElement | null) => {
    if (el) nodes.current.set(key, el)
    else nodes.current.delete(key)
  }

  useImperativeHandle(ref, () => ({
    draw: (eng) => {
      const now = performance.now()
      const dt = lastDraw.current ? Math.min(0.1, (now - lastDraw.current) / 1000) : 1
      lastDraw.current = now
      const f = eng.frame()
      // Exponential easing: players glide (a little behind the play, like real
      // legs), the ball follows closely. Nobody ever jumps.
      const ease = (key: string, x: number, y: number, rate: number) => {
        const cur = shown.current.get(key)
        const k = 1 - Math.exp(-rate * dt)
        const next = cur ? { x: cur.x + (x - cur.x) * k, y: cur.y + (y - cur.y) * k } : { x, y }
        shown.current.set(key, next)
        return next
      }
      const put = (el: SVGGElement | null | undefined, p: { x: number; y: number }) =>
        el?.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`)
      // A slow idle sway in real time, so a quiet spell isn't frozen.
      const sway = (id: number) => ({ x: Math.sin(now / 1900 + id) * 0.5, y: Math.cos(now / 2300 + id) * 0.5 })
      for (const p of f.you) {
        const s = sway(p.id)
        put(nodes.current.get(`you-${p.id}`), ease(`you-${p.id}`, p.x + s.x, p.y + s.y, 3.2))
      }
      for (const p of f.them) {
        const s = sway(p.id)
        put(nodes.current.get(`them-${p.id}`), ease(`them-${p.id}`, p.x + s.x, p.y + s.y, 3.2))
      }
      put(ball.current, ease('ball', f.ball.x, f.ball.y, 12))
      const line = trail.current
      const s = shotAt.current
      if (line) {
        const left = s ? s.until - performance.now() : 0
        if (s && left > 0) {
          line.setAttribute('x1', String(s.x1))
          line.setAttribute('y1', String(s.y1))
          line.setAttribute('x2', String(s.x2))
          line.setAttribute('y2', String(s.y2))
          line.setAttribute('opacity', String(Math.min(1, left / 400)))
        } else line.setAttribute('opacity', '0')
      }
    },
    shot: (e) => {
      if (!e.at) return
      const goalX = e.team === 'you' ? PITCH_X : 0
      // Goals go in; misses go wide of the post.
      const goalY = e.kind === 'goal' ? PITCH_Y / 2 + (e.at.y - PITCH_Y / 2) * 0.05 : PITCH_Y / 2 + (e.at.y >= PITCH_Y / 2 ? 6 : -6)
      shotAt.current = { x1: e.at.x, y1: e.at.y, x2: goalX, y2: goalY, until: performance.now() + 1100 }
    },
  }), [])

  const groupTransform = vertical ? 'matrix(0,-1,1,0,0,120)' : undefined
  const upright = vertical ? 'rotate(90)' : undefined
  const viewBox = vertical ? '-1 -1 82 122' : '-1 -1 122 82'
  const you = engine.players
  const them = engine.opponents

  return (
    <svg viewBox={viewBox} className="block w-full select-none" role="img" aria-label={label}>
      <g transform={groupTransform}>
        <rect x={0} y={0} width={PITCH_X} height={PITCH_Y} fill="var(--color-pitch)" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={i * 20 + 10} y={0} width={10} height={PITCH_Y} fill="var(--color-pitch-stripe)" />
        ))}
        <PitchLines />
        <line ref={trail} stroke="var(--color-yellow)" strokeWidth={0.7} strokeDasharray="1.6 1" strokeLinecap="round" opacity={0} />
        {them.map((t) => (
          <g key={`them-${t.id}`} ref={setRef(`them-${t.id}`)} transform={`translate(${t.x} ${t.y})`}>
            {t.id === keyThreatId && <circle r={5} fill="none" stroke="var(--color-ink)" strokeWidth={0.5} strokeDasharray="1.4 1" />}
            <rect x={-2.6} y={-2.6} width={5.2} height={5.2} rx={1} fill="var(--kit-them, var(--color-vermilion))" stroke="var(--color-ink)" strokeWidth={0.45} />
            <g transform={upright}>
              <text textAnchor="middle" dy="0.95" fontSize={2.5} className="score-narrow" fill="var(--kit-them-ink, var(--color-ink))">
                {t.number ?? ''}
              </text>
            </g>
          </g>
        ))}
        {you.map((t) => (
          <g key={`you-${t.id}`} ref={setRef(`you-${t.id}`)} transform={`translate(${t.x} ${t.y})`}>
            <circle r={2.9} fill="var(--kit-you, var(--color-sky))" stroke="var(--color-ink)" strokeWidth={0.55} />
            <g transform={upright}>
              <text textAnchor="middle" dy="0.95" fontSize={2.6} className="score-narrow" fill="var(--kit-you-ink, var(--color-ink))">
                {t.number ?? ''}
              </text>
            </g>
          </g>
        ))}
        <g ref={ball}>
          <circle r={1.25} fill="var(--color-chalk)" stroke="var(--color-ink)" strokeWidth={0.45} />
        </g>
      </g>
    </svg>
  )
}
