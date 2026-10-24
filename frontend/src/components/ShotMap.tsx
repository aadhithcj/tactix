import { useState } from 'react'
import type { MatchEvent } from '../lib/types'
import { PitchLines } from './PitchLines'

interface ShotMapProps {
  shots: MatchEvent[]
  homeId: number
  homeName: string
  awayName: string
  compact?: boolean
}

const radius = (xg: number | null) => 1.1 + Math.sqrt(xg ?? 0.02) * 5.2

/** Both teams' shots on one pitch: home attacks right, away attacks left. */
export function ShotMap({ shots, homeId, homeName, awayName, compact = false }: ShotMapProps) {
  const [active, setActive] = useState<string | null>(null)
  const inPlay = shots.filter((s) => (s.period ?? 1) < 5 && s.x !== null && s.y !== null)
  const sorted = [...inPlay].sort((a, b) => (b.xg ?? 0) - (a.xg ?? 0))
  const current = inPlay.find((s) => s.id === active)

  return (
    <div>
      <svg viewBox="-1 -1 122 82" className="block w-full" role="img" aria-label={`Shot map. ${homeName} shoot to the right, ${awayName} to the left. Circle size shows expected goals; solid circles are goals.`}>
        <rect x={-1} y={-1} width={122} height={82} fill="var(--color-pitch)" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={i * 20 + 10} y={0} width={10} height={80} fill="var(--color-pitch-stripe)" />
        ))}
        <PitchLines />
        {sorted.map((s) => {
          const home = s.team_id === homeId
          const x = home ? s.x! : 120 - s.x!
          const y = home ? s.y! : 80 - s.y!
          const goal = s.outcome === 'Goal'
          const isActive = active === s.id
          const kit = home ? 'var(--kit-you, var(--color-sky))' : 'var(--kit-them, var(--color-vermilion))'
          const r = radius(s.xg)
          // Goal or miss never depends on colour alone: goals are solid with a heavy
          // ink ring and a centre dot, misses are open rings. Every shot keeps a thin
          // ink outline so light kits (England's white) still read on grass.
          return (
            <g
              key={s.id}
              transform={`translate(${x} ${y})`}
              onPointerEnter={compact ? undefined : () => setActive(s.id)}
              style={{ cursor: compact ? 'default' : 'pointer' }}
            >
              <title>{`${s.minute + 1}' ${s.player_name ?? ''}, xG ${(s.xg ?? 0).toFixed(2)}, ${s.outcome ?? ''}`}</title>
              {goal ? (
                <>
                  <circle r={r} fill={kit} stroke="var(--color-ink)" strokeWidth={0.9} />
                  <circle r={0.7} fill="var(--color-ink)" />
                </>
              ) : (
                <>
                  <circle r={r} fill="var(--color-paper)" fillOpacity={0.85} stroke="var(--color-ink)" strokeWidth={isActive ? 0.6 : 0.25} />
                  <circle r={Math.max(0.4, r - 0.6)} fill="none" stroke={kit} strokeWidth={0.9} />
                </>
              )}
            </g>
          )
        })}
      </svg>
      {!compact && (
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t-2 border-ink px-4 py-3 text-sm">
          <p aria-live="polite" className="font-semibold">
            {current ? (
              <>
                {current.minute + 1}' {current.player_name}: {current.outcome?.toLowerCase()}, xG{' '}
                <span className="tabular-nums">{(current.xg ?? 0).toFixed(2)}</span>
              </>
            ) : (
              'Point at a shot for details.'
            )}
          </p>
          <ShotLegend homeName={homeName} awayName={awayName} />
        </div>
      )}
    </div>
  )
}

function ShotLegend({ homeName, awayName }: { homeName: string; awayName: string }) {
  const miss = (kit: string) => (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="0.8" />
      <circle cx="8" cy="8" r="5.3" fill="none" stroke={kit} strokeWidth="2.4" />
    </svg>
  )
  const goal = (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.6" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="2" />
      <circle cx="8" cy="8" r="1.8" fill="var(--color-ink)" />
    </svg>
  )
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ink-soft">
      <li className="flex items-center gap-1.5">{miss('var(--kit-you, var(--color-sky))')}{homeName} shot</li>
      <li className="flex items-center gap-1.5">{miss('var(--kit-them, var(--color-vermilion))')}{awayName} shot</li>
      <li className="flex items-center gap-1.5">{goal}Goal (filled in team colour)</li>
    </ul>
  )
}
