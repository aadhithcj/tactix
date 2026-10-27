/**
 * What really happened after the frozen minute, rebuilt from StatsBomb events
 * for the chalkboard replay. Only the ball is known (no player tracking in the
 * open data), so the replay follows the ball: every pass, carry and shot.
 *
 * StatsBomb puts each event in its own team's frame (attacking towards x=120);
 * everything here is turned into the user's frame, like the live match.
 */
import { PITCH_X, PITCH_Y } from './model'
import type { MatchEvent, ScenarioDetail } from './types'

export type Side = 'you' | 'them'

export interface ReplayMove {
  /** Playback time in seconds from the start of the replay. */
  p: number
  /** When the ball arrives at the end. */
  p2: number
  /** Match clock, seconds. */
  clock: number
  team: Side
  kind: 'pass' | 'shot' | 'touch'
  x: number
  y: number
  x2: number
  y2: number
  player: string | null
  goal?: boolean
  xg?: number | null
}

export interface ReplayGoal {
  p: number
  clock: number
  team: Side
  player: string
}

export interface Replay {
  moves: ReplayMove[]
  goals: ReplayGoal[]
  /** Playback length in seconds. */
  length: number
  startClock: number
  /** Score at the frozen minute, from the user's side. */
  startScore: { you: number; them: number }
  /** A note about what came after normal time, if anything. */
  afterwards: string | null
}

/** Event types that say where the ball was. */
export const REPLAY_TYPES = ['Pass', 'Shot', 'Ball Recovery', 'Interception', 'Clearance', 'Dribble', 'Block', 'Duel', 'Foul Won']

const HALF_TIME_GAP = 3
const FLIGHT = { pass: 1.1, shot: 0.7 }

export function buildReplay(detail: ScenarioDetail, teamId: number, events: MatchEvent[]): Replay {
  const snap = detail.snapshot
  const side = snap.sides[String(teamId)]
  const opp = Object.values(snap.sides).find((s) => s.team_id !== teamId)!
  const startClock = snap.minute * 60 + (snap.second ?? 0)
  const startPeriod = snap.minute < 45 ? 1 : 2
  const endClock = snap.full_time_minute * 60 + 59

  const frame = (team: Side, x: number, y: number) => (team === 'you' ? { x, y } : { x: PITCH_X - x, y: PITCH_Y - y })

  const kept = events
    .filter((e) => e.x !== null && e.y !== null && (e.period ?? 1) <= 2)
    .map((e) => ({ e, clock: e.minute * 60 + e.second, period: e.period ?? 1 }))
    .filter(({ clock, period }) => period > startPeriod || (period === startPeriod && clock >= startClock))
    .filter(({ clock, period }) => period < 2 || clock <= endClock)
    .sort((a, b) => a.period - b.period || a.clock - b.clock)

  const moves: ReplayMove[] = []
  let p = 0
  let prev = { clock: startClock, period: startPeriod }
  for (const { e, clock, period } of kept) {
    p += period !== prev.period ? HALF_TIME_GAP : Math.max(0, clock - prev.clock)
    prev = { clock, period }
    const team: Side = e.team_id === teamId ? 'you' : 'them'
    const from = frame(team, e.x!, e.y!)
    const kind = e.event_type === 'Pass' ? 'pass' : e.event_type === 'Shot' ? 'shot' : 'touch'
    const to = kind !== 'touch' && e.end_x !== null && e.end_y !== null ? frame(team, e.end_x, e.end_y) : from
    moves.push({
      p,
      p2: p + (kind === 'touch' ? 0 : FLIGHT[kind]),
      clock,
      team,
      kind,
      ...{ x: from.x, y: from.y, x2: to.x, y2: to.y },
      player: e.player_name,
      goal: kind === 'shot' && e.outcome === 'Goal',
      xg: e.xg,
    })
  }
  // Play on a little past the last event.
  const length = (moves.at(-1)?.p2 ?? 0) + 2

  // Goals in normal time, matched to their shot where there is one (own goals have none).
  const names: Record<string, Side> = { [side.name]: 'you', [opp.name]: 'them' }
  const goals: ReplayGoal[] = []
  for (const g of snap.actual.goals_after) {
    if (g.period > 2) continue
    const team = names[g.team]
    if (!team) continue
    const shot = moves.find((m) => m.goal && m.team === team && Math.abs(Math.floor(m.clock / 60) + 1 - g.minute) <= 1 && !goals.some((x) => x.p === m.p2))
    const clock = shot ? shot.clock : (g.minute - 1) * 60 + 30
    const at = shot ? shot.p2 : (moves.find((m) => m.clock >= clock)?.p ?? length)
    goals.push({ p: at, clock, team, player: g.player })
  }
  goals.sort((a, b) => a.p - b.p)

  const isHome = side.is_home
  const startScore = { you: isHome ? snap.score.home : snap.score.away, them: isHome ? snap.score.away : snap.score.home }
  const a = snap.actual
  let afterwards: string | null = null
  if (a.shootout) {
    const [w] = Object.entries(a.shootout).sort((x, y) => y[1] - x[1])
    afterwards = `Then extra time, and ${w[0]} won on penalties.`
  } else if (a.went_to_extra_time) afterwards = 'Then extra time.'

  return { moves, goals, length, startClock, startScore, afterwards }
}

/** The move in progress at playback time p, and where the ball is. */
export function ballAt(replay: Replay, p: number) {
  const moves = replay.moves
  if (!moves.length) return { x: PITCH_X / 2, y: PITCH_Y / 2, index: -1 }
  // Binary search for the last move started by p.
  let lo = 0
  let hi = moves.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (moves[mid].p <= p) lo = mid
    else hi = mid - 1
  }
  const m = moves[lo]
  if (p < m.p) return { x: m.x, y: m.y, index: -1 }
  if (p <= m.p2) {
    const k = m.p2 === m.p ? 1 : (p - m.p) / (m.p2 - m.p)
    const ease = k * (2 - k)
    return { x: m.x + (m.x2 - m.x) * ease, y: m.y + (m.y2 - m.y) * ease, index: lo }
  }
  // Between events the ball is carried to where the next one happens.
  const next = moves[lo + 1]
  if (!next) return { x: m.x2, y: m.y2, index: lo }
  const k = Math.min(1, (p - m.p2) / Math.max(0.01, next.p - m.p2))
  return { x: m.x2 + (next.x - m.x2) * k, y: m.y2 + (next.y - m.y2) * k, index: lo }
}

export function clockAt(replay: Replay, p: number) {
  const { index } = ballAt(replay, p)
  if (index < 0) return replay.startClock
  const m = replay.moves[index]
  const next = replay.moves[index + 1]
  // Tick through the gap so the clock never sits still for long.
  if (!next || next.clock < m.clock) return m.clock
  const k = Math.min(1, (p - m.p) / Math.max(0.01, next.p - m.p))
  return Math.floor(m.clock + (next.clock - m.clock) * k)
}

export function scoreAt(replay: Replay, p: number) {
  const s = { ...replay.startScore }
  for (const g of replay.goals) if (g.p <= p) s[g.team] += 1
  return s
}
