import type { SnapshotPlayer } from '../lib/types'
import { PitchLines } from './PitchLines'

/** Static full-pitch thumbnail: home side as circles attacking right, away as squares. */
export function MiniPitch({ home, away, label }: { home: SnapshotPlayer[]; away: SnapshotPlayer[]; label: string }) {
  return (
    <svg viewBox="-1 -1 122 82" className="block h-auto w-full" role="img" aria-label={label}>
      <rect x={-1} y={-1} width={122} height={82} fill="var(--color-pitch)" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={i * 20 + 10} y={0} width={10} height={80} fill="var(--color-pitch-stripe)" />
      ))}
      <PitchLines />
      {home.map((p) => (
        <circle key={p.id} cx={p.x} cy={p.y} r={2.6} fill="var(--kit-you, var(--color-sky))" stroke="var(--color-ink)" strokeWidth={0.5} />
      ))}
      {away.map((p) => (
        <rect
          key={p.id}
          x={120 - p.x - 2.3}
          y={80 - p.y - 2.3}
          width={4.6}
          height={4.6}
          rx={1}
          fill="var(--kit-them, var(--color-vermilion))"
          stroke="var(--color-ink)"
          strokeWidth={0.5}
        />
      ))}
    </svg>
  )
}
