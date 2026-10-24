/**
 * Client-side port of backend/app/services/simulation.py.
 *
 * Coverage runs live while the user drags players, so the board visibly
 * drives the evaluation. The full evaluation is the offline fallback when the
 * API is unreachable; the server version stays the source of truth.
 */
import type {
  ExposedZone,
  Finding,
  Metric,
  ScenarioDetail,
  SimulationRequest,
  SimulationResult,
  SnapshotPlayer,
  Side,
  TacticKey,
} from './types'

export const PITCH_X = 120
export const PITCH_Y = 80
const GRID_COLS = 12
const GRID_ROWS = 8
const COVER_SIGMA = 9
const MARK_SIGMA = 8
const FINAL_THIRD_X = 80

interface Profile {
  depth: number
  press: number
  marking: number
  attack: number
  label: string
}

export const PRESETS: Record<Exclude<TacticKey, 'custom'>, Profile> = {
  park_bus: { depth: 0.1, press: 0.15, marking: 0.3, attack: 0.15, label: 'Park the bus' },
  high_press: { depth: 0.85, press: 0.95, marking: 0.3, attack: 0.65, label: 'High press' },
  mark_threat: { depth: 0.45, press: 0.45, marking: 1, attack: 0.4, label: 'Mark the threat' },
}
const NEUTRAL: Profile = { depth: 0.5, press: 0.45, marking: 0.3, attack: 0.45, label: 'Custom plan' }

const KEYWORDS: [RegExp, Partial<Record<keyof Omit<Profile, 'label'>, number>>][] = [
  [/\b(park|bus|low block|deep|sit (back|deep|tight)|defend|protect|drop)\b/, { depth: -0.3, attack: -0.2, press: -0.15 }],
  [/\b(press|squeeze|high line|push (up|high)|aggressive|front foot)\b/, { depth: 0.3, press: 0.35 }],
  [/\b(mark|man[- ]?mark|shadow|follow|double[- ]?team|tight on)\b/, { marking: 0.5 }],
  [/\b(attack|all out|go for|chase|throw|more bodies|overload|winner|equali[sz]er)\b/, { attack: 0.35, depth: 0.1 }],
  [/\b(counter|break|transition|long ball|in behind)\b/, { attack: 0.15, depth: -0.15 }],
  [/\b(keep (the )?ball|possession|patient|control|rest defen[cs]e)\b/, { attack: 0.05, press: 0.05 }],
  [/\b(waste time|time[- ]?waste|slow (it|the game) down|manage)\b/, { attack: -0.15, press: -0.1 }],
]

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

function profileFromText(plan: string): Profile {
  const p = { ...NEUTRAL }
  const text = plan.toLowerCase()
  for (const [re, deltas] of KEYWORDS) {
    if (re.test(text)) {
      for (const [k, d] of Object.entries(deltas)) {
        const key = k as keyof Omit<Profile, 'label'>
        p[key] = clamp(p[key] + (d ?? 0))
      }
    }
  }
  return p
}

interface Pt {
  x: number
  y: number
  role?: string | null
}

const zoneCentres = (() => {
  const w = PITCH_X / GRID_COLS
  const h = PITCH_Y / GRID_ROWS
  const out: { r: number; c: number; x: number; y: number }[] = []
  for (let r = 0; r < GRID_ROWS; r++)
    for (let c = 0; c < GRID_COLS; c++) out.push({ r, c, x: (c + 0.5) * w, y: (r + 0.5) * h })
  return out
})()

export function zoneCover(players: Pt[], zx: number, zy: number): number {
  let miss = 1
  for (const p of players) {
    const d2 = (p.x - zx) ** 2 + (p.y - zy) ** 2
    miss *= 1 - Math.exp(-d2 / (2 * COVER_SIGMA ** 2))
  }
  return 1 - miss
}

/** Share of the opponent's real threat that the shape covers, plus per-zone openness. */
export function threatCoverage(players: Pt[], grid: number[][]) {
  const total = grid.flat().reduce((a, b) => a + b, 0) || 1
  let covered = 0
  const exposure = zoneCentres.map(({ r, c, x, y }) => {
    const threat = grid[r][c]
    const cov = zoneCover(players, x, y)
    covered += threat * cov
    return { r, c, x, y, threat: threat / total, open: (threat * (1 - cov)) / total }
  })
  return { coverage: covered / total, exposure }
}

const outfield = <T extends Pt>(ps: T[]) => ps.filter((p) => p.role !== 'GK')

export function shapeMetrics(players: Pt[], side: Side) {
  const out = outfield(players)
  const xs = out.map((p) => p.x).sort((a, b) => a - b)
  const ys = out.map((p) => p.y)
  const back = xs.slice(0, 4)
  const front = xs.slice(-3)
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1)
  const { coverage } = threatCoverage(players, side.threat_grid)
  const key = side.key_threat
  const markDistance = key ? Math.min(...out.map((p) => Math.hypot(p.x - key.x, p.y - key.y))) : 30
  const line = mean(back)
  return {
    lineHeight: line,
    frontHeight: mean(front),
    length: mean(front) - line,
    width: Math.max(...ys) - Math.min(...ys),
    coverage,
    markDistance,
    markQuality: Math.exp(-(markDistance ** 2) / (2 * MARK_SIGMA ** 2)),
    bodiesForward: xs.filter((x) => x >= FINAL_THIRD_X).length,
    behindRisk: 1 / (1 + Math.exp(-(line - 38) / 5)),
  }
}

type Metrics = ReturnType<typeof shapeMetrics>

function structureFit(m: Metrics, p: Profile) {
  const targetLine = 18 + 32 * p.depth
  const targetLength = 32 + 22 * p.attack
  const lineFit = 1 - Math.min(1, Math.abs(m.lineHeight - targetLine) / 22)
  const lengthFit = 1 - Math.min(1, Math.abs(m.length - targetLength) / 30)
  const markFit = p.marking > 0.6 ? m.markQuality : 1
  return clamp(0.45 * lineFit + 0.3 * lengthFit + 0.25 * markFit)
}

export function zoneLabel(x: number, y: number) {
  const central = y >= 18 && y <= 62 // The width of the penalty area.
  const depth =
    x < 18
      ? central
        ? 'inside your box'
        : 'by your corner flag'
      : x < 36
        ? central
          ? 'at the edge of your box'
          : 'wide of your box'
        : x < 60
          ? 'in your half'
          : x < 84
            ? 'in midfield'
            : 'in their half'
  const lane =
    y >= 62 ? 'Right flank' : y >= 48 ? 'Right half-space' : y > 32 ? 'Centre' : y > 18 ? 'Left half-space' : 'Left flank'
  return `${lane}, ${depth}`
}

function baselineRate(observed: number, minute: number, deficit: number) {
  const prior = 20
  const typical = 1.35 / 90
  let rate = (observed * minute + typical * prior) / (minute + prior)
  if (deficit > 0) rate *= 1 + 0.35 * Math.min(deficit, 2)
  else if (deficit < 0) rate *= 1 - 0.12 * Math.min(-deficit, 2)
  return rate
}

function ratingLabel(r: number) {
  if (r >= 8.5) return 'Masterclass'
  if (r >= 7) return 'Shrewd call'
  if (r >= 5.5) return 'Did a job'
  if (r >= 4) return 'Questions to answer'
  return 'Sack race'
}

const worry = (text: string) => {
  const t = text.replace(/^Biggest gap: /, '')
  return t[0].toLowerCase() + t.slice(1)
}

const OPENINGS: Partial<Record<TacticKey, string>> = {
  park_bus: 'Parking the bus',
  high_press: 'Pressing high',
  custom: 'Your plan',
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

export function simulateLocally(slug: string, detail: ScenarioDetail, req: SimulationRequest): SimulationResult {
  const snap = detail.snapshot
  const side = snap.sides[String(req.team_id)]
  const oppId = Object.keys(snap.sides).find((k) => k !== String(req.team_id))!
  const opp = snap.sides[oppId]
  const profile: Profile =
    req.tactic === 'custom' ? profileFromText(req.custom_plan ?? '') : PRESETS[req.tactic]

  const onPitch = new Map<number, SnapshotPlayer>(side.players.map((p) => [p.id, { ...p }]))
  const subNotes: { off: SnapshotPlayer; on: SnapshotPlayer }[] = []
  for (const s of req.substitutions) {
    const off = onPitch.get(s.off_id)
    const incoming = side.bench.find((b) => b.id === s.on_id)
    if (!off || !incoming) continue
    onPitch.delete(s.off_id)
    const on: SnapshotPlayer = {
      ...incoming,
      role: incoming.role ?? off.role,
      position: incoming.position ?? off.position,
      x: off.x,
      y: off.y,
    }
    onPitch.set(on.id, on)
    subNotes.push({ off, on })
  }
  for (const pl of req.placements) {
    const p = onPitch.get(pl.player_id)
    if (p) {
      p.x = clamp(pl.x, 0, PITCH_X)
      p.y = clamp(pl.y, 0, PITCH_Y)
    }
  }
  const players = [...onPitch.values()]
  const base = shapeMetrics(side.players, side)
  const user = shapeMetrics(players, side)
  const fit = structureFit(user, profile)

  const minute = snap.minute
  const horizon = snap.horizon_minutes
  const goalsFor = side.is_home ? snap.score.home : snap.score.away
  const goalsAgainst = side.is_home ? snap.score.away : snap.score.home
  const lead = goalsFor - goalsAgainst

  let against = 1
  against *= 1 - 0.56 * (0.5 - profile.depth)
  against *= 1 - 0.18 * (profile.press - 0.45)
  against *= 1 + Math.max(0, profile.press - 0.5) * (Math.max(0, minute - 60) / 60) * 0.6
  const keyShare = side.key_threat?.threat_share ?? 0.15
  against *= 1 - 0.9 * profile.marking * keyShare * user.markQuality
  against *= Math.exp(-1.6 * (user.coverage - base.coverage))
  against *= 1 + 0.45 * (user.behindRisk - base.behindRisk)
  against *= Math.exp(0.05 * (user.bodiesForward - base.bodiesForward))
  against *= 1 + 0.3 * (0.6 - fit)

  let forMult = 0.5 + 1.1 * profile.attack
  forMult *= 1 + 0.15 * (profile.depth - 0.5)
  forMult *= Math.exp(0.1 * (user.bodiesForward - base.bodiesForward))
  forMult *= 1 + 0.15 * (fit - 0.6)
  for (const n of subNotes) {
    if (n.on.role === 'FWD' && profile.attack >= 0.4) forMult *= 1.06
    else if ((n.on.role === 'DEF' || n.on.role === 'MID') && profile.depth <= 0.5) against *= 0.96
    else forMult *= 1.02
  }
  against = clamp(against, 0.3, 2.5)
  forMult = clamp(forMult, 0.25, 2.5)

  const baseFor = baselineRate(side.baseline.xg_for_per_min, minute, -lead) * horizon
  const baseAgainst = baselineRate(side.baseline.xg_against_per_min, minute, lead) * horizon
  const projFor = baseFor * forMult
  const projAgainst = baseAgainst * against

  const [wFor, wAgainst] =
    lead >= 2 ? [0.35, 1.6] : lead === 1 ? [0.6, 1.4] : lead === 0 ? [1, 1] : lead === -1 ? [1.4, 0.7] : [1.7, 0.4]
  const utility = wFor * (projFor - baseFor) - wAgainst * (projAgainst - baseAgainst)
  const scale = Math.max(0.25, baseFor + baseAgainst)
  const raw = 6 * (utility / scale) + 2.2 * (fit - 0.55)
  const rating = round(clamp(5.8 + 4.2 * Math.tanh(raw / 4), 1, 10), 1)

  const finalFor = goalsFor + Math.floor(projFor)
  const finalAgainst = goalsAgainst + Math.floor(projAgainst)

  const { exposure } = threatCoverage(players, side.threat_grid)
  const w = PITCH_X / GRID_COLS
  const h = PITCH_Y / GRID_ROWS
  const zones: ExposedZone[] = exposure
    .sort((a, b) => b.open - a.open)
    .filter((z) => z.open >= 0.025)
    .slice(0, 3)
    .map((z) => ({ x: z.x - w / 2, y: z.y - h / 2, w, h, share: round(z.open, 3), label: zoneLabel(z.x, z.y) }))

  const metrics: Metric[] = [
    { key: 'coverage', label: `Cover of ${opp.name}'s danger areas`, value: Math.round(user.coverage * 100), baseline: Math.round(base.coverage * 100), unit: '%', better: 'higher' },
    { key: 'line_height', label: 'Defensive line, from your goal', value: Math.round(user.lineHeight), baseline: Math.round(base.lineHeight), unit: 'yd', better: 'context' },
    { key: 'length', label: 'Distance from back line to front line', value: Math.round(user.length), baseline: Math.round(base.length), unit: 'yd', better: 'lower' },
    { key: 'bodies_forward', label: 'Players in the final third', value: user.bodiesForward, baseline: base.bodiesForward, unit: '', better: 'context' },
  ]
  if (side.key_threat)
    metrics.push({ key: 'mark_distance', label: `Nearest man to ${side.key_threat.name}`, value: Math.round(user.markDistance), baseline: Math.round(base.markDistance), unit: 'yd', better: 'lower' })

  const findings: Finding[] = []
  const covDelta = user.coverage - base.coverage
  if (covDelta >= 0.03)
    findings.push({ tone: 'good', text: `You cover more of the ground ${opp.name} actually attacked through: ${Math.round(user.coverage * 100)}% against ${Math.round(base.coverage * 100)}% in the real shape.` })
  else if (covDelta <= -0.03)
    findings.push({ tone: 'bad', text: `Your shape leaves more of ${opp.name}'s favourite ground uncovered than the real one did (${Math.round(user.coverage * 100)}% vs ${Math.round(base.coverage * 100)}%).` })
  if (zones[0])
    findings.push({ tone: 'bad', text: `Biggest gap: ${zones[0].label.toLowerCase()}. About ${Math.round(zones[0].share * 100)}% of their threat ends up there with nobody close.` })
  const planName = req.tactic === 'custom' ? 'your plan' : `a ${profile.label.toLowerCase()}`
  if (fit >= 0.75) findings.push({ tone: 'good', text: `The shape matches the plan. Players are where ${planName} needs them.` })
  else if (fit < 0.45) findings.push({ tone: 'bad', text: `The shape and the plan disagree. ${planName[0].toUpperCase()}${planName.slice(1)} needs a different line height and spacing than the one you drew.` })
  for (const n of subNotes)
    findings.push({ tone: 'neutral', text: `${n.on.name} on for ${n.off.name}: fresh legs in ${n.on.position ?? 'the same role'}.` })

  const dAgainst = projAgainst - baseAgainst
  const goods = findings.filter((f) => f.tone === 'good')
  const bads = findings.filter((f) => f.tone === 'bad')
  const headline =
    rating >= 7 ? `${side.name} read it right` : rating >= 5.5 ? 'Sensible, if not spectacular' : rating >= 4 ? 'A gamble that could backfire' : `${opp.name} will fancy this`
  const take = [
    `${OPENINGS[req.tactic] ?? `Man-marking ${side.key_threat?.name ?? 'their danger man'}`} for the last ${horizon} minutes ${dAgainst < 0 ? 'cuts' : 'adds to'} what ${opp.name} should create (${baseAgainst.toFixed(2)} to ${projAgainst.toFixed(2)} xG).`,
    goods[0]?.text,
    bads[0] ? `The worry: ${worry(bads[0].text)}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    scenario: slug,
    team_id: req.team_id,
    opponent_id: Number(oppId),
    tactic: req.tactic,
    profile: { ...profile },
    plan_source: req.tactic === 'custom' ? 'model' : 'preset',
    gaffer_rating: rating,
    rating_label: ratingLabel(rating),
    structure_fit: round(fit),
    projection: {
      minutes: horizon,
      xg_for: round(projFor),
      xg_against: round(projAgainst),
      baseline_xg_for: round(baseFor),
      baseline_xg_against: round(baseAgainst),
      likely_score: side.is_home ? { home: finalFor, away: finalAgainst } : { home: finalAgainst, away: finalFor },
    },
    metrics,
    exposed_zones: zones,
    findings: findings.slice(0, 7),
    lineup: players,
    substitutions: subNotes.map((n) => ({ off: n.off.name, on: n.on.name })),
    pundit: { headline, take, source: 'model' },
    actual: { ...snap.actual, xg_for_after: side.actual_after.xg_for, xg_against_after: side.actual_after.xg_against },
    model_note:
      'Offline estimate from the in-browser copy of the model. Projections are expected goals, not predictions of the result.',
  }
}
