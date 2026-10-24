import type { CSSProperties } from 'react'

/**
 * Kit colours per team: the shirt (fill) and the number printed on it (ink).
 * Sides are also told apart by token shape, so colour is never the only cue.
 */
export interface Kit {
  fill: string
  ink: string
}

const KITS: Record<string, Kit> = {
  ARG: { fill: '#6CC4EE', ink: '#14161F' }, // Albiceleste sky blue
  FRA: { fill: '#1D2E6B', ink: '#FFFFFF' }, // Les Bleus navy
  CRO: { fill: '#D9241C', ink: '#FFFFFF' }, // Red of the checkerboard
  ENG: { fill: '#F7F5EE', ink: '#14161F' }, // White
  ITA: { fill: '#1F66C6', ink: '#FFFFFF' }, // Azzurri
  ESP: { fill: '#AD0F26', ink: '#FFD23F' }, // La Roja, yellow numbers (deepened for 5:1 contrast)
}

const NAME_TO_CODE: Record<string, string> = {
  Argentina: 'ARG',
  France: 'FRA',
  Croatia: 'CRO',
  England: 'ENG',
  Italy: 'ITA',
  Spain: 'ESP',
}

const FALLBACK_HOME: Kit = { fill: '#7CC8FF', ink: '#14161F' }
const FALLBACK_AWAY: Kit = { fill: '#FF5A36', ink: '#14161F' }

/** Kit for a team, by FIFA-style code or full name. */
export function kitFor(team: string, fallback: 'home' | 'away' = 'home'): Kit {
  return KITS[team] ?? KITS[NAME_TO_CODE[team] ?? ''] ?? (fallback === 'home' ? FALLBACK_HOME : FALLBACK_AWAY)
}

/**
 * CSS variables that pitch and chart components read:
 * --kit-you / --kit-you-ink for the side you manage (or the home side), and
 * --kit-them / --kit-them-ink for the other.
 */
export function kitVars(you: string, them: string): CSSProperties {
  const a = kitFor(you, 'home')
  const b = kitFor(them, 'away')
  return {
    '--kit-you': a.fill,
    '--kit-you-ink': a.ink,
    '--kit-them': b.fill,
    '--kit-them-ink': b.ink,
  } as CSSProperties
}
