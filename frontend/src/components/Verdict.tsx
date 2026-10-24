import { Check, Minus, X } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Link } from 'react-router'
import type { ScenarioDetail, SimulationResult } from '../lib/types'
import { mirror, Pitch, toTokens } from './Pitch'
import { ShareTicket } from './ShareTicket'

interface VerdictProps {
  detail: ScenarioDetail
  result: SimulationResult
  onRetry: () => void
}

export function Verdict({ detail, result, onRetry }: VerdictProps) {
  const snap = detail.snapshot
  const side = snap.sides[String(result.team_id)]
  const opp = snap.sides[String(result.opponent_id)]
  const p = result.projection
  const actual = result.actual
  const home = snap.sides[String(snap.match.home_team_id)]
  const away = snap.sides[String(snap.match.away_team_id)]

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 sm:py-12">
      {/* Rating and the pundit */}
      <section aria-labelledby="verdict-title" className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-14">
        <RatingStamp rating={result.gaffer_rating} label={result.rating_label} />
        <div>
          <h1 id="verdict-title" className="max-w-[22ch] text-[clamp(2.1rem,4.6vw,3.6rem)] font-[850] leading-[1.02]">
            {result.pundit.headline}
          </h1>
          <blockquote className="mt-5 max-w-[64ch] text-lg leading-relaxed sm:text-xl">{result.pundit.take}</blockquote>
          <p className="mt-3 text-sm text-ink-soft">
            The Pundit's Take, {result.pundit.source === 'gemini' ? 'written by Gemini from the model’s numbers' : 'written by the TACTIX model'}.
            {result.tactic === 'custom' && result.plan_source === 'gemini' && ' Your plan was read by Gemini.'}
          </p>
        </div>
      </section>

      {/* Your minutes against the real ones */}
      <section aria-labelledby="compare-title" className="mt-14 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          <div className="border-b-2 border-ink px-4 py-3 sm:px-5">
            <h2 className="text-xl font-[850]">Where it could still go wrong</h2>
            <p className="text-sm text-ink-soft">Your final shape. Numbered zones are the gaps {opp.name} could still use.</p>
          </div>
          <Pitch
            label={`Your final shape with ${result.exposed_zones.length} exposed zones marked`}
            you={toTokens(result.lineup)}
            them={toTokens(opp.players).map(mirror)}
            keyThreatId={side.key_threat?.player_id}
            zones={result.exposed_zones}
            showNames={false}
          />
          {result.exposed_zones.length > 0 ? (
            <ol className="grid gap-x-6 gap-y-2 border-t-2 border-ink px-4 py-3 text-sm sm:grid-cols-3 sm:px-5">
              {result.exposed_zones.map((z, i) => (
                <li key={i} className="flex gap-2">
                  <span className="score-narrow grid size-6 shrink-0 place-items-center rounded-full bg-ink text-xs text-yellow">{i + 1}</span>
                  <span>
                    {z.label}
                    <span className="block text-ink-soft">{Math.round(z.share * 100)}% of their threat left open</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="border-t-2 border-ink px-4 py-3 text-sm sm:px-5">No big gaps: every area {opp.name} attacked through has someone nearby.</p>
          )}
        </div>

        <div className="panel p-4 sm:p-5">
          <h2 id="compare-title" className="text-xl font-[850]">
            Your {p.minutes} minutes against the real ones
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Expected goals from minute {snap.minute} to full time.</p>
          <XgCompare
            rows={[
              { label: 'Your plan', note: 'model projection', for: p.xg_for, against: p.xg_against, strong: true },
              { label: 'If nothing changed', note: 'same shape, same plan', for: p.baseline_xg_for, against: p.baseline_xg_against },
              { label: 'What really happened', note: 'StatsBomb xG', for: actual.xg_for_after, against: actual.xg_against_after },
            ]}
            you={side.code}
            them={opp.code}
          />

          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[10px] bg-cream p-3">
              <dt className="text-sm font-semibold text-ink-soft">Model's likeliest finish</dt>
              <dd className="score mt-1 whitespace-nowrap text-2xl">
                {home.code} {p.likely_score.home}–{p.likely_score.away} {away.code}
              </dd>
            </div>
            <div className="rounded-[10px] bg-cream p-3">
              <dt className="text-sm font-semibold text-ink-soft">Real full time</dt>
              <dd className="score mt-1 whitespace-nowrap text-2xl">
                {home.code} {actual.score_at_full_time.home}–{actual.score_at_full_time.away} {away.code}
              </dd>
            </div>
          </dl>
          <RealStory detail={detail} actual={actual} />
        </div>
      </section>

      {/* Findings and shape numbers */}
      <section className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <div className="panel p-4 sm:p-5">
          <h2 className="text-xl font-[850]">What the model saw</h2>
          <ul className="mt-3 grid gap-2.5">
            {result.findings.map((f, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink ${
                    f.tone === 'good' ? 'bg-pitch' : f.tone === 'bad' ? 'bg-vermilion' : 'bg-cream'
                  }`}
                  aria-label={f.tone === 'good' ? 'Strength' : f.tone === 'bad' ? 'Risk' : 'Note'}
                >
                  {f.tone === 'good' ? <Check size={14} strokeWidth={3} /> : f.tone === 'bad' ? <X size={14} strokeWidth={3} /> : <Minus size={14} strokeWidth={3} />}
                </span>
                <span className="leading-snug">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel p-4 sm:p-5">
          <h2 className="text-xl font-[850]">Your shape in numbers</h2>
          <table className="mt-3 w-full text-left">
            <thead>
              <tr className="border-b-2 border-ink text-sm text-ink-soft">
                <th className="py-2 font-semibold">Measure</th>
                <th className="py-2 text-right font-semibold">Real</th>
                <th className="py-2 text-right font-semibold">Yours</th>
              </tr>
            </thead>
            <tbody>
              {result.metrics.map((m) => {
                const diff = m.value - m.baseline
                const better = m.better === 'context' || diff === 0 ? null : (m.better === 'higher') === diff > 0
                return (
                  <tr key={m.key} className="border-b border-ink/15 last:border-0">
                    <td className="py-2.5 pr-3">{m.label}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-soft">
                      {m.baseline}
                      {m.unit && <span className="ml-0.5 text-sm">{m.unit}</span>}
                    </td>
                    <td className={`py-2.5 text-right font-[800] tabular-nums ${better === true ? 'text-pitch-deep' : better === false ? 'text-vermilion-deep' : ''}`}>
                      {m.value}
                      {m.unit && <span className="ml-0.5 text-sm">{m.unit}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-4 text-sm text-ink-soft">{result.model_note}</p>
        </div>
      </section>

      {/* Share and replay */}
      <section aria-labelledby="replay-title" className="mt-14 grid gap-8 border-t-2 border-ink pt-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <h2 id="replay-title" className="text-[clamp(2rem,4vw,3rem)] font-[850] leading-[1.02]">
            Would something else have worked?
          </h2>
          <p className="mt-3 max-w-[52ch] text-lg text-ink-soft">
            Your shape is kept, so you can change one thing and see what moves.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={onRetry} className="btn btn-primary lift">
              Try another plan
            </button>
            <Link to={`/play/${detail.slug}?team=${opp.team_id}`} className="btn btn-plain lift">
              Manage {opp.name} instead
            </Link>
            <Link to="/" className="btn btn-plain lift">
              Pick another moment
            </Link>
          </div>
        </div>
        <ShareTicket detail={detail} result={result} />
      </section>
    </div>
  )
}

function RatingStamp({ rating, label }: { rating: number; label: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { scale: 1.6, rotate: -18, opacity: 0 }}
      animate={{ scale: 1, rotate: -6, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18, mass: 1.1, delay: 0.15 }}
      className="relative mx-auto grid size-[clamp(15rem,30vw,19rem)] shrink-0 place-items-center rounded-full border-[3px] border-ink bg-yellow lg:mx-0"
      role="img"
      aria-label={`Gaffer Rating ${rating} out of 10: ${label}`}
    >
      <div className="absolute inset-3 rounded-full border-2 border-dashed border-ink" />
      <div className="text-center">
        <p className="text-sm font-[800]">Gaffer Rating</p>
        <p className="score mt-1 text-[clamp(4.5rem,9vw,6.25rem)]">{rating.toFixed(1)}</p>
        <p className="mt-2 inline-block rounded-full bg-ink px-3 py-1 text-sm font-[750] text-cream">{label}</p>
      </div>
    </motion.div>
  )
}

interface XgRow {
  label: string
  note: string
  for: number
  against: number
  strong?: boolean
}

function XgCompare({ rows, you, them }: { rows: XgRow[]; you: string; them: string }) {
  const max = Math.max(0.5, ...rows.flatMap((r) => [r.for, r.against]))
  const bar = (v: number, color: string) => (
    <div className="h-3 flex-1 overflow-hidden rounded-full bg-cream">
      <div className={`h-full rounded-full border-ink ${v > 0 ? 'border-2' : ''}`} style={{ width: `${(v / max) * 100}%`, background: color }} />
    </div>
  )
  return (
    <div className="mt-4 grid gap-4">
      {rows.map((r) => (
        <div key={r.label} className={r.strong ? 'rounded-[10px] border-2 border-ink p-3' : 'px-3'}>
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-[800]">{r.label}</span>
            <span className="text-xs text-ink-soft">{r.note}</span>
          </p>
          <div className="mt-2 grid gap-1.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-10 font-semibold">{you}</span>
              {bar(r.for, 'var(--kit-you, var(--color-sky))')}
              <span className="w-10 text-right tabular-nums">{r.for.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 font-semibold">{them}</span>
              {bar(r.against, 'var(--kit-them, var(--color-vermilion))')}
              <span className="w-10 text-right tabular-nums">{r.against.toFixed(2)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RealStory({ detail, actual }: { detail: ScenarioDetail; actual: SimulationResult['actual'] }) {
  const snap = detail.snapshot
  const goals = actual.goals_after
  const { home, away } = snap.match
  let ending = `Final score ${home} ${actual.final_score.home}–${actual.final_score.away} ${away}.`
  if (actual.shootout) {
    const [a, b] = Object.entries(actual.shootout).sort((x, y) => y[1] - x[1])
    ending = `${actual.final_score.home}–${actual.final_score.away} after extra time. ${a[0]} won the shootout ${a[1]}–${b[1]}.`
  } else if (actual.went_to_extra_time) {
    ending = `${home} ${actual.final_score.home}–${actual.final_score.away} ${away} after extra time.`
  }
  return (
    <div className="mt-5 border-t-2 border-ink pt-4">
      <h3 className="font-[800]">What really happened next</h3>
      {goals.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-sm">
          {goals.map((g, i) => (
            <li key={i} className="flex gap-3">
              <span className="score-narrow w-9 tabular-nums">{g.minute}'</span>
              <span>
                {g.player} <span className="text-ink-soft">({g.team})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm">No more goals.</p>
      )}
      <p className="mt-2 text-sm font-semibold">{ending}</p>
    </div>
  )
}
