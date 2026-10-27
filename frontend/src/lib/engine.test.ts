import { describe, expect, it } from 'vitest'
import lusail from '../data/fixtures/scenario-lusail-2022-71.json'
import { LiveEngine } from './engine'
import { simulateLocally } from './model'
import type { ScenarioDetail } from './types'

const detail = lusail as unknown as ScenarioDetail
const ARG = 779
const park = { tactic: 'park_bus' as const, placements: detail.suggested_shapes[String(ARG)].park_bus, substitutions: [] }

describe('live engine', () => {
  it('replays the same match from the same seed', () => {
    const a = new LiveEngine(detail, ARG, park, 7)
    const b = new LiveEngine(detail, ARG, park, 7)
    a.runToEnd()
    b.runToEnd()
    expect(a.events).toEqual(b.events)
    expect(a.done).toBe(true)
    expect(a.events.at(-1)?.kind).toBe('fulltime')
  })

  it('plays to the real full-time minute', () => {
    const e = new LiveEngine(detail, ARG, park, 1)
    e.runToEnd()
    expect(e.summary().minutes).toBe(detail.snapshot.horizon_minutes)
  })

  it('creates the expected goals the model predicts, before any goal changes the game', () => {
    const instant = simulateLocally('lusail-2022-71', detail, { team_id: ARG, ...park })
    const e = new LiveEngine(detail, ARG, park, 3)
    e.runToEnd()
    const s = e.summary()
    // Close to the instant projection; goals in the run shift the score effects.
    expect(s.xg_against).toBeGreaterThan(instant.projection.xg_against * 0.6)
    expect(s.xg_against).toBeLessThan(instant.projection.xg_against * 1.6)
  })

  it('scores about as often as the expected goals say', () => {
    let goals = 0
    let xg = 0
    const runs = 400
    for (let seed = 1; seed <= runs; seed++) {
      const e = new LiveEngine(detail, ARG, park, seed)
      e.runToEnd()
      const s = e.summary()
      goals += s.final_score.for - s.start_score.for + s.final_score.against - s.start_score.against
      xg += s.xg_for + s.xg_against
    }
    expect(goals / runs).toBeGreaterThan((xg / runs) * 0.75)
    expect(goals / runs).toBeLessThan((xg / runs) * 1.25)
  })

  it('logs a tactical change and keeps playing', () => {
    const e = new LiveEngine(detail, ARG, park, 5)
    e.advance(300)
    e.setSetup({ ...park, tactic: 'high_press', placements: detail.suggested_shapes[String(ARG)].high_press }, 'Switched to a high press')
    e.runToEnd()
    expect(e.summary().changes).toEqual([{ minute: 77, label: 'Switched to a high press' }])
    expect(e.events.some((ev) => ev.kind === 'change')).toBe(true)
  })

  it('keeps everyone on the pitch', () => {
    const e = new LiveEngine(detail, ARG, park, 9)
    for (let i = 0; i < 200; i++) {
      e.advance(8)
      const f = e.frame()
      for (const p of [...f.you, ...f.them, f.ball]) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(120)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(80)
      }
    }
  })
})

describe('touchline calls', () => {
  it('stops the clock for a call and resumes after an answer', () => {
    let seen = 0
    for (let seed = 1; seed <= 40; seed++) {
      const e = new LiveEngine(detail, ARG, park, seed)
      while (!e.done) {
        e.advance(30)
        if (e.pending) {
          seen++
          const t = e.t
          e.advance(60)
          expect(e.t).toBe(t)
          expect(e.pending.options.length).toBeGreaterThanOrEqual(2)
          expect(e.pending.options.some((o) => !o.tactic && !o.sub)).toBe(true)
          e.answer('hold')
        }
      }
      expect(e.summary().minutes).toBe(detail.snapshot.horizon_minutes)
    }
    expect(seen).toBeGreaterThan(10)
  })

  it('offers subs that are really available', () => {
    const side = detail.snapshot.sides[String(ARG)]
    for (let seed = 1; seed <= 40; seed++) {
      const e = new LiveEngine(detail, ARG, park, seed)
      while (!e.done) {
        e.advance(30)
        const sub = e.pending?.options.find((o) => o.sub)?.sub
        if (sub) {
          expect(e.players.some((p) => p.id === sub.off_id)).toBe(true)
          expect(side.bench.some((b) => b.id === sub.on_id)).toBe(true)
        }
        if (e.pending) e.answer('hold')
      }
    }
  })

  it('skipping answers every call and still finishes', () => {
    const e = new LiveEngine(detail, ARG, park, 4)
    e.runToEnd()
    expect(e.done).toBe(true)
    expect(e.pending).toBeNull()
  })
})
