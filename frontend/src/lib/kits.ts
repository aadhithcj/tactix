import type { CSSProperties } from 'react'

/**
 * Kit colours per team: the shirt (fill) and the number printed on it (ink),
 * plus a change kit for when two teams would look alike on the pitch.
 * Sides are also told apart by token shape, so colour is never the only cue.
 */
export interface Kit {
  fill: string
  ink: string
}

interface TeamKit {
  code: string
  home: Kit
  away?: Kit
}

const WHITE: Kit = { fill: '#F7F5EE', ink: '#14161F' }
const NAVY: Kit = { fill: '#1D2E6B', ink: '#FFFFFF' }
const BLACK: Kit = { fill: '#1B1C22', ink: '#FFFFFF' }

// National teams and the clubs that appear in StatsBomb's open data.
const TEAMS: Record<string, TeamKit> = {
  Argentina: { code: 'ARG', home: { fill: '#6CC4EE', ink: '#14161F' }, away: NAVY },
  France: { code: 'FRA', home: NAVY, away: WHITE },
  Croatia: { code: 'CRO', home: { fill: '#D9241C', ink: '#FFFFFF' }, away: NAVY },
  England: { code: 'ENG', home: WHITE, away: { fill: '#C8102E', ink: '#FFFFFF' } },
  Italy: { code: 'ITA', home: { fill: '#1F66C6', ink: '#FFFFFF' }, away: WHITE },
  // Spain's red is deepened slightly so the yellow numbers clear 5:1 contrast.
  Spain: { code: 'ESP', home: { fill: '#AD0F26', ink: '#FFD23F' }, away: WHITE },
  Germany: { code: 'GER', home: WHITE, away: BLACK },
  Brazil: { code: 'BRA', home: { fill: '#FEDD00', ink: '#14161F' }, away: { fill: '#1C4FA0', ink: '#FFFFFF' } },
  Netherlands: { code: 'NED', home: { fill: '#F36C21', ink: '#14161F' }, away: NAVY },
  Portugal: { code: 'POR', home: { fill: '#B5121B', ink: '#FFFFFF' }, away: WHITE },
  Belgium: { code: 'BEL', home: { fill: '#C8102E', ink: '#FFFFFF' }, away: WHITE },
  'United States': { code: 'USA', home: WHITE, away: NAVY },
  Morocco: { code: 'MAR', home: { fill: '#C1272D', ink: '#FFFFFF' }, away: WHITE },
  Japan: { code: 'JPN', home: { fill: '#1B3A8C', ink: '#FFFFFF' }, away: WHITE },

  Barcelona: { code: 'BAR', home: { fill: '#A50044', ink: '#FFFFFF' }, away: { fill: '#FFD23F', ink: '#14161F' } },
  'Real Madrid': { code: 'RMA', home: WHITE, away: BLACK },
  'Atlético Madrid': { code: 'ATM', home: { fill: '#CB3524', ink: '#FFFFFF' }, away: NAVY },
  Liverpool: { code: 'LIV', home: { fill: '#C8102E', ink: '#FFFFFF' }, away: WHITE },
  'Tottenham Hotspur': { code: 'TOT', home: { fill: '#F7F5EE', ink: '#132257' }, away: { fill: '#132257', ink: '#FFFFFF' } },
  'Manchester United': { code: 'MUN', home: { fill: '#DA291C', ink: '#FFFFFF' }, away: WHITE },
  'Manchester City': { code: 'MCI', home: { fill: '#6CABDD', ink: '#14161F' }, away: NAVY },
  Chelsea: { code: 'CHE', home: { fill: '#034694', ink: '#FFFFFF' }, away: WHITE },
  Arsenal: { code: 'ARS', home: { fill: '#E00407', ink: '#FFFFFF' }, away: { fill: '#FFD23F', ink: '#14161F' } },
  'Bayern Munich': { code: 'BAY', home: { fill: '#DC052D', ink: '#FFFFFF' }, away: WHITE },
  'Borussia Dortmund': { code: 'BVB', home: { fill: '#FDE100', ink: '#14161F' }, away: BLACK },
  'Bayer Leverkusen': { code: 'B04', home: { fill: '#D81F20', ink: '#FFFFFF' }, away: BLACK },
  Juventus: { code: 'JUV', home: BLACK, away: WHITE },
  'AC Milan': { code: 'MIL', home: { fill: '#C0161D', ink: '#FFFFFF' }, away: WHITE },
  'Inter Milan': { code: 'INT', home: { fill: '#0068A8', ink: '#FFFFFF' }, away: WHITE },
  'Paris Saint-Germain': { code: 'PSG', home: { fill: '#004170', ink: '#FFFFFF' }, away: WHITE },
  Ajax: { code: 'AJA', home: { fill: '#F7F5EE', ink: '#D2122E' }, away: NAVY },
}

const BY_CODE = new Map(Object.values(TEAMS).map((t) => [t.code, t]))

const FALLBACK_HOME: Kit = { fill: '#7CC8FF', ink: '#14161F' }
const FALLBACK_AWAY: Kit = { fill: '#FF5A36', ink: '#14161F' }

// StatsBomb names women's sides "England Women's", "Barcelona Femení" and so on.
const normalise = (team: string) => team.replace(/\s+(Women's|WFC|Femení|Women|Féminine)$/i, '').trim()

function lookup(team: string): TeamKit | undefined {
  return TEAMS[normalise(team)] ?? BY_CODE.get(team)
}

/** Three-letter code for a team name (falls back to its first three letters). */
export function codeFor(team: string): string {
  return lookup(team)?.code ?? normalise(team).slice(0, 3).toUpperCase()
}

/** The team's real home kit, or undefined when we don't have its colours. */
export function knownKit(team: string): Kit | undefined {
  return lookup(team)?.home
}

/** Home kit for a team, by name or code. */
export function kitFor(team: string, fallback: 'home' | 'away' = 'home'): Kit {
  return lookup(team)?.home ?? (fallback === 'home' ? FALLBACK_HOME : FALLBACK_AWAY)
}

function distance(a: string, b: string) {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [rgb(a), rgb(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/**
 * Kits for two teams on the same pitch. When they'd look alike, the second
 * team changes into its away kit, like a real kit clash.
 */
export function kitPair(first: string, second: string): [Kit, Kit] {
  const a = kitFor(first, 'home')
  const b = kitFor(second, 'away')
  if (distance(a.fill, b.fill) >= 90) return [a, b]
  const change = lookup(second)?.away
  if (change && distance(a.fill, change.fill) >= 90) return [a, change]
  return [a, distance(a.fill, WHITE.fill) < 200 ? BLACK : WHITE]
}

/**
 * CSS variables that pitch and chart components read:
 * --kit-you / --kit-you-ink for the side you manage (or the home side), and
 * --kit-them / --kit-them-ink for the other.
 */
export function kitVars(you: string, them: string): CSSProperties {
  const [a, b] = kitPair(you, them)
  return {
    '--kit-you': a.fill,
    '--kit-you-ink': a.ink,
    '--kit-them': b.fill,
    '--kit-them-ink': b.ink,
  } as CSSProperties
}
