import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Lock, RotateCcw, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { competitionName, Scoreline, SiteFooter, SiteHeader } from '../components/Chrome'
import { clock, LiveMatch, type Speed } from '../components/LiveMatch'
import { dialsFromNote, PlanBuilder, snapDials, type Dials } from '../components/PlanBuilder'
import { mirror, Pitch, toTokens, ZONE_H, ZONE_W } from '../components/Pitch'
import { TACTICS, TacticGlyph } from '../components/TacticGlyph'
import { Verdict } from '../components/Verdict'
import { api } from '../lib/api'
import { LiveEngine, type CallOption } from '../lib/engine'
import { profileFromText, type Setup } from '../lib/model'
import type { ScenarioDetail, SimulationResult, TacticKey } from '../lib/types'
import { kitFor, kitVars } from '../lib/kits'
import { shortName } from '../lib/names'
import { useBoard } from '../lib/useBoard'

const TACTIC_KEYS = new Set<TacticKey>(TACTICS.map((t) => t.key))

export default function Play() {
  const { slug = '' } = useParams()
  const [params, setParams] = useSearchParams()
  // The home screen hands over a previewed plan (and any custom text) on "Lock it in".
  const handoff = (useLocation().state ?? null) as { plan?: string; fromPreview?: boolean } | null
  const scenario = useQuery({ queryKey: ['scenario', slug], queryFn: () => api.scenario(slug) })
  const teamParam = Number(params.get('team'))
  const detail = scenario.data
  const teamId = detail && detail.snapshot.sides[String(teamParam)] ? teamParam : null

  return (
    <>
      <SiteHeader tone="paper" />
      <main id="main" className="min-h-[70vh]">
        {scenario.isPending && <LoadingMoment />}
        {scenario.error && (
          <div className="mx-auto max-w-[720px] px-4 py-24">
            <h1 className="text-3xl font-[800]">This moment didn't load</h1>
            <p className="mt-3 text-lg text-ink-soft">{scenario.error.message}</p>
            <Link to="/" className="btn btn-primary lift mt-6">
              Back to all moments
            </Link>
          </div>
        )}
        {detail && (
          <>
            <MomentBar detail={detail} teamId={teamId} />
            {teamId === null ? (
              <SidePicker detail={detail} onPick={(id) => setParams({ team: String(id) })} />
            ) : (
              <Touchline
                key={`${slug}-${teamId}`}
                detail={detail}
                teamId={teamId}
                initialTactic={TACTIC_KEYS.has(params.get('tactic') as TacticKey) ? (params.get('tactic') as TacticKey) : null}
                initialPlan={handoff?.plan ?? ''}
                fromPreview={Boolean(handoff?.fromPreview)}
              />
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  )
}

function LoadingMoment() {
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading the moment">
      <div className="h-16 w-2/3 rounded-lg bg-cream-deep" />
      <div className="mt-6 aspect-[3/2] w-full max-w-[880px] rounded-[14px] border-2 border-ink bg-pitch" />
    </div>
  )
}

function MomentBar({ detail, teamId }: { detail: ScenarioDetail; teamId: number | null }) {
  const { match, score, minute } = detail.snapshot
  const you = teamId ? detail.snapshot.sides[String(teamId)] : null
  const home = detail.snapshot.sides[String(match.home_team_id)]
  const away = detail.snapshot.sides[String(match.away_team_id)]
  return (
    <div className="border-b-2 border-ink bg-ink text-cream">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-cream/80 hover:text-cream">
            <ArrowLeft size={16} strokeWidth={2.5} aria-hidden="true" />
            All moments
          </Link>
          <Scoreline home={home.code} away={away.code} score={score} minute={minute} size="md" />
        </div>
        <div className="text-sm text-cream/80 sm:text-right">
          <p>
            {competitionName(match.competition)} final, {match.venue}
          </p>
          {you && (
            <p className="mt-0.5 font-semibold text-cream">
              You manage{' '}
              <span className="rounded-full px-2 py-0.5" style={{ background: kitFor(you.name).fill, color: kitFor(you.name).ink }}>
                {you.name}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SidePicker({ detail, onPick }: { detail: ScenarioDetail; onPick: (id: number) => void }) {
  const sides = Object.values(detail.snapshot.sides).sort((a) => (a.is_home ? -1 : 1))
  return (
    <section className="mx-auto max-w-[1320px] px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="pick-title">
      <h1 id="pick-title" className="max-w-[20ch] text-[clamp(2.2rem,5vw,3.75rem)] font-[850] leading-[1]">
        {detail.title}
      </h1>
      <p className="mt-4 max-w-[60ch] text-lg text-ink-soft">{detail.tagline}</p>
      <h2 className="mt-12 text-2xl font-[800]">Whose dugout are you in?</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {sides.map((s) => {
          const other = sides.find((o) => o.team_id !== s.team_id)!
          return (
            <button
              key={s.team_id}
              type="button"
              onClick={() => onPick(s.team_id)}
              className="lift group panel flex flex-col overflow-hidden text-left"
              style={kitVars(s.name, other.name)}
            >
              <span
                className="flex items-baseline justify-between gap-3 border-b-2 border-ink px-6 py-4 sm:px-8"
                style={{ background: kitFor(s.name).fill, color: kitFor(s.name).ink }}
              >
                <span className="score text-[clamp(3rem,8vw,5rem)]">{s.code}</span>
                <span className="text-right text-sm font-[750]">
                  {s.formation}
                  <br />
                  {s.subs_allowed - s.subs_used} sub{s.subs_allowed - s.subs_used === 1 ? '' : 's'} left
                </span>
              </span>
              <span className="block border-b-2 border-ink" aria-hidden="true">
                <Pitch
                  label={`${s.name}'s real shape at minute ${detail.minute}`}
                  you={toTokens(s.players)}
                  them={toTokens(other.players).map(mirror)}
                  keyThreatId={s.key_threat?.player_id}
                  showNames={false}
                  orientation="horizontal"
                />
              </span>
              <span className="flex flex-1 flex-col items-start p-6 sm:p-8">
                <span className="text-2xl font-[800]">{s.name}</span>
                <span className="mt-2 max-w-[48ch] text-lg">{s.dilemma}</span>
                <span className="btn btn-primary mt-6">Manage {s.name}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Touchline({
  detail,
  teamId,
  initialTactic,
  initialPlan = '',
  fromPreview = false,
}: {
  detail: ScenarioDetail
  teamId: number
  initialTactic: TacticKey | null
  initialPlan?: string
  fromPreview?: boolean
}) {
  const board = useBoard(detail, teamId)
  const { side, opp } = board
  const [tactic, setTactic] = useState<TacticKey | null>(null)
  const [plan, setPlan] = useState(initialPlan)
  // A custom plan is its dials, set on the chips; the note only pre-fills them.
  const [dials, setDials] = useState<Dials>(() => snapDials(profileFromText(initialPlan)))
  const touched = useRef(new Set<keyof Dials>())
  const writeNote = (note: string) => {
    setPlan(note)
    setDials((d) => dialsFromNote(note, d, touched.current))
  }
  const setDial = (key: keyof Dials, value: number) => {
    touched.current.add(key)
    setDials((d) => ({ ...d, [key]: value }))
  }
  const [selected, setSelected] = useState<number | null>(null)
  const [showThreat, setShowThreat] = useState(true)
  const [showGhosts, setShowGhosts] = useState(true)
  const [result, setResult] = useState<SimulationResult | null>(null)
  // The live match: kicked off from the board, paused back to it, resumed from it.
  const engine = useRef<LiveEngine | null>(null)
  const [live, setLive] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const lastSetup = useRef<Snapshot | null>(null)
  const top = useRef<HTMLDivElement>(null)

  const chooseTactic = (t: TacticKey) => {
    setTactic(t)
    if (t !== 'custom') board.applyShape(t)
  }

  // A plan picked on the home page arrives in the URL: spring into it once.
  useEffect(() => {
    if (!initialTactic) return
    // Already previewed on the home screen: no need to replay the move slowly.
    const id = window.setTimeout(() => chooseTactic(initialTactic), fromPreview ? 0 : 450)
    return () => window.clearTimeout(id)
    // Only on arrival; later choices come from the deck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setup = (): Setup => ({
    tactic: tactic!,
    custom_plan: tactic === 'custom' ? plan : null,
    dials: tactic === 'custom' ? { ...dials, source: 'model' } : null,
    placements: board.placements,
    substitutions: board.subs,
  })
  const current = (): Snapshot => ({
    tactic,
    plan: tactic === 'custom' ? JSON.stringify(dials) : '',
    placements: JSON.stringify(board.placements),
    subs: board.subs.length,
  })
  const toTop = () => requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' }))

  const kickOff = () => {
    engine.current = new LiveEngine(detail, teamId, setup(), Math.floor(Math.random() * 2 ** 31))
    board.lockSubs()
    lastSetup.current = current()
    setLive(true)
    toTop()
  }

  const resume = () => {
    const label = describeChange(lastSetup.current, current(), board)
    if (label) engine.current!.setSetup(setup(), label)
    board.lockSubs()
    lastSetup.current = current()
    setLive(true)
    toTop()
  }

  // A call answered mid-match changes the board; once React has applied it,
  // hand the new set-up to the engine.
  const decided = useRef<string | null>(null)
  const decide = (option: CallOption) => {
    decided.current = option.label
    if (option.tactic) {
      setTactic(option.tactic)
      board.applyShape(option.tactic)
    }
    if (option.sub) board.substitute(option.sub.off_id, option.sub.on_id)
  }
  useEffect(() => {
    if (!decided.current || !engine.current) return
    const label = describeChange(lastSetup.current, current(), board) ?? `${decided.current}.`
    decided.current = null
    engine.current.setSetup(setup(), label)
    board.lockSubs()
    lastSetup.current = current()
  })

  const report = useMutation({
    mutationFn: () => api.report(detail.slug, { team_id: teamId, ...setup(), live: engine.current!.summary() }),
    onSuccess: (r) => {
      setResult(r)
      setLive(false)
      toTop()
    },
  })

  if (result) {
    return (
      <div ref={top} className="scroll-mt-4" style={kitVars(side.name, opp.name)}>
        <Verdict
          detail={detail}
          result={result}
          onRetry={() => {
            engine.current = null
            board.lockSubs(0)
            report.reset()
            setResult(null)
            toTop()
          }}
        />
      </div>
    )
  }

  if (live && engine.current) {
    return (
      <div ref={top} className="scroll-mt-4" style={kitVars(side.name, opp.name)}>
        <LiveMatch
          detail={detail}
          engine={engine.current}
          onPause={() => {
            setLive(false)
            toTop()
          }}
          onFullTime={() => report.mutate()}
          reporting={report.isPending}
          error={report.error?.message ?? null}
          speed={speed}
          onSpeed={setSpeed}
          onDecide={decide}
        />
      </div>
    )
  }

  const paused = engine.current
  const heat = board.exposure.map((z) => ({ x: z.x - ZONE_W / 2, y: z.y - ZONE_H / 2, w: ZONE_W, h: ZONE_H, value: z.open }))
  const selectedPlayer = board.onPitch.find((p) => p.id === selected)
  const keyThreat = side.key_threat
  const cov = Math.round(board.coverage * 100)
  const realCov = Math.round(board.realCoverage * 100)

  return (
    <div ref={top} style={kitVars(side.name, opp.name)} className="mx-auto grid max-w-[1320px] scroll-mt-4 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:py-8">
      <section aria-labelledby="board-title" className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="board-title" className="text-2xl font-[850] sm:text-3xl">
              {paused ? 'Change it up' : 'Set your shape'}
            </h1>
            <p className="mt-1 max-w-[62ch] text-ink-soft">
              {paused
                ? `The clock is stopped at ${clock(paused.t)}. Move players, make a substitution or switch plans, then send them back out.`
                : side.dilemma}
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-[14px] border-2 border-ink bg-pitch">
          <Pitch
            label={`${side.name} in sky blue, attacking ${'right'}. ${opp.name} in red.`}
            you={toTokens(board.onPitch)}
            them={toTokens(opp.players).map(mirror)}
            ghosts={showGhosts ? toTokens(side.players) : undefined}
            keyThreatId={keyThreat?.player_id}
            selectedId={selected}
            onSelect={setSelected}
            onMove={board.move}
            heat={showThreat ? heat : undefined}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-ink bg-paper px-3 py-2.5 sm:px-4">
            <CoverageMeter value={cov} real={realCov} opponent={opp.name} />
            <div className="flex flex-wrap items-center gap-2">
              <Toggle checked={showThreat} onChange={setShowThreat}>
                Their threat
              </Toggle>
              <Toggle checked={showGhosts} onChange={setShowGhosts}>
                Real positions
              </Toggle>
              <button type="button" onClick={board.reset} className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold hover:bg-cream-deep">
                <RotateCcw size={14} strokeWidth={2.5} aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Drag your players, or select one and use the arrow keys. Red shading is where {opp.name} really did damage that
          nobody in your shape is close to. The dashed ring marks {keyThreat?.name ?? 'their main threat'}.
        </p>
      </section>

      <aside aria-labelledby="deck-title" className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <div className="panel p-4 sm:p-5">
          <h2 id="deck-title" className="text-2xl font-[850]">
            How do you respond?
          </h2>
          <div role="radiogroup" aria-labelledby="deck-title" className="mt-4 grid gap-2.5">
            {TACTICS.map((t) => {
              const active = tactic === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => chooseTactic(t.key)}
                  className={`lift flex items-center gap-3 rounded-[12px] border-2 border-ink p-2 text-left ${active ? 'bg-yellow' : 'bg-paper hover:bg-cream'}`}
                >
                  <TacticGlyph tactic={t.key} threat={keyThreat?.name} />
                  <span>
                    <span className="block font-[800] leading-tight">
                      {t.key === 'mark_threat' && keyThreat ? `Mark ${shortName(keyThreat.name)}` : t.title}
                    </span>
                    {/* Eight plans: only the chosen one explains itself, so the deck stays short. */}
                    <span className={`text-sm leading-snug text-ink-soft ${active ? 'block' : 'sr-only'}`}>{t.blurb}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {tactic === 'custom' && (
            <div className="mt-4 rounded-[12px] border-2 border-ink bg-cream p-3">
              <PlanBuilder dials={dials} onChange={setDial} threatName={keyThreat ? shortName(keyThreat.name) : undefined} />
              <label htmlFor="plan" className="mt-3 block text-sm font-[750]">
                A note for the pundit <span className="font-semibold text-ink-soft">(optional)</span>
              </label>
              <textarea
                id="plan"
                value={plan}
                onChange={(e) => writeNote(e.target.value)}
                maxLength={600}
                rows={2}
                placeholder={`e.g. Sit deep, double up on ${keyThreat ? shortName(keyThreat.name) : 'their winger'} and break.`}
                className="mt-1 w-full resize-y rounded-[10px] border-2 border-ink bg-paper px-3 py-2 text-sm leading-snug focus:outline-none focus-visible:outline-3 focus-visible:outline-sky-deep"
              />
              <p className="mt-1 text-xs text-ink-soft">Typing sets any dials you haven't picked. Then drag players to match: the shape counts as much as the plan.</p>
            </div>
          )}

          {tactic && tactic !== 'custom' && (
            <p className="mt-4 rounded-[10px] bg-cream px-3 py-2.5 text-sm">
              Players moved into a starting shape for this plan. Fine-tune it on the pitch.
            </p>
          )}

          {paused && <PausedScore engine={paused} detail={detail} />}
          <button
            type="button"
            className="btn btn-primary lift mt-5 w-full text-lg"
            disabled={!tactic}
            onClick={paused ? resume : kickOff}
          >
            {paused ? 'Resume the match' : 'Blow the whistle'}
          </button>
          {!tactic && <p className="mt-2 text-center text-sm text-ink-soft">Pick a plan to play it out.</p>}
          {!paused && tactic && (
            <p className="mt-2 text-center text-sm text-ink-soft">The match plays out live. You can stop it and change things.</p>
          )}
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-1">
        <PlayerDesk selected={selectedPlayer ?? null} board={board} onSubbed={(id) => setSelected(id)} />
      </div>
    </div>
  )
}

/** The parts of a set-up that count as a change worth logging. */
interface Snapshot {
  tactic: TacticKey | null
  plan: string
  placements: string
  subs: number
}

/** What the manager changed while the clock was stopped, for the match log. */
function describeChange(before: Snapshot | null, after: Snapshot, board: ReturnType<typeof useBoard>) {
  if (!before) return null
  const parts: string[] = []
  if (after.tactic !== before.tactic || (after.tactic === 'custom' && after.plan.trim() !== before.plan.trim())) {
    const title = TACTICS.find((t) => t.key === after.tactic)?.title ?? 'a new plan'
    parts.push(after.tactic === 'custom' ? 'set new dials for your own plan' : `switched to ${title.toLowerCase()}`)
  }
  for (const sub of board.subs.slice(before.subs)) {
    const on = board.side.bench.find((b) => b.id === sub.on_id)?.name
    const off = [...board.side.players, ...board.side.bench].find((p) => p.id === sub.off_id)?.name
    parts.push(`${on} on for ${off}`)
  }
  if (!parts.length && after.placements !== before.placements) parts.push('reshaped the team')
  if (!parts.length) return null
  const text = parts.join(', ')
  return text[0].toUpperCase() + text.slice(1) + '.'
}

function PausedScore({ engine, detail }: { engine: LiveEngine; detail: ScenarioDetail }) {
  const snap = detail.snapshot
  const side = snap.sides[String(engine.teamId)]
  const home = snap.sides[String(snap.match.home_team_id)]
  const away = snap.sides[String(snap.match.away_team_id)]
  const { for: f, against: a } = engine.score
  const score = side.is_home ? { home: f, away: a } : { home: a, away: f }
  const left = Math.max(0, Math.round((engine.end - engine.t) / 60))
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] bg-ink px-3 py-2.5 text-cream">
      <span className="score whitespace-nowrap text-xl tabular-nums">
        {home.code} {score.home}–{score.away} {away.code}
      </span>
      <span className="text-sm font-semibold">
        {clock(engine.t)}, about {left} min left
      </span>
    </div>
  )
}

function CoverageMeter({ value, real, opponent }: { value: number; real: number; opponent: string }) {
  const delta = value - real
  return (
    <div className="flex min-w-[240px] flex-1 items-center gap-3" aria-live="polite">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          Cover of {opponent}'s danger areas{' '}
          <span className="score-narrow text-base tabular-nums">{value}%</span>
          <span className={`ml-1.5 text-sm font-semibold tabular-nums ${delta > 0 ? 'text-pitch-deep' : delta < 0 ? 'text-vermilion-deep' : 'text-ink-soft'}`}>
            {delta === 0 ? 'same as the real shape' : `${delta > 0 ? '+' : ''}${delta} on the real shape`}
          </span>
        </p>
        <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full border-2 border-ink bg-cream">
          <div className="h-full transition-[width] duration-150" style={{ width: `${value}%`, background: 'var(--kit-you, var(--color-sky))' }} />
          <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${real}%` }} title="Real shape" />
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${checked ? 'bg-ink text-cream' : 'bg-paper hover:bg-cream-deep'}`}
    >
      {children}
    </button>
  )
}

function PlayerDesk({
  selected,
  board,
  onSubbed,
}: {
  selected: ReturnType<typeof useBoard>['onPitch'][number] | null
  board: ReturnType<typeof useBoard>
  onSubbed: (id: number) => void
}) {
  const canSub = board.subsLeft > 0
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? board.bench : board.bench.slice(0, 6)
  return (
    <section aria-labelledby="bench-title" className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bench-title" className="text-xl font-[850]">
          Bench
        </h2>
        <p className="text-sm font-semibold text-ink-soft">
          {board.subsLeft > 0 ? `${board.subsLeft} substitution${board.subsLeft === 1 ? '' : 's'} left` : 'No substitutions left'}
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {selected
          ? canSub
            ? `Pick who replaces ${selected.name} (${selected.position}).`
            : `${selected.name} stays on: you've used every substitution.`
          : 'Select a player on the pitch, then choose who comes on.'}
      </p>

      {board.subs.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {board.subs.map((s) => {
            const on = board.side.bench.find((b) => b.id === s.on_id)
            const off = [...board.side.players, ...board.side.bench].find((p) => p.id === s.off_id)
            return (
              <li key={`${s.off_id}-${s.on_id}`} className="flex items-center gap-2 rounded-full border-2 border-ink bg-yellow py-1 pl-3 pr-1 text-sm font-semibold">
                {on?.name} on, {off?.name} off
                {board.isLocked(s) ? (
                  <span className="p-1" title="Already made in the match">
                    <Lock size={14} strokeWidth={2.5} aria-label="Already made in the match" />
                  </span>
                ) : (
                  <button type="button" onClick={() => board.undoSub(s)} className="rounded-full p-1 hover:bg-paper" aria-label={`Undo: ${on?.name} for ${off?.name}`}>
                    <Undo2 size={14} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              disabled={!selected || !canSub}
              onClick={() => {
                if (!selected) return
                board.substitute(selected.id, b.id)
                onSubbed(b.id)
              }}
              className="flex w-full items-center gap-3 rounded-[10px] border-2 border-ink bg-cream px-2.5 py-2 text-left enabled:hover:bg-yellow disabled:cursor-not-allowed disabled:border-ink/30"
            >
              <span className="score-narrow grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink text-sm" style={{ background: 'var(--kit-you, var(--color-sky))', color: 'var(--kit-you-ink, var(--color-ink))' }}>
                {b.number ?? ''}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-[750] leading-tight">{b.name}</span>
                {b.position && <span className="block truncate text-xs text-ink-soft">{b.position}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {board.bench.length > 6 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-semibold underline">
          {showAll ? 'Show fewer' : `Show all ${board.bench.length} on the bench`}
        </button>
      )}
    </section>
  )
}
