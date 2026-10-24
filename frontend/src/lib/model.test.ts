import { describe, expect, it } from 'vitest'
import lusail from '../data/fixtures/scenario-lusail-2022-71.json'
import { simulateLocally, threatCoverage } from './model'
import type { ScenarioDetail } from './types'

const detail = lusail as unknown as ScenarioDetail
const ARG = 779
const MESSI = 5503
const MONTIEL = 28263

describe('offline model', () => {
  it('matches the server for the same decision', () => {
    // Reference values from POST /api/scenarios/lusail-2022-71/simulate.
    const placements = detail.suggested_shapes[String(ARG)].park_bus.map((p) =>
      p.player_id === MESSI ? { ...p, player_id: MONTIEL } : p,
    )
    const result = simulateLocally('lusail-2022-71', detail, {
      team_id: ARG,
      tactic: 'park_bus',
      placements,
      substitutions: [{ off_id: MESSI, on_id: MONTIEL }],
    })
    expect(result.gaffer_rating).toBe(8.6)
    expect(result.structure_fit).toBeCloseTo(0.98, 2)
    expect(result.projection).toMatchObject({
      minutes: 27,
      xg_for: 0.2,
      xg_against: 0.15,
      baseline_xg_for: 0.38,
      baseline_xg_against: 0.36,
      likely_score: { home: 2, away: 0 },
    })
  })

  it('rewards covering the ground the opponent actually attacked', () => {
    const side = detail.snapshot.sides[String(ARG)]
    const real = threatCoverage(side.players, side.threat_grid).coverage
    const huddled = side.players.map((p) => ({ ...p, x: 110, y: 40 }))
    expect(threatCoverage(huddled, side.threat_grid).coverage).toBeLessThan(real)
  })

  it('reads keywords in a custom plan', () => {
    const base = { team_id: ARG, placements: [], substitutions: [] }
    const deep = simulateLocally('lusail-2022-71', detail, { ...base, tactic: 'custom', custom_plan: 'sit deep and defend' })
    const press = simulateLocally('lusail-2022-71', detail, { ...base, tactic: 'custom', custom_plan: 'press high and push up' })
    expect(deep.profile.depth).toBeLessThan(press.profile.depth)
    expect(deep.projection.xg_against).toBeLessThan(press.projection.xg_against)
  })
})
