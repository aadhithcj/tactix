import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import type { MatchDetail, MomentumBucket } from '../lib/types'

const W = 120
const H = 64
const MID = H / 2
const YOU = 'var(--kit-you, var(--color-sky))'
const THEM = 'var(--kit-them, var(--color-vermilion))'

/**
 * Five-minute momentum bars. Point at, tap or arrow through a spell to see who
 * was on top, the xG and forward passes behind it, and any goals in it.
 */
export function MomentumChart({ match, timeline }: { match: MatchDetail; timeline: MomentumBucket[] }) {
  const [active, setActive] = useState<number | null>(null)
  const shots = useQuery({ queryKey: ['shots', match.id], queryFn: () => api.shots(match.id) })

  if (!timeline.length) return <p className="p-6">No momentum data for this match.</p>

  const max = Math.max(...timeline.map((b) => Math.abs(b.momentum)), 0.5)
  const bw = W / timeline.length
  const up = timeline[0].team_home
  const down = timeline[0].team_away
  // Kit colours follow the match's home and away sides, whichever way the bars point.
  const homeName = match.home_team?.name
  const colourOf = (team: string) => (team === homeName ? YOU : THEM)

  const goals = (shots.data ?? [])
    .filter((s) => s.outcome === 'Goal' && (s.period ?? 1) < 5)
    .map((s) => ({
      at: s.minute + s.second / 60,
      minute: s.minute + 1,
      player: s.player_name ?? 'Unknown',
      team: s.team_id === match.home_team_id ? homeName : match.away_team?.name,
    }))

  const spell = active === null ? null : timeline[active]
  const spellStart = active === null ? 0 : active * 5
  const spellGoals = goals.filter((g) => g.at >= spellStart && g.at < spellStart + 5)
  const biggest = timeline.reduce((best, b, i) => (Math.abs(b.momentum) > Math.abs(timeline[best].momentum) ? i : best), 0)

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = timeline.length - 1
    const keys: Record<string, number> = {
      ArrowRight: Math.min((active ?? -1) + 1, last),
      ArrowLeft: Math.max((active ?? 1) - 1, 0),
      Home: 0,
      End: last,
    }
    if (e.key in keys) {
      e.preventDefault()
      setActive(keys[e.key])
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  return (
    <div className="p-4 sm:p-5">
      <p className="text-sm text-ink-soft">
        Each bar is five minutes. Up means {up} were on top, down means {down}. Built from xG and forward passes. Balls mark the goals.
      </p>

      <div
        tabIndex={0}
        role="group"
        aria-label={`Momentum by five-minute spell. Use the left and right arrow keys to step through ${timeline.length} spells.`}
        onKeyDown={onKeyDown}
        onFocus={() => active === null && setActive(biggest)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        className="mt-3 rounded-[10px]"
      >
        <svg viewBox={`0 0 ${W} ${H + 8}`} className="block w-full touch-pan-y" aria-hidden="true">
          {[45, 90, 105].map((m) => {
            const x = (m / 5) * bw
            return x < W ? (
              <g key={m}>
                <line x1={x} y1={2} x2={x} y2={H - 2} stroke="var(--color-ink)" strokeWidth={0.2} strokeDasharray="1 1" />
                <text x={x + 0.8} y={4.5} fontSize={2.4} fill="var(--color-ink-soft)">
                  {m}'
                </text>
              </g>
            ) : null
          })}

          {active !== null && <rect x={active * bw} y={1} width={bw} height={H - 2} rx={0.8} fill="var(--color-yellow)" opacity={0.45} />}

          {timeline.map((b, i) => {
            const h = (Math.abs(b.momentum) / max) * (MID - 5)
            const isUp = b.momentum >= 0
            const dim = active !== null && active !== i
            return (
              <g key={b.interval} opacity={dim ? 0.35 : 1} style={{ transition: 'opacity 150ms' }}>
                <rect
                  x={i * bw + bw * 0.12}
                  y={isUp ? MID - h : MID}
                  width={bw * 0.76}
                  height={Math.max(h, 0.3)}
                  rx={0.6}
                  fill={colourOf(isUp ? up : down)}
                  stroke="var(--color-ink)"
                  strokeWidth={active === i ? 0.7 : 0.3}
                />
              </g>
            )
          })}

          <line x1={0} y1={MID} x2={W} y2={MID} stroke="var(--color-ink)" strokeWidth={0.5} />

          {goals.map((g, i) => {
            const x = Math.min(W - 1.6, (g.at / 5) * bw)
            const top = g.team === up
            return (
              <g key={i} transform={`translate(${x} ${top ? 7.5 : H - 3.5})`}>
                <circle r={1.5} fill={colourOf(g.team ?? '')} stroke="var(--color-ink)" strokeWidth={0.45} />
                <circle r={0.45} fill="var(--color-ink)" />
              </g>
            )
          })}

          {/* Full-height hit areas so thin bars are easy to point at or tap. */}
          {timeline.map((b, i) => (
            <rect
              key={`hit-${b.interval}`}
              x={i * bw}
              y={0}
              width={bw}
              height={H}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setActive(i)}
              onClick={() => setActive(i)}
            />
          ))}

          {[0, 30, 60, 90, 120].map((m) => {
            const x = (m / 5) * bw
            return x <= W ? (
              <text key={m} x={Math.min(x, W - 4)} y={H + 6} fontSize={2.6} fill="var(--color-ink-soft)">
                {m}'
              </text>
            ) : null
          })}
        </svg>
      </div>

      {/* Fixed height so stepping through spells never shifts the layout. */}
      <div className="mt-4 min-h-[11.5rem] rounded-[12px] border-2 border-ink bg-cream p-4" aria-live="polite">
        {spell ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="score text-2xl">
                {spell.interval.replace('-', "'–")}'
              </p>
              <p className="flex items-center gap-2 font-[800]">
                {Math.abs(spell.momentum) < 0.05 ? (
                  'Nobody on top'
                ) : (
                  <>
                    <span
                      className="size-3.5 rounded-full border-2 border-ink"
                      style={{ background: colourOf(spell.momentum > 0 ? up : down) }}
                      aria-hidden="true"
                    />
                    {spell.momentum > 0 ? up : down} on top
                  </>
                )}
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-md">
              <dt className="text-ink-soft">Expected goals</dt>
              <dd className="tabular-nums">
                <span className="font-[800]">{spell.home_xg.toFixed(2)}</span> {up} v{' '}
                <span className="font-[800]">{spell.away_xg.toFixed(2)}</span> {down}
              </dd>
              <dt className="text-ink-soft">Forward passes</dt>
              <dd className="tabular-nums">
                <span className="font-[800]">{spell.home_progressive_passes}</span> v{' '}
                <span className="font-[800]">{spell.away_progressive_passes}</span>
              </dd>
            </dl>
            <ul className="mt-3 grid min-h-[2.75rem] content-start gap-1 text-sm">
              {spellGoals.length === 0 && <li className="text-ink-soft">No goals in this spell.</li>}
              {spellGoals.map((g, i) => (
                <li key={i} className="font-[750]">
                  Goal: {g.minute}' {g.player} <span className="font-normal text-ink-soft">({g.team})</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-body text-ink-soft">
            Point at a bar, tap it, or focus the chart and use the arrow keys to see each five-minute spell. The biggest swing came
            in minutes {timeline[biggest].interval.replace('-', '–')}.
          </p>
        )}
      </div>

      <ul className="mt-3 flex gap-4 text-sm">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border-2 border-ink" style={{ background: colourOf(up) }} />
          {up}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border-2 border-ink" style={{ background: colourOf(down) }} />
          {down}
        </li>
      </ul>
    </div>
  )
}
