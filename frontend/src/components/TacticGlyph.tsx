import type { CSSProperties } from 'react'
import type { TacticKey } from '../lib/types'

export const TACTICS: { key: TacticKey; title: string; blurb: string }[] = [
  { key: 'park_bus', title: 'Park the bus', blurb: 'Drop deep, stay narrow, protect the goal.' },
  { key: 'high_press', title: 'High press', blurb: 'Push up and hunt the ball in their half.' },
  { key: 'mark_threat', title: 'Mark the threat', blurb: 'Put a man on their most dangerous player.' },
  { key: 'counter', title: 'Counter-attack', blurb: 'Sit in, win it, and break fast into the space.' },
  { key: 'false_nine', title: 'False 9', blurb: 'Your striker drops deep to drag their centre-backs out.' },
  { key: 'tiki_taka', title: 'Tiki-taka', blurb: 'Keep the ball. Short passes, patience, control.' },
  { key: 'wing_play', title: 'Wing play', blurb: 'Stretch them wide and get crosses into the box.' },
  { key: 'custom', title: 'Build your own', blurb: 'Set every dial yourself, then shape the team.' },
]

/** Small chalkboard diagram of each plan, drawn in the same frame as the pitch. */
export function TacticGlyph({ tactic, threat = 'their danger man' }: { tactic: TacticKey; threat?: string }) {
  const you = (x: number, y: number, k: string) => (
    <circle key={k} cx={x} cy={y} r={3.6} fill="var(--kit-you, var(--color-sky))" stroke="var(--color-ink)" strokeWidth={1.2} />
  )
  const them = (x: number, y: number, k: string) => (
    <circle key={k} cx={x} cy={y} r={3.6} fill="var(--kit-them, var(--color-vermilion))" stroke="var(--color-ink)" strokeWidth={1.2} />
  )
  return (
    <svg viewBox="0 0 72 48" className="h-12 w-[4.5rem] shrink-0 rounded-md border-2 border-ink" role="img" aria-label={tacticAlt(tactic, threat)}>
      <rect width="72" height="48" fill="var(--color-pitch)" />
      <g fill="none" stroke="var(--color-chalk)" strokeWidth={1}>
        <line x1="36" y1="0" x2="36" y2="48" />
        <rect x="0" y="13" width="10" height="22" />
        <rect x="62" y="13" width="10" height="22" />
      </g>
      {tactic === 'park_bus' && (
        <g className="tx-glyph-move" style={{ '--gx': '-5px' } as CSSProperties}>
          {[6, 14, 22, 30, 38, 42].map((y, i) => you(i % 2 ? 19 : 14, y, `p${i}`))}
        </g>
      )}
      {tactic === 'high_press' && (
        <>
          <g className="tx-glyph-move" style={{ '--gx': '7px' } as CSSProperties}>
            <g stroke="var(--color-ink)" strokeWidth={1.4} strokeLinecap="round" fill="none">
              <path d="M34 12 L46 12 M43 9 L46 12 L43 15" />
              <path d="M34 36 L46 36 M43 33 L46 36 L43 39" />
              <path d="M40 24 L54 24 M51 21 L54 24 L51 27" />
            </g>
            {[you(30, 12, 'a'), you(30, 36, 'b'), you(36, 24, 'c')]}
          </g>
          {[them(60, 18, 'd'), them(60, 32, 'e')]}
        </>
      )}
      {tactic === 'mark_threat' && (
        <>
          <circle cx="40" cy="24" r="9" fill="none" stroke="var(--color-ink)" strokeWidth={1.2} strokeDasharray="2.4 1.8" />
          {them(42, 24, 't')}
          <g className="tx-glyph-move" style={{ '--gx': '8px', '--gy': '-5px' } as CSSProperties}>
            {you(28, 31, 'm')}
          </g>
          {[you(18, 12, 'x'), you(18, 36, 'y')]}
        </>
      )}
      {tactic === 'counter' && (
        <>
          {[you(14, 14, 'a'), you(14, 34, 'b'), you(20, 24, 'c')]}
          <g className="tx-glyph-move" style={{ '--gx': '6px' } as CSSProperties}>
            <path d="M24 24 L56 24 M52 20 L56 24 L52 28" stroke="var(--color-ink)" strokeWidth={1.4} strokeLinecap="round" fill="none" strokeDasharray="3 2" />
            {you(48, 18, 'f')}
          </g>
          {[them(40, 10, 'd'), them(40, 38, 'e')]}
        </>
      )}
      {tactic === 'false_nine' && (
        <>
          {[you(52, 8, 'l'), you(52, 40, 'r')]}
          {[them(60, 18, 'c1'), them(60, 30, 'c2')]}
          <g className="tx-glyph-move" style={{ '--gx': '-10px' } as CSSProperties}>
            <path d="M48 24 L38 24 M41 21 L38 24 L41 27" stroke="var(--color-ink)" strokeWidth={1.4} strokeLinecap="round" fill="none" />
            {you(52, 24, 'n')}
          </g>
        </>
      )}
      {tactic === 'tiki_taka' && (
        <>
          <path d="M24 14 L34 32 L44 14 Z M44 14 L52 30 L34 32" stroke="var(--color-ink)" strokeWidth={1.1} fill="none" strokeDasharray="2 1.6" />
          {[you(24, 14, 'a'), you(34, 32, 'b'), you(44, 14, 'c')]}
          <g className="tx-glyph-move" style={{ '--gx': '4px', '--gy': '-3px' } as CSSProperties}>
            {you(52, 30, 'd')}
          </g>
        </>
      )}
      {tactic === 'wing_play' && (
        <>
          <g className="tx-glyph-move" style={{ '--gy': '-3px' } as CSSProperties}>
            {you(46, 8, 'l')}
          </g>
          <g className="tx-glyph-move" style={{ '--gy': '3px' } as CSSProperties}>
            {you(46, 40, 'r')}
          </g>
          <path d="M48 40 C58 38, 60 30, 58 24" stroke="var(--color-ink)" strokeWidth={1.4} strokeLinecap="round" fill="none" strokeDasharray="2.4 1.8" />
          {[you(56, 22, 's')]}
        </>
      )}
      {tactic === 'custom' && (
        <g stroke="var(--color-ink)" strokeWidth={1.4} fill="none" strokeLinecap="round">
          <path d="M14 34 C24 10, 34 40, 46 18 S 58 20, 60 14" strokeDasharray="0.1 3.4" strokeWidth={2.2} />
          <g className="tx-glyph-move" style={{ '--gx': '6px', '--gy': '-4px' } as CSSProperties}>
            {you(14, 34, 'c1')}
          </g>
          <path d="M57 11 L61 15" />
        </g>
      )}
    </svg>
  )
}

function tacticAlt(t: TacticKey, threat: string) {
  switch (t) {
    case 'park_bus':
      return 'Diagram: two compact banks of players in front of your own goal'
    case 'high_press':
      return 'Diagram: players pushing forward towards the opponents'
    case 'mark_threat':
      return `Diagram: a defender tight on ${threat}`
    case 'counter':
      return 'Diagram: a deep defence and one runner breaking forward'
    case 'false_nine':
      return 'Diagram: the centre-forward dropping back between the lines'
    case 'tiki_taka':
      return 'Diagram: a triangle of short passes'
    case 'wing_play':
      return 'Diagram: wingers wide on the touchlines, crossing into the box'
    case 'custom':
      return 'Diagram: a hand-drawn route for your own plan'
    default:
      return 'Diagram: a hand-drawn route for your own plan'
  }
}
