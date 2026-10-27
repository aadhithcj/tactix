import { useQuery } from '@tanstack/react-query'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { chalkColour, kitPair } from '../lib/kits'
import { PITCH_X, PITCH_Y } from '../lib/model'
import { shortName } from '../lib/names'
import { ballAt, buildReplay, clockAt, scoreAt, type Replay, type ReplayGoal } from '../lib/replay'
import type { ScenarioDetail } from '../lib/types'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { clock } from './LiveMatch'
import { useVertical } from './Pitch'
import { PitchLines } from './PitchLines'

/** Match seconds per real second at 1x. */
const RATE = 6
const SPEEDS = [1, 2, 4] as const
/** How long a pass stays drawn on the board, in match seconds. */
const TRAIL = 14
const TRAIL_LINES = 18
const GOAL_HOLD_MS = 2200

interface RealReplayProps {
  detail: ScenarioDetail
  teamId: number
  /** Your simulated full time, to set against the real one. */
  yours?: { for: number; against: number } | null
}

/**
 * What really happened, drawn on a chalkboard: the ball follows every real
 * pass and shot from the frozen minute, leaving fading chalk in team colours.
 */
export function RealReplay({ detail, teamId, yours }: RealReplayProps) {
  const snap = detail.snapshot
  const events = useQuery({
    queryKey: ['replay', snap.match.id, snap.minute],
    queryFn: () => api.replayEvents(snap.match.id, snap.minute),
    staleTime: Infinity,
  })
  const replay = useMemo(() => (events.data ? buildReplay(detail, teamId, events.data) : null), [events.data, detail, teamId])

  if (events.isPending)
    return <p className="px-4 py-10 text-center text-ink-soft sm:px-5">Fetching every touch from the real match…</p>
  if (events.error || !replay)
    return (
      <p role="alert" className="px-4 py-10 text-center sm:px-5">
        The real match couldn't load. {events.error?.message}
      </p>
    )
  if (!replay.moves.length) return <p className="px-4 py-10 text-center sm:px-5">There are no recorded events after this minute.</p>
  return <Board detail={detail} teamId={teamId} replay={replay} yours={yours} />
}

function Board({ detail, teamId, replay, yours }: { detail: ScenarioDetail; teamId: number; replay: Replay; yours?: RealReplayProps['yours'] }) {
  const snap = detail.snapshot
  const side = snap.sides[String(teamId)]
  const opp = Object.values(snap.sides).find((s) => s.team_id !== teamId)!
  const reduce = usePrefersReducedMotion()
  const vertical = useVertical('auto')
  // Kit colours that still show on the dark board.
  const [kitYou, kitThem] = kitPair(side.name, opp.name)
  const chalk = { you: chalkColour(kitYou.fill), them: chalkColour(kitThem.fill) }
  const [running, setRunning] = useState(!reduce)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2)
  const [p, setP] = useState(0)
  const [flash, setFlash] = useState<ReplayGoal | null>(null)
  const pRef = useRef(0)
  const hold = useRef(0)
  const lines = useRef<(SVGLineElement | null)[]>([])
  const ball = useRef<SVGGElement>(null)
  const label = useRef<SVGTextElement>(null)
  const shotLine = useRef<SVGLineElement>(null)

  const draw = (at: number) => {
    const b = ballAt(replay, at)
    ball.current?.setAttribute('transform', `translate(${b.x.toFixed(2)} ${b.y.toFixed(2)})`)
    const m = replay.moves[b.index]
    if (label.current) {
      label.current.textContent = m?.player ? shortName(m.player) : ''
      label.current.setAttribute('x', b.x.toFixed(2))
      label.current.setAttribute('y', (b.y - 3).toFixed(2))
    }
    // The last few passes, fading as they age.
    let slot = 0
    for (let i = b.index; i >= 0 && slot < TRAIL_LINES; i--) {
      const mv = replay.moves[i]
      const age = at - mv.p2
      if (age > TRAIL) break
      if (mv.kind !== 'pass') continue
      const el = lines.current[slot++]
      if (!el) continue
      const k = mv.p2 === mv.p ? 1 : Math.min(1, Math.max(0, (at - mv.p) / (mv.p2 - mv.p)))
      el.setAttribute('x1', String(mv.x))
      el.setAttribute('y1', String(mv.y))
      el.setAttribute('x2', String(mv.x + (mv.x2 - mv.x) * k))
      el.setAttribute('y2', String(mv.y + (mv.y2 - mv.y) * k))
      el.setAttribute('stroke', chalk[mv.team])
      el.setAttribute('opacity', String(Math.max(0.12, 1 - Math.max(0, age) / TRAIL)))
    }
    for (; slot < TRAIL_LINES; slot++) lines.current[slot]?.setAttribute('opacity', '0')
    // A shot: chalk dashes to goal while it's fresh.
    const shot = [...replay.moves.slice(Math.max(0, b.index - 3), b.index + 1)].reverse().find((mv) => mv.kind === 'shot' && at - mv.p2 < 3)
    const sl = shotLine.current
    if (sl) {
      if (shot) {
        sl.setAttribute('x1', String(shot.x))
        sl.setAttribute('y1', String(shot.y))
        sl.setAttribute('x2', String(shot.x2))
        sl.setAttribute('y2', String(shot.y2))
        sl.setAttribute('opacity', String(Math.min(1, 3 - Math.max(0, at - shot.p2))))
      } else sl.setAttribute('opacity', '0')
    }
  }

  const seek = (to: number) => {
    pRef.current = Math.max(0, Math.min(replay.length, to))
    setP(pRef.current)
    draw(pRef.current)
  }

  useLayoutEffect(() => draw(pRef.current))

  useEffect(() => {
    if (!running) return
    let last = performance.now()
    let id = 0
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (now >= hold.current) {
        const before = pRef.current
        const after = Math.min(replay.length, before + dt * RATE * speed)
        const goal = replay.goals.find((g) => g.p > before && g.p <= after)
        pRef.current = goal ? goal.p : after
        if (goal) {
          setFlash(goal)
          hold.current = now + GOAL_HOLD_MS
          window.setTimeout(() => setFlash((f) => (f === goal ? null : f)), GOAL_HOLD_MS)
        }
        // React only needs the time for the score, clock and scrubber.
        setP(pRef.current)
      }
      draw(pRef.current)
      if (pRef.current >= replay.length) {
        setRunning(false)
        return
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speed, replay])

  const score = scoreAt(replay, p)
  const finished = p >= replay.length
  const home = side.is_home ? { code: side.code, kit: 'you', n: score.you } : { code: opp.code, kit: 'them', n: score.them }
  const away = side.is_home ? { code: opp.code, kit: 'them', n: score.them } : { code: side.code, kit: 'you', n: score.you }
  const groupTransform = vertical ? 'matrix(0,-1,1,0,0,120)' : undefined
  const viewBox = vertical ? '-1 -1 82 122' : '-1 -1 122 82'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink bg-ink px-3 py-2 text-cream sm:px-4">
        <div className="flex items-center gap-2 sm:gap-3">
          {[home, away].map((t, i) => (
            <span key={t.code} className="flex items-center gap-2 sm:gap-3">
              {i === 1 && (
                <span className="score text-2xl tabular-nums sm:text-3xl">
                  {home.n}–{away.n}
                </span>
              )}
              <span className="score-narrow rounded-md px-2 py-0.5 text-lg" style={{ background: `var(--kit-${t.kit})`, color: `var(--kit-${t.kit}-ink)` }}>
                {t.code}
              </span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-yellow px-2 py-0.5 text-ink">
            <span className="score-narrow text-xl tabular-nums">{clock(clockAt(replay, p))}</span>
          </span>
          <span className="text-xs font-[750] uppercase tracking-wide text-yellow">The real match</span>
        </div>
      </div>

      <div className="relative bg-ink">
        <svg viewBox={viewBox} className="mx-auto block w-full max-w-[960px] select-none" role="img" aria-label={`The real match from minute ${snap.minute}, drawn as the ball moved. ${side.name} attack ${vertical ? 'up' : 'right'}.`}>
          <g transform={groupTransform}>
            {/* Chalkboard */}
            <rect x={0} y={0} width={PITCH_X} height={PITCH_Y} fill="var(--color-ink)" />
            <g opacity={0.55}>
              <PitchLines />
            </g>
            {Array.from({ length: TRAIL_LINES }, (_, i) => (
              <line
                key={i}
                ref={(el) => {
                  lines.current[i] = el
                }}
                strokeWidth={0.9}
                strokeLinecap="round"
                opacity={0}
              />
            ))}
            <line ref={shotLine} stroke="var(--color-yellow)" strokeWidth={0.8} strokeDasharray="1.6 1.1" strokeLinecap="round" opacity={0} />
            <g ref={ball}>
              <circle r={1.5} fill="var(--color-chalk)" stroke="var(--color-ink)" strokeWidth={0.4} />
            </g>
            <text
              ref={label}
              textAnchor="middle"
              fontSize={2.4}
              fontWeight={750}
              fill="var(--color-chalk)"
              // Names would read sideways on the turned pitch.
              className={vertical ? 'hidden' : undefined}
            />
          </g>
        </svg>
        {flash && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p
              className="tx-goal rounded-[12px] border-[3px] border-ink px-6 py-3 text-center shadow-[6px_6px_0_var(--color-yellow)]"
              style={
                flash.team === 'you'
                  ? { background: 'var(--kit-you, var(--color-sky))', color: 'var(--kit-you-ink, var(--color-ink))' }
                  : { background: 'var(--kit-them, var(--color-vermilion))', color: 'var(--kit-them-ink, var(--color-ink))' }
              }
            >
              <span className="score block text-[clamp(2.4rem,7vw,4.5rem)] leading-none">GOAL</span>
              <span className="mt-1 block font-[800]">
                {flash.player}, {Math.floor(flash.clock / 60) + 1}'
              </span>
            </p>
          </div>
        )}
        {finished && (
          <div className="absolute inset-0 grid place-items-center bg-ink/60 p-3">
            <div className="panel max-w-[34ch] p-5 text-center">
              <p className="score text-3xl">Full time, for real</p>
              <p className="mt-2 font-[750]">
                {home.code} {home.n}–{away.n} {away.code}
              </p>
              {replay.afterwards && <p className="mt-1 text-sm">{replay.afterwards}</p>}
              {yours && (
                <p className="mt-2 text-sm text-ink-soft">
                  Your version finished {side.code} {yours.for}–{yours.against} {opp.code}.
                </p>
              )}
              <button type="button" onClick={() => { seek(0); setRunning(true) }} className="btn btn-plain lift mt-3">
                <RotateCcw size={16} strokeWidth={2.75} aria-hidden="true" />
                Watch again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t-2 border-ink bg-paper px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => (finished ? (seek(0), setRunning(true)) : setRunning((r) => !r))}
          aria-label={running ? 'Pause the replay' : 'Play the replay'}
          className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper hover:bg-yellow"
        >
          {running ? <Pause size={18} strokeWidth={2.75} aria-hidden="true" /> : <Play size={18} strokeWidth={2.75} aria-hidden="true" />}
        </button>
        <div className="relative min-w-[160px] flex-1">
          <input
            type="range"
            min={0}
            max={replay.length}
            step={0.5}
            value={p}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Replay position"
            aria-valuetext={clock(clockAt(replay, p))}
            className="w-full accent-[var(--color-ink)]"
          />
          {/* Where the real goals came */}
          <div className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-2" aria-hidden="true">
            {replay.goals.map((g, i) => (
              <span
                key={i}
                className="absolute top-0 size-2 -translate-x-1/2 rounded-full border border-ink"
                style={{ left: `${(g.p / replay.length) * 100}%`, background: g.team === 'you' ? 'var(--kit-you)' : 'var(--kit-them)' }}
              />
            ))}
          </div>
        </div>
        <div role="radiogroup" aria-label="Replay speed" className="flex overflow-hidden rounded-full border-2 border-ink">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => setSpeed(s)}
              className={`px-3 py-1.5 text-sm font-[800] tabular-nums not-first:border-l-2 not-first:border-ink ${speed === s ? 'bg-ink text-cream' : 'bg-paper hover:bg-cream-deep'}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
