/**
 * The live match: the rest of the game played out phase by phase in the
 * browser, so the user can watch it unfold, pause, and change tactics.
 *
 * Expected goals come from the same evaluation model as the instant verdict
 * (setupRates in model.ts), re-read every minute so score effects and tired
 * legs behind a press kick in as the clock runs. Where shots come from follows
 * the ground each shape leaves open, so a gap on the board is where the
 * opponent shoots from. The chance model is one function (ChanceModel), the
 * piece a trained model would replace.
 *
 * Everything is in the user's frame: their goal at x=0, attacking towards x=120.
 */
import { baselineRate, PITCH_X, PITCH_Y, setupRates, threatCoverage, type Setup } from './model'
import { shortName } from './names'
import type { LiveSummary, Role, ScenarioDetail, Side, SnapshotPlayer, TacticKey } from './types'

export type Team = 'you' | 'them'

/** Expected goals per minute for each side, for the set-up and, as a yardstick, the real shape. */
export type ChanceModel = (ctx: {
  side: Side
  observedMinutes: number
  lead: number
  forMult: number
  against: number
}) => { forPerMin: number; againstPerMin: number; baseForPerMin: number; baseAgainstPerMin: number }

export const evaluationModel: ChanceModel = ({ side, observedMinutes, lead, forMult, against }) => {
  const baseForPerMin = baselineRate(side.baseline.xg_for_per_min, observedMinutes, -lead)
  const baseAgainstPerMin = baselineRate(side.baseline.xg_against_per_min, observedMinutes, lead)
  return { forPerMin: baseForPerMin * forMult, againstPerMin: baseAgainstPerMin * against, baseForPerMin, baseAgainstPerMin }
}

export interface LiveEvent {
  /** Match clock, in seconds. */
  t: number
  kind: 'kickoff' | 'play' | 'card' | 'shot' | 'goal' | 'change' | 'decision' | 'fulltime'
  team: Team | null
  text: string
  xg?: number
  player?: string
  /** Where a shot was taken. */
  at?: { x: number; y: number }
}

/** One answer to a touchline call. No tactic and no sub means "hold your nerve". */
export interface CallOption {
  key: string
  label: string
  hint: string
  tactic?: Exclude<TacticKey, 'custom'>
  sub?: { off_id: number; on_id: number }
}

/** A moment in the match that asks the manager for a decision. The clock waits. */
export interface Call {
  t: number
  kind: 'threat' | 'conceded' | 'scored' | 'booking' | 'legs' | 'late'
  title: string
  body: string
  options: CallOption[]
}

interface Waypoint {
  t: number
  x: number
  y: number
}

interface Phase {
  team: Team
  start: number
  end: number
  path: Waypoint[]
  outcome: 'shot' | 'turnover'
  shot?: { x: number; y: number; xg: number }
}

export interface Frame {
  ball: { x: number; y: number }
  you: { id: number; x: number; y: number }[]
  them: { id: number; x: number; y: number }[]
  possession: Team
}

/** Small, fast, seedable: the same seed and decisions replay the same match. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const smooth = (k: number) => k * k * (3 - 2 * k)

/** Shot quality from where it is taken, towards the goal at x=0. */
export function shotXg(x: number, y: number) {
  const d = Math.hypot(x, y - PITCH_Y / 2)
  const wide = Math.max(0, Math.abs(y - PITCH_Y / 2) - 6)
  return clamp(1 / (1 + Math.exp(-(1 - 0.17 * d - 0.04 * wide))), 0.01, 0.8)
}

interface Spot {
  x: number
  y: number
  w: number
  xg: number
}

/** How a shot reads, from where it was taken towards the goal at x=0. */
function shotPlace(x: number, y: number) {
  const off = Math.abs(y - PITCH_Y / 2)
  if (Math.hypot(x, off) <= 9) return 'from close range'
  if (x <= 18 && off <= 22) return off > 12 ? 'from a tight angle' : 'from inside the box'
  return x <= 26 ? 'from the edge of the box' : 'from distance'
}

/** Where shots come from: the open ground in shooting range, weighted by real
 * threat and by how good a place it is to shoot from. */
function shotSpots(players: SnapshotPlayer[], grid: number[][]): { spots: Spot[]; meanXg: number } {
  const { exposure } = threatCoverage(players, grid)
  let spots = exposure
    .filter((z) => z.x <= 30 && Math.abs(z.y - PITCH_Y / 2) <= 30)
    .map((z) => ({ x: z.x, y: z.y, w: (z.open + 0.35 * z.threat) * Math.sqrt(shotXg(z.x, z.y)), xg: shotXg(z.x, z.y) }))
    .filter((s) => s.w > 0)
  if (!spots.length) spots = [{ x: 15, y: 40, w: 1, xg: shotXg(15, 40) }]
  const total = spots.reduce((a, s) => a + s.w, 0)
  spots = spots.map((s) => ({ ...s, w: s.w / total }))
  return { spots, meanXg: spots.reduce((a, s) => a + s.w * s.xg, 0) }
}

/** Tilt shot locations towards the flanks (width 1) or the middle (width 0). */
function leanSpots(base: { spots: Spot[] }, width: number) {
  let spots = base.spots.map((s) => {
    const wide = Math.min(1, Math.abs(s.y - PITCH_Y / 2) / 20) * 2 - 1
    return { ...s, w: s.w * Math.max(0.15, 1 + 1.6 * (width - 0.5) * wide) }
  })
  const total = spots.reduce((a, s) => a + s.w, 0)
  spots = spots.map((s) => ({ ...s, w: s.w / total }))
  return { spots, meanXg: spots.reduce((a, s) => a + s.w * s.xg, 0) }
}

const ROLE_SHOT: Record<string, number> = { GK: 0, DEF: 0.4, MID: 1.4, FWD: 3 }
/** Touchline calls: at most this many a match, this far apart (goals excepted). */
const MAX_CALLS = 4
const CALL_GAP = 6 * 60
const SECONDS_PER_MINUTE = 60

export class LiveEngine {
  readonly start: number
  readonly end: number
  t: number
  score: { for: number; against: number }
  readonly startScore: { for: number; against: number }
  events: LiveEvent[] = []
  changes: { minute: number; label: string }[] = []
  private phase: Phase | null = null
  private rng: () => number
  private side: Side
  private opp: Side
  private oppAnchors: SnapshotPlayer[]
  private setup: Setup
  private rates!: ReturnType<typeof setupRates>
  private rateMinute = -1
  private perMin = { forPerMin: 0, againstPerMin: 0, baseForPerMin: 0, baseAgainstPerMin: 0 }
  private youSpots!: { spots: Spot[]; meanXg: number }
  private themSpots: { spots: Spot[]; meanXg: number }
  /** Where your shots come from, leaning wide or central with your plan's width. */
  private yourAttack!: { spots: Spot[]; meanXg: number }
  private totals = { xgFor: 0, xgAgainst: 0, baseFor: 0, baseAgainst: 0, fit: 0 }
  private shots = { you: 0, them: 0 }
  private goals: LiveSummary['goals'] = []
  private restartAt: { team: Team; x: number; y: number } | null = null
  /** A call waiting for an answer; the clock doesn't move until it gets one. */
  pending: Call | null = null
  private calls: Call['kind'][] = []
  private lastCall = -Infinity
  private oppShots: number[] = []
  private booked: { id: number; name: string } | null = null
  private bookingAt: number

  private detail: ScenarioDetail
  readonly teamId: number
  private model: ChanceModel

  constructor(detail: ScenarioDetail, teamId: number, setup: Setup, seed: number, model: ChanceModel = evaluationModel) {
    this.detail = detail
    this.teamId = teamId
    this.model = model
    const snap = detail.snapshot
    this.side = snap.sides[String(teamId)]
    this.opp = Object.values(snap.sides).find((s) => s.team_id !== teamId)!
    // The opponent keeps its real shape, turned into the user's frame.
    this.oppAnchors = this.opp.players.map((p) => ({ ...p, x: PITCH_X - p.x, y: PITCH_Y - p.y }))
    // Your shots: the ground you attacked in the real match, where their real shape left it open.
    const theirs = shotSpots(this.opp.players, this.opp.threat_grid)
    this.themSpots = { meanXg: theirs.meanXg, spots: theirs.spots.map((s) => ({ ...s, x: PITCH_X - s.x, y: PITCH_Y - s.y })) }
    this.start = snap.minute * SECONDS_PER_MINUTE + (snap.second ?? 0)
    this.end = Math.max(this.start + SECONDS_PER_MINUTE, snap.full_time_minute * SECONDS_PER_MINUTE)
    this.t = this.start
    const f = this.side.is_home ? snap.score.home : snap.score.away
    const a = this.side.is_home ? snap.score.away : snap.score.home
    this.score = { for: f, against: a }
    this.startScore = { ...this.score }
    this.rng = mulberry32(seed)
    this.setup = setup
    // About half of matches see one of your players booked, somewhere in the middle of what's left.
    this.bookingAt = this.rng() < 0.55 ? lerp(this.start + 300, this.end - 600, this.rng()) : Infinity
    this.refreshRates(true)
    this.events.push({ t: this.t, kind: 'kickoff', team: null, text: `Play resumes. ${this.side.name} ${f}–${a} ${this.opp.name}.` })
  }

  get done() {
    return this.t >= this.end
  }

  get minute() {
    return Math.floor(this.t / SECONDS_PER_MINUTE)
  }

  get lead() {
    return this.score.for - this.score.against
  }

  get players() {
    return this.rates.players
  }

  get opponents() {
    return this.oppAnchors
  }

  /** A tactical change: the current move is abandoned and play restarts from the ball. */
  setSetup(setup: Setup, label: string) {
    this.setup = setup
    this.refreshRates(true)
    this.changes.push({ minute: this.minute + 1, label })
    this.events.push({ t: this.t, kind: 'change', team: 'you', text: label })
    if (this.phase && !this.done) {
      const ball = this.ballAt(this.t)
      this.restartAt = { team: this.phase.team, ...ball }
      this.phase = null
    }
  }

  private refreshRates(force = false) {
    const minute = this.minute
    if (!force && minute === this.rateMinute) return
    const shapeChanged = force
    this.rateMinute = minute
    this.rates = setupRates(this.detail, this.teamId, this.setup, minute)
    if (shapeChanged) {
      this.youSpots = shotSpots(this.rates.players, this.side.threat_grid)
      this.yourAttack = leanSpots(this.themSpots, this.rates.profile.width)
    }
    this.perMin = this.model({
      side: this.side,
      observedMinutes: this.detail.snapshot.minute,
      lead: this.lead,
      forMult: this.rates.forMult,
      // A booked player can't fly into tackles.
      against: this.rates.against * (this.booked && this.onPitch(this.booked.id) ? 1.06 : 1),
    })
  }

  private onPitch(id: number) {
    return this.rates.players.some((p) => p.id === id)
  }

  /** Run the clock forward by `seconds` of match time; returns the new events. */
  advance(seconds: number): LiveEvent[] {
    const from = this.events.length
    const target = Math.min(this.end, this.t + seconds)
    while (this.t < target && !this.pending) {
      if (!this.phase) this.phase = this.nextPhase()
      const nextMinute = (this.minute + 1) * SECONDS_PER_MINUTE
      const step = Math.min(target, this.phase.end, nextMinute) - this.t
      this.accumulate(step)
      this.t += step
      if (this.t >= this.phase.end) this.resolve(this.phase)
      this.refreshRates()
      if (!this.pending) this.minuteCalls()
    }
    if (this.done && !this.events.some((e) => e.kind === 'fulltime'))
      this.events.push({
        t: this.end,
        kind: 'fulltime',
        team: null,
        text: `Full time. ${this.side.name} ${this.score.for}–${this.score.against} ${this.opp.name}.`,
      })
    return this.events.slice(from)
  }

  /** Skipping ahead: every call left gets the default answer, holding your nerve. */
  runToEnd() {
    const out: LiveEvent[] = []
    while (!this.done) {
      out.push(...this.advance(this.end - this.t))
      if (this.pending) this.answer(this.pending.options.find((o) => !o.tactic && !o.sub)!.key)
    }
    return out
  }

  /** Answer the pending call. Changes to the set-up come back through setSetup. */
  answer(key: string): CallOption | null {
    const call = this.pending
    if (!call) return null
    const option = call.options.find((o) => o.key === key) ?? call.options[call.options.length - 1]
    this.pending = null
    if (!option.tactic && !option.sub) this.events.push({ t: this.t, kind: 'decision', team: 'you', text: `${option.label}.` })
    return option
  }

  // ---------------------------------------------------------------- calls
  private ask(call: Omit<Call, 't'>, urgent = false) {
    if (this.pending || this.done || this.calls.length >= MAX_CALLS) return
    // A call with only one answer isn't a decision.
    if (call.options.length < 2) return
    if (!urgent && this.t - this.lastCall < CALL_GAP) return
    if (this.calls.includes(call.kind) && call.kind !== 'conceded') return
    // Nothing left to decide in the last minute.
    if (this.end - this.t < 60) return
    this.calls.push(call.kind)
    this.lastCall = this.t
    this.pending = { ...call, t: this.t }
  }

  private subsLeft() {
    return this.side.subs_allowed - this.side.subs_used - this.setup.substitutions.length
  }

  /** A substitution worth offering: someone in `offRoles` off, the best fit from the bench on. */
  private subOption(offRoles: Role[], onRoles: Role[], off?: SnapshotPlayer): CallOption | null {
    if (this.subsLeft() <= 0) return null
    const used = new Set(this.setup.substitutions.map((s) => s.on_id))
    const bench = this.side.bench.filter((b) => !used.has(b.id))
    const incoming = bench.find((b) => b.role && onRoles.includes(b.role)) ?? bench.find((b) => b.role !== 'GK')
    // Take off the most advanced player in those roles: usually the one doing the running.
    const outgoing =
      off ?? [...this.rates.players].filter((p) => offRoles.includes(p.role)).sort((a, b) => b.x - a.x)[0]
    if (!incoming || !outgoing) return null
    return {
      key: 'sub',
      label: `${shortName(incoming.name)} on for ${shortName(outgoing.name)}`,
      hint: incoming.position ? `Fresh legs at ${incoming.position.toLowerCase()}.` : 'Fresh legs.',
      sub: { off_id: outgoing.id, on_id: incoming.id },
    }
  }

  private tacticOption(tactic: Exclude<TacticKey, 'custom'>, label: string, hint: string): CallOption | null {
    return this.setup.tactic === tactic ? null : { key: tactic, label, hint, tactic }
  }

  private hold(label = 'Hold your nerve', hint = 'Trust the plan you have.'): CallOption {
    return { key: 'hold', label, hint }
  }

  private options(...opts: (CallOption | null)[]) {
    return opts.filter((o): o is CallOption => o !== null)
  }

  private afterShot(team: Team, scored: boolean) {
    const minsLeft = Math.round((this.end - this.t) / 60)
    const key = this.side.key_threat
    if (scored && team === 'them') {
      const lead = this.lead
      this.ask(
        lead > 0
          ? {
              kind: 'conceded',
              title: `${this.opp.name} are back in it`,
              body: `Still ${this.score.for}–${this.score.against} to you, ${minsLeft} minutes to hold on.`,
              options: this.options(
                this.tacticOption('park_bus', 'Shut up shop', 'Everyone behind the ball. You will see less of it.'),
                this.subOption(['FWD', 'MID'], ['DEF', 'MID']),
                this.hold('Stay calm', 'Change nothing. One goal is still a lead.'),
              ),
            }
          : {
              kind: 'conceded',
              title: lead === 0 ? 'Your lead is gone' : `${this.opp.name} are ahead`,
              body: `${this.score.for}–${this.score.against}, ${minsLeft} minutes left. The dugout is looking at you.`,
              options: this.options(
                this.tacticOption('high_press', 'Go for it', 'Push up and hunt the ball. More chances both ways.'),
                this.subOption(['DEF', 'MID'], ['FWD']),
                this.hold('Stay patient', 'There is time. Keep the shape.'),
              ),
            },
        true,
      )
      return
    }
    if (scored && team === 'you' && this.lead >= 1 && minsLeft >= 6) {
      this.ask(
        {
          kind: 'scored',
          title: this.lead === 1 ? 'You are in front' : 'Breathing room',
          body: `${this.score.for}–${this.score.against} with ${minsLeft} minutes to go. Protect it or go for more?`,
          options: this.options(
            this.tacticOption('park_bus', 'Protect it', 'Drop deep and make them break you down.'),
            this.tacticOption('high_press', 'Go for the kill', 'Another goal ends it. So could a counter.'),
            this.hold('Keep doing what works'),
          ),
        },
        true,
      )
      return
    }
    if (team === 'them') {
      this.oppShots.push(this.t)
      const recent = this.oppShots.filter((s) => this.t - s <= 10 * 60)
      if (recent.length >= 2)
        this.ask({
          kind: 'threat',
          title: `${this.opp.name} keep coming`,
          body: `${recent.length} shots against you in ten minutes.${key && this.onPitchOpp(key.player_id) ? ` ${shortName(key.name)} is at the heart of it.` : ''}`,
          options: this.options(
            this.tacticOption('park_bus', 'Drop deeper', 'Fewer clear sights of goal, less of the ball.'),
            key ? this.tacticOption('mark_threat', `Put a man on ${shortName(key.name)}`, 'Cuts his share. Opens space elsewhere.') : null,
            this.hold(),
          ),
        })
    }
  }

  private onPitchOpp(id: number) {
    return this.oppAnchors.some((p) => p.id === id)
  }

  /** Calls that come with the clock: a booking, tired legs, the last throw of the dice. */
  private minuteCalls() {
    const minsLeft = Math.round((this.end - this.t) / 60)
    if (!this.booked && this.t >= this.bookingAt) {
      const candidates = this.rates.players.filter((p) => p.role === 'DEF' || p.role === 'MID')
      const p = candidates[Math.floor(this.rng() * candidates.length)]
      if (p) {
        this.booked = { id: p.id, name: p.name }
        this.events.push({ t: this.t, kind: 'card', team: 'you', player: p.name, text: `${p.name} goes into the book for a late challenge.` })
        this.refreshRates(true)
        this.ask(
          {
            kind: 'booking',
            title: `${shortName(p.name)} is on a yellow`,
            body: `${minsLeft} minutes left, and he can't fly into a tackle now.`,
            options: this.options(
              this.subOption([p.role], [p.role], p),
              this.hold('Leave him on', 'He knows the job. He will have to stay on his feet.'),
            ),
          },
          true,
        )
        return
      }
    }
    if (this.rates.profile.press >= 0.6 && this.minute >= 78)
      this.ask({
        kind: 'legs',
        title: 'The press is running out of legs',
        body: 'Your front players are arriving a second late. The gaps behind them are growing.',
        options: this.options(
          this.tacticOption('mark_threat', 'Drop off a little', 'Stop chasing. Pick up their danger man instead.'),
          this.subOption(['MID', 'FWD'], ['MID', 'FWD']),
          this.hold('Keep pressing', 'Make them suffer for the last few minutes.'),
        ),
      })
    if (this.lead <= 0 && minsLeft <= 7)
      this.ask({
        kind: 'late',
        title: 'Last roll of the dice',
        body: `${this.score.for}–${this.score.against} and ${minsLeft} minutes left.`,
        options: this.options(
          this.tacticOption('high_press', 'Everyone forward', 'Throw bodies at it and hope.'),
          this.subOption(['DEF', 'MID'], ['FWD']),
          this.hold(this.lead === 0 ? 'Take the draw' : 'Keep the shape', 'No heroics.'),
        ),
      })
  }

  private accumulate(seconds: number) {
    const m = seconds / SECONDS_PER_MINUTE
    this.totals.xgFor += this.perMin.forPerMin * m
    this.totals.xgAgainst += this.perMin.againstPerMin * m
    this.totals.baseFor += this.perMin.baseForPerMin * m
    this.totals.baseAgainst += this.perMin.baseAgainstPerMin * m
    this.totals.fit += this.rates.fit * m
  }

  private possessionShare() {
    const p = this.rates.profile
    // Patient sides keep the ball; direct ones give it back sooner.
    return clamp(0.5 + 0.2 * (p.attack - 0.45) + 0.15 * (p.press - 0.45) + 0.15 * (0.4 - p.direct) - 0.04 * this.lead, 0.3, 0.72)
  }

  private nextPhase(): Phase {
    const rng = this.rng
    const share = this.possessionShare()
    const restart = this.restartAt
    this.restartAt = null
    const team: Team = restart ? restart.team : rng() < share ? 'you' : 'them'
    // Patient build-ups take longer than direct attacks.
    const duration = (8 + rng() * 24) * (team === 'you' ? 1 + 0.7 * (0.4 - this.rates.profile.direct) : 1)
    const start = this.t
    const end = Math.min(this.end, start + duration)
    const teamShare = team === 'you' ? share : 1 - share
    const xgPerMin = team === 'you' ? this.perMin.forPerMin : this.perMin.againstPerMin
    const spots = team === 'you' ? this.yourAttack : this.youSpots
    // Shots per minute that, at this shape's typical shot quality, add up to the expected goals.
    const pShot = clamp(((xgPerMin / spots.meanXg) * (duration / SECONDS_PER_MINUTE)) / teamShare, 0, 0.9)
    const outcome = end - start >= 6 && rng() < pShot ? 'shot' : 'turnover'

    // Attack runs towards x=120 for you and x=0 for them.
    const dir = team === 'you' ? 1 : -1
    const from = restart ?? {
      x: team === 'you' ? 20 + rng() * 30 : 70 + rng() * 30,
      y: 10 + rng() * 60,
    }
    let shot: Phase['shot']
    let to: { x: number; y: number }
    if (outcome === 'shot') {
      let pick = rng()
      const spot = spots.spots.find((s) => (pick -= s.w) <= 0) ?? spots.spots[0]
      const x = clamp(spot.x + (rng() - 0.5) * 9, 4, PITCH_X - 4)
      const y = clamp(spot.y + (rng() - 0.5) * 9, 12, PITCH_Y - 12)
      // Measured towards the goal being attacked.
      const gx = team === 'you' ? PITCH_X - x : x
      const gy = team === 'you' ? PITCH_Y - y : y
      shot = { x, y, xg: shotXg(gx, gy) }
      to = { x, y }
    } else {
      to = { x: team === 'you' ? 50 + rng() * 45 : 25 + rng() * 45, y: 8 + rng() * 64 }
    }
    const legs = 2 + Math.floor(rng() * 3)
    const path: Waypoint[] = [{ t: start, ...from }]
    for (let i = 1; i < legs; i++) {
      const k = i / legs
      path.push({
        t: lerp(start, end, k + (rng() - 0.5) * 0.1),
        x: clamp(lerp(from.x, to.x, k) + dir * (rng() - 0.3) * 6, 3, PITCH_X - 3),
        y: clamp(lerp(from.y, to.y, k) + (rng() - 0.5) * 22, 4, PITCH_Y - 4),
      })
    }
    path.push({ t: end, ...to })
    if (duration > 18 && rng() < 0.22) {
      const text = this.buildUp(team, to.y, rng())
      // Never the same line twice running.
      if (this.events.findLast((e) => e.kind === 'play')?.text !== text) this.events.push({ t: start, kind: 'play', team, text })
    }
    return { team, start, end, path, outcome, shot }
  }

  /** A line of colour for a long spell of possession. Flanks are named from your bench. */
  private buildUp(team: Team, y: number, roll: number) {
    const lane = y < 27 ? 'left' : y > 53 ? 'right' : 'middle'
    if (team === 'you')
      return roll < 0.5
        ? `${this.side.name} keep the ball and probe down the ${lane}.`
        : `${this.side.name} work it patiently through midfield.`
    if (roll < 0.5) return `${this.opp.name} push on down your ${lane}.`
    return this.lead > 0 ? `${this.opp.name} pin you back, looking for a way in.` : `${this.opp.name} move it quickly, hunting a gap.`
  }

  private resolve(phase: Phase) {
    this.phase = null
    if (phase.outcome !== 'shot' || !phase.shot || phase.end < phase.start + 6) {
      // Possession changes where the ball was lost.
      const last = phase.path[phase.path.length - 1]
      this.restartAt = { team: phase.team === 'you' ? 'them' : 'you', x: last.x, y: last.y }
      return
    }
    const rng = this.rng
    const { x, y, xg } = phase.shot
    const team = phase.team
    this.shots[team] += 1
    const shooter = this.shooter(team, x, y)
    const where = team === 'you' ? shotPlace(PITCH_X - x, PITCH_Y - y) : shotPlace(x, y)
    if (rng() < xg) {
      if (team === 'you') this.score.for += 1
      else this.score.against += 1
      this.goals.push({ minute: this.minute + 1, team, player: shooter })
      const name = team === 'you' ? this.side.name : this.opp.name
      this.events.push({ t: this.t, kind: 'goal', team, xg, player: shooter, at: { x, y }, text: `GOAL! ${shooter} scores ${where}. ${name} ${team === 'you' ? this.score.for : this.score.against}, ${team === 'you' ? this.opp.name : this.side.name} ${team === 'you' ? this.score.against : this.score.for}.` })
      this.refreshRates(true)
      this.restartAt = { team: team === 'you' ? 'them' : 'you', x: PITCH_X / 2, y: PITCH_Y / 2 }
      this.afterShot(team, true)
      return
    }
    const r = rng()
    const result = xg >= 0.25 ? (r < 0.6 ? 'is denied by the keeper' : 'drags it wide') : r < 0.45 ? 'is saved' : r < 0.8 ? 'fires wide' : 'is blocked'
    const big = xg >= 0.25 ? 'Big chance! ' : ''
    this.events.push({ t: this.t, kind: 'shot', team, xg, player: shooter, at: { x, y }, text: `${big}${shooter} shoots ${where} and ${result}.` })
    // The keeper restarts.
    this.restartAt = { team: team === 'you' ? 'them' : 'you', x: team === 'you' ? PITCH_X - 8 : 8, y: PITCH_Y / 2 }
    this.afterShot(team, false)
  }

  private shooter(team: Team, x: number, y: number) {
    const players = team === 'you' ? this.rates.players : this.oppAnchors
    const key = team === 'them' ? this.side.key_threat : null
    let best = players[0]
    let total = 0
    const weights = players.map((p) => {
      // Their anchors face the other way: forwards sit near your goal.
      const d = Math.hypot(p.x - x, p.y - y)
      let w = (ROLE_SHOT[p.role] ?? 1) * Math.exp(-(d ** 2) / (2 * 22 ** 2))
      if (key && p.id === key.player_id)
        w *= 1 + 6 * key.threat_share * (1 - this.rates.profile.marking * this.rates.user.markQuality)
      total += w
      return w
    })
    let pick = this.rng() * total
    players.forEach((p, i) => {
      if (pick > 0 && (pick -= weights[i]) <= 0) best = p
    })
    return best.name
  }

  ballAt(t: number) {
    const path = this.phase?.path
    if (!path) return this.restartAt ? { x: this.restartAt.x, y: this.restartAt.y } : { x: PITCH_X / 2, y: PITCH_Y / 2 }
    if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]
      const b = path[i]
      if (t <= b.t) {
        const k = smooth(clamp((t - a.t) / Math.max(0.01, b.t - a.t), 0, 1))
        return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }
      }
    }
    const last = path[path.length - 1]
    return { x: last.x, y: last.y }
  }

/** The end of the pass in flight at time t: its receiver runs onto it. */
  private passTarget(t: number) {
    const path = this.phase?.path
    if (!path) return null
    return path.find((w) => w.t >= t) ?? path[path.length - 1]
  }

  /** How close play is to a shot: 1 in the build-up to one, 0 otherwise. The view slows the clock for it. */
  tension(t: number = this.t) {
    const p = this.phase
    if (!p || p.outcome !== 'shot') return 0
    const left = p.end - t
    return left > 12 ? 0 : 1 - Math.max(0, left - 4) / 8
  }

  /** Where everyone wants to be at match time t: shapes slide with the ball, one man
   * runs onto each pass, and the nearest defender closes it down. The view eases
   * players towards these targets, so nobody jumps. */
  frame(t: number = this.t): Frame {
    const ball = this.ballAt(t)
    const target = this.passTarget(t) ?? ball
    const possession: Team = this.phase?.team ?? this.restartAt?.team ?? 'you'
    const press = this.rates.profile.press
    const place = (players: SnapshotPlayer[], team: Team) => {
      const dir = team === 'you' ? 1 : -1
      const attacking = possession === team
      const shift = (ball.x - PITCH_X / 2) * 0.28 + dir * (attacking ? 6 : -3)
      const placed = players.map((p) => {
        const gk = p.role === 'GK'
        return {
          id: p.id,
          x: clamp(p.x + (gk ? shift * 0.1 : shift), 2, PITCH_X - 2),
          y: clamp(p.y + (ball.y - p.y) * (gk ? 0.25 : 0.14), 2, PITCH_Y - 2),
          gk,
        }
      })
      // In possession, the man nearest the pass's end runs onto it; out of it,
      // the man nearest the ball closes it down, harder with a press.
      const spot = attacking ? target : ball
      let near = -1
      let nearD = Infinity
      placed.forEach((p, i) => {
        const d = Math.hypot(p.x - spot.x, p.y - spot.y)
        if (!p.gk && d < nearD) {
          nearD = d
          near = i
        }
      })
      if (near >= 0) {
        const p = placed[near]
        const pull = attacking ? 1 : 0.35 + 0.35 * (team === 'you' ? press : 0.5)
        p.x = lerp(p.x, spot.x - dir * (attacking ? 0 : 2.5), pull)
        p.y = lerp(p.y, spot.y, pull)
      }
      return placed.map(({ id, x, y }) => ({ id, x, y }))
    }
    return { ball, you: place(this.rates.players, 'you'), them: place(this.oppAnchors, 'them'), possession }
  }

  summary(): LiveSummary {
    const minutes = (this.t - this.start) / SECONDS_PER_MINUTE || 1
    const r = (v: number) => Math.round(v * 100) / 100
    return {
      start_score: this.startScore,
      final_score: { ...this.score },
      xg_for: r(this.totals.xgFor),
      xg_against: r(this.totals.xgAgainst),
      base_xg_for: r(this.totals.baseFor),
      base_xg_against: r(this.totals.baseAgainst),
      fit: r(this.totals.fit / minutes),
      minutes: Math.round(minutes),
      shots_for: this.shots.you,
      shots_against: this.shots.them,
      goals: [...this.goals],
      changes: [...this.changes],
    }
  }
}
