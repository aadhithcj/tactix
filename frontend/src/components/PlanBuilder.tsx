import { profileFromText, type Profile } from '../lib/model'
import type { PlanDials } from '../lib/types'

export type Dials = Omit<PlanDials, 'source'>
type DialKey = keyof Dials

/**
 * Each row is one of the model's dials; each chip is a setting of it. What
 * you pick is exactly what the match engine uses: nothing reads your words.
 */
const ROWS: { key: DialKey; label: string; options: [string, number][] }[] = [
  { key: 'depth', label: 'Your defensive line', options: [['Deep', 0.15], ['Middle', 0.5], ['High', 0.85]] },
  { key: 'press', label: 'Without the ball', options: [['Sit off', 0.2], ['Mixed', 0.45], ['Press', 0.85]] },
  { key: 'direct', label: 'With the ball', options: [['Patient', 0.1], ['Mixed', 0.4], ['Direct', 0.85]] },
  { key: 'width', label: 'Attack through', options: [['The middle', 0.2], ['Both', 0.5], ['The wings', 0.9]] },
  { key: 'attack', label: 'Bodies forward', options: [['Few', 0.2], ['Some', 0.45], ['Many', 0.75]] },
  { key: 'marking', label: 'Their danger man', options: [['Leave him', 0.3], ['Mark him', 1]] },
]

const nearest = (options: [string, number][], v: number) =>
  options.reduce((best, o) => (Math.abs(o[1] - v) < Math.abs(best[1] - v) ? o : best))

/** Snap any dials (say, read from a note) onto the chips. */
export function snapDials(p: Pick<Profile, DialKey>): Dials {
  const out = {} as Dials
  for (const row of ROWS) out[row.key] = nearest(row.options, p[row.key])[1]
  return out
}

/** Dials from the note's keywords, for the rows the manager hasn't set by hand. */
export function dialsFromNote(note: string, current: Dials, touched: Set<DialKey>): Dials {
  const read = snapDials(profileFromText(note))
  const out = { ...current }
  for (const row of ROWS) if (!touched.has(row.key)) out[row.key] = read[row.key]
  return out
}

export function PlanBuilder({
  dials,
  onChange,
  threatName,
}: {
  dials: Dials
  onChange: (key: DialKey, value: number) => void
  threatName?: string
}) {
  return (
    <div className="grid gap-2.5">
      {ROWS.map((row) => {
        const picked = nearest(row.options, dials[row.key])[1]
        const label = row.key === 'marking' && threatName ? threatName : row.label
        return (
          <div key={row.key} role="radiogroup" aria-label={label} className="grid gap-1">
            <span className="text-sm font-[750]">{label}</span>
            <div className="flex overflow-hidden rounded-full border-2 border-ink">
              {row.options.map(([name, value]) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={picked === value}
                  onClick={() => onChange(row.key, value)}
                  className={`min-h-9 flex-1 px-2 text-sm font-[750] not-first:border-l-2 not-first:border-ink ${picked === value ? 'bg-ink text-cream' : 'bg-paper hover:bg-cream-deep'}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
