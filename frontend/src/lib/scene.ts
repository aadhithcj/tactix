/**
 * Display logic for the home scene. Nothing here touches the data the engine
 * receives: positions are only nudged for drawing.
 */
import { shortName } from './names'
import type { ScenarioDetail, ShapePoint, Side, TacticKey } from './types'

/** The home pitch shows the managed side's defensive half plus the centre circle. */
export const CROP_X = 72

export interface SceneToken {
  id: number
  number: number | null
  name: string
  position: string | null
  side: 'you' | 'them'
  /** Team-frame coordinates, as the engine sees them. */
  x: number
  y: number
  /** Drawing coordinates after the collision pass. */
  dx: number
  dy: number
  r: number
  hero?: boolean
  label?: boolean
  /** Label offset in screen units (upright frame) and its text anchor. */
  labelAt?: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
}

const R_TOKEN = 2.3
const R_HERO = 3.1
const GAP = 0.9

/**
 * Deterministic display-only collision pass: push overlapping tokens apart in
 * a few fixed iterations. Input order is stable, so output is stable.
 */
export function spread(tokens: SceneToken[], iterations = 14): SceneToken[] {
  const out = tokens.map((t) => ({ ...t, dx: t.x, dy: t.y }))
  for (let it = 0; it < iterations; it++) {
    let moved = false
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        // The key threat keeps room for its ring.
        const min = a.r + b.r + (a.hero || b.hero ? GAP + 2.2 : GAP)
        let vx = b.dx - a.dx
        let vy = b.dy - a.dy
        let d = Math.hypot(vx, vy)
        if (d >= min) continue
        if (d < 0.01) {
          // Identical spots: separate along a fixed direction.
          vx = 0
          vy = 1
          d = 1
        }
        const push = (min - d) / 2
        // The hero holds its ground; everyone else makes room.
        const wa = a.hero ? 0 : b.hero ? 2 : 1
        const wb = b.hero ? 0 : a.hero ? 2 : 1
        a.dx -= (vx / d) * push * wa
        a.dy -= (vy / d) * push * wa
        b.dx += (vx / d) * push * wb
        b.dy += (vy / d) * push * wb
        moved = true
      }
    }
    for (const t of out) {
      t.dx = Math.max(t.r, Math.min(119, t.dx))
      t.dy = Math.max(t.r + 0.5, Math.min(80 - t.r - 0.5, t.dy))
    }
    if (!moved) break
  }
  return out
}

/**
 * Preview rule per tactic. Positions come from the API's suggested_shapes,
 * which the backend derives from the real shape (simulation.suggest_shape):
 * - park_bus: back line to ~21 yd from goal, lines ~34 yd apart, 10% narrower.
 * - high_press: back line to ~45 yd, front line pushed up, full width.
 * - mark_threat: mid block; the nearest defender or midfielder goes goal-side
 *   of the key threat, 3 yd away.
 * - custom: no automatic move; the user describes the plan.
 * These are the same positions the game starts from after "Lock it in".
 */
export function previewShape(detail: ScenarioDetail, teamId: number, tactic: TacticKey | null): Map<number, ShapePoint> | null {
  if (!tactic || tactic === 'custom') return null
  const shape = detail.suggested_shapes[String(teamId)]?.[tactic]
  return shape ? new Map(shape.map((p) => [p.player_id, p])) : null
}

/** The players worth naming: their key threat and your two nearest to him. */
export function labelledIds(side: Side): Set<number> {
  const ids = new Set<number>()
  const key = side.key_threat
  if (!key) return ids
  ids.add(key.player_id)
  const nearest = side.players
    .filter((p) => p.role !== 'GK')
    .map((p) => ({ id: p.id, d: Math.hypot(p.x - key.x, p.y - key.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
  nearest.forEach((n) => ids.add(n.id))
  return ids
}

export function buildScene(detail: ScenarioDetail, teamId: number, tactic: TacticKey | null) {
  const side = detail.snapshot.sides[String(teamId)]
  const opp = Object.values(detail.snapshot.sides).find((s) => s.team_id !== teamId)!
  const preview = previewShape(detail, teamId, tactic)
  const labels = labelledIds(side)
  const keyId = side.key_threat?.player_id

  const yours: SceneToken[] = side.players.map((p) => {
    const at = preview?.get(p.id) ?? p
    return {
      id: p.id,
      number: p.number,
      name: p.name,
      position: p.position,
      side: 'you',
      x: at.x,
      y: at.y,
      dx: at.x,
      dy: at.y,
      r: R_TOKEN,
      label: labels.has(p.id),
    }
  })
  const theirs: SceneToken[] = opp.players.map((p) => ({
    id: p.id,
    number: p.number,
    name: p.name,
    position: p.position,
    side: 'them',
    // Mirror into your frame.
    x: 120 - p.x,
    y: 80 - p.y,
    dx: 120 - p.x,
    dy: 80 - p.y,
    r: p.id === keyId ? R_HERO : R_TOKEN,
    hero: p.id === keyId,
    label: p.id === keyId,
  }))

  const all = spread([...theirs.filter((t) => t.hero), ...yours, ...theirs.filter((t) => !t.hero)])
  const inCrop = all.filter((t) => t.x <= CROP_X)
  const beyond = all.filter((t) => t.x > CROP_X)
  const hero = all.find((t) => t.hero) ?? null

  let marker: SceneToken | null = null
  if (tactic === 'mark_threat' && hero) {
    marker = inCrop
      .filter((t) => t.side === 'you')
      .reduce<SceneToken | null>((best, t) => {
        const d = Math.hypot(t.dx - hero.dx, t.dy - hero.dy)
        return !best || d < Math.hypot(best.dx - hero.dx, best.dy - hero.dy) ? t : best
      }, null)
  }

  placeLabels(inCrop)
  return { side, opp, tokens: inCrop, beyond, hero, marker }
}

/**
 * Put each label where it collides with nothing: above, below, right or left
 * of its token, in screen space (the home pitch is drawn portrait).
 */
function placeLabels(tokens: SceneToken[]) {
  const screen = (t: SceneToken) => ({ sx: t.dy, sy: CROP_X - t.dx })
  const discs = tokens.map((t) => ({ ...screen(t), r: t.hero ? t.r + 1.8 : t.r + 0.3 }))
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = []
  const order = [...tokens].filter((t) => t.label).sort((a, b) => Number(Boolean(b.hero)) - Number(Boolean(a.hero)))
  for (const t of order) {
    const { sx, sy } = screen(t)
    const charW = t.hero ? 1.5 : 1.15
    const h = t.hero ? 2.8 : 2.2
    const w = shortName(t.name).length * charW + 1.2
    const ring = t.hero ? t.r + 1.8 : t.r
    const options = [
      { x: 0, y: -(ring + 1.1), anchor: 'middle' as const },
      { x: 0, y: ring + h + 0.4, anchor: 'middle' as const },
      { x: ring + 0.9, y: h * 0.35, anchor: 'start' as const },
      { x: -(ring + 0.9), y: h * 0.35, anchor: 'end' as const },
      { x: ring * 0.6, y: -(ring * 0.75), anchor: 'start' as const },
      { x: -ring * 0.6, y: -(ring * 0.75), anchor: 'end' as const },
      { x: ring * 0.6, y: ring * 0.75 + h, anchor: 'start' as const },
      { x: -ring * 0.6, y: ring * 0.75 + h, anchor: 'end' as const },
    ]
    const boxFor = (o: (typeof options)[number]) => {
      const left = o.anchor === 'middle' ? sx + o.x - w / 2 : o.anchor === 'start' ? sx + o.x : sx + o.x - w
      return { x0: left, x1: left + w, y0: sy + o.y - h, y1: sy + o.y + 0.4 }
    }
    // Count what a label would cover; take the first clear spot, else the least crowded.
    const hits = (b: { x0: number; x1: number; y0: number; y1: number }) =>
      (b.x0 > -1 && b.x1 < 81 && b.y0 > -1 ? 0 : 5) +
      discs.filter((d) => {
        if (Math.abs(d.sx - sx) < 0.01 && Math.abs(d.sy - sy) < 0.01) return false
        const cx = Math.max(b.x0, Math.min(d.sx, b.x1))
        const cy = Math.max(b.y0, Math.min(d.sy, b.y1))
        return Math.hypot(cx - d.sx, cy - d.sy) <= d.r
      }).length +
      boxes.filter((o) => !(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1)).length * 2
    const scored = options.map((o) => ({ o, n: hits(boxFor(o)) }))
    const pick = (scored.find((c) => c.n === 0) ?? scored.reduce((a, c) => (c.n < a.n ? c : a))).o
    const box = boxFor(pick)
    boxes.push(box)
    t.labelAt = pick
    // The threat's name always reads: slide any other token out from under it.
    if (t.hero) {
      for (const o of tokens) {
        if (o === t) continue
        const p = screen(o)
        const cx = Math.max(box.x0, Math.min(p.sx, box.x1))
        const cy = Math.max(box.y0, Math.min(p.sy, box.y1))
        if (Math.hypot(cx - p.sx, cy - p.sy) > o.r + 0.3) continue
        // Smallest move out of the box: sideways or vertically, whichever is shorter.
        const moves = [
          { sx: box.x0 - o.r - 0.4, sy: p.sy },
          { sx: box.x1 + o.r + 0.4, sy: p.sy },
          { sx: p.sx, sy: box.y0 - o.r - 0.4 },
          { sx: p.sx, sy: box.y1 + o.r + 0.4 },
        ].sort((m1, m2) => Math.hypot(m1.sx - p.sx, m1.sy - p.sy) - Math.hypot(m2.sx - p.sx, m2.sy - p.sy))
        o.dy = moves[0].sx
        o.dx = CROP_X - moves[0].sy
        const d = discs[tokens.indexOf(o)]
        d.sx = moves[0].sx
        d.sy = moves[0].sy
      }
    }
  }
}

/** Plain-language position from your end of the pitch. */
export function whereInWords(x: number, y: number): string {
  const lane = y >= 62 ? 'right wing' : y >= 48 ? 'right of centre' : y > 32 ? 'centre' : y > 18 ? 'left of centre' : 'left wing'
  const depth =
    x < 18 ? 'in your penalty area' : x < 36 ? 'near your box' : x < 60 ? 'in your half' : x < 84 ? 'around halfway' : 'in their half'
  return `${lane}, ${depth}`
}
