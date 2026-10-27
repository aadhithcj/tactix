import { describe, expect, it } from 'vitest'
import lusail from '../data/fixtures/scenario-lusail-2022-71.json'
import { ballAt, buildReplay, clockAt, scoreAt } from './replay'
import type { MatchEvent, ScenarioDetail } from './types'

const detail = lusail as unknown as ScenarioDetail
const ARG = 779
const FRA = 771

const ev = (over: Partial<MatchEvent>): MatchEvent => ({
  id: Math.random().toString(36),
  minute: 72,
  second: 0,
  period: 2,
  team_id: ARG,
  player_id: null,
  player_name: 'Someone',
  event_type: 'Pass',
  x: 30,
  y: 40,
  end_x: 50,
  end_y: 30,
  xg: null,
  outcome: null,
  play_pattern: null,
  ...over,
})

describe('real replay', () => {
  const events = [
    ev({ minute: 70, second: 0 }), // before the frozen minute: dropped
    ev({ minute: 72, second: 0 }),
    ev({ minute: 79, second: 6, team_id: FRA, x: 100, y: 20, end_x: 110, end_y: 40, event_type: 'Shot', outcome: 'Goal', player_name: 'Kylian Mbappé', xg: 0.76 }),
    ev({ minute: 75, second: 0, period: 3 }), // extra time: dropped
  ]
  const replay = buildReplay(detail, ARG, events)

  it('keeps only normal time after the frozen minute', () => {
    expect(replay.moves).toHaveLength(2)
    expect(replay.moves[0].p).toBe(0 + (72 * 60 - (71 * 60 + 27)))
  })

  it("turns the opponent's events into your frame", () => {
    const shot = replay.moves[1]
    expect(shot.team).toBe('them')
    expect(shot.x).toBe(20)
    expect(shot.x2).toBe(10)
    expect(shot.y).toBe(60)
  })

  it('moves the ball along a pass and ticks the clock', () => {
    const pass = replay.moves[0]
    const mid = ballAt(replay, (pass.p + pass.p2) / 2)
    expect(mid.x).toBeGreaterThan(30)
    expect(mid.x).toBeLessThan(50)
    expect(clockAt(replay, pass.p)).toBe(72 * 60)
  })

  it('scores the real goals at the right moment', () => {
    const shot = replay.moves[1]
    expect(scoreAt(replay, shot.p)).toEqual({ you: 2, them: 0 })
    expect(scoreAt(replay, shot.p2)).toEqual({ you: 2, them: 1 })
    // Mbappé's second (81') has no event here, so it lands where the clock reaches it.
    expect(replay.goals.map((g) => g.player)).toEqual(['Kylian Mbappé', 'Kylian Mbappé'])
    expect(replay.afterwards).toMatch(/penalties/)
  })
})
