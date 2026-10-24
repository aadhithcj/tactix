import { useMutation, useQuery } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { competitionName, Scoreline, SiteFooter, SiteHeader, teamCode } from '../components/Chrome'
import { PassNetworkView } from '../components/PassNetwork'
import { ShotMap } from '../components/ShotMap'
import { api } from '../lib/api'
import { kitFor, kitVars } from '../lib/kits'
import type { MatchDetail, MomentumBucket, PassNetwork, TeamStats } from '../lib/types'

type Tab = 'shots' | 'network' | 'momentum'

export default function Analyst() {
  const { matchId } = useParams()
  const matches = useQuery({ queryKey: ['matches'], queryFn: api.matches })

  if (!matchId && matches.data?.length) return <Navigate to={`/analyst/${matches.data[0].id}`} replace />

  return (
    <>
      <SiteHeader tone="paper" />
      <main id="main" className="min-h-[70vh] bg-cream">
        {matches.error && (
          <p role="alert" className="mx-auto max-w-[720px] px-4 py-24 text-lg font-semibold">
            Couldn't load the match list: {matches.error.message}
          </p>
        )}
        {matches.data && matches.data.length === 0 && (
          <div className="mx-auto max-w-[720px] px-4 py-24">
            <h1 className="text-3xl font-[850]">No matches loaded yet</h1>
            <p className="mt-3 text-lg text-ink-soft">
              Run <code className="rounded bg-paper px-1.5 py-0.5">python scripts/seed_db.py</code> on the server to load
              StatsBomb data.
            </p>
          </div>
        )}
        {matchId && <MatchView id={Number(matchId)} all={matches.data ?? []} />}
      </main>
      <SiteFooter />
    </>
  )
}

function MatchView({ id, all }: { id: number; all: { id: number; home_team: { name: string } | null; away_team: { name: string } | null; season: string; competition: string }[] }) {
  const navigate = useNavigate()
  const match = useQuery({ queryKey: ['match', id], queryFn: () => api.match(id) })
  const [tab, setTab] = useState<Tab>('shots')
  const pickerId = useId()

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(2rem,4vw,3rem)] font-[850] leading-[1]">Analyst Mode</h1>
          <p className="mt-2 max-w-[60ch] text-ink-soft">The evidence behind every moment, straight from the match event data.</p>
        </div>
        {all.length > 0 && (
          <div className="w-full sm:w-auto">
            <label htmlFor={pickerId} className="block text-sm font-semibold">
              Match
            </label>
            <select
              id={pickerId}
              value={id}
              onChange={(e) => navigate(`/analyst/${e.target.value}`)}
              className="mt-1 min-h-11 w-full max-w-full rounded-[10px] border-2 border-ink bg-paper px-3 pr-8 font-semibold sm:w-auto"
            >
              {all.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.home_team?.name} v {m.away_team?.name}, {competitionName(m.competition)} {m.season}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {match.isPending && <div className="mt-8 h-96 rounded-[14px] border-2 border-ink bg-cream-deep" aria-busy="true" />}
      {match.error && (
        <p role="alert" className="panel mt-8 p-5 font-semibold">
          {match.error.message}
        </p>
      )}
      {match.data && (
        <div style={kitVars(match.data.home_team?.name ?? '', match.data.away_team?.name ?? '')}>
          <MatchHeader match={match.data} />
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="panel min-w-0 overflow-hidden" aria-label="Match charts">
              <div role="tablist" aria-label="Chart" className="flex gap-1 overflow-x-auto border-b-2 border-ink p-2.5">
                {(
                  [
                    ['shots', 'Shot map', 'Shots'],
                    ['network', 'Passing network', 'Passing'],
                    ['momentum', 'Momentum', 'Momentum'],
                  ] as [Tab, string, string][]
                ).map(([key, label, short]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-semibold sm:px-4 sm:text-base ${tab === key ? 'bg-ink text-cream' : 'hover:bg-cream-deep'}`}
                  >
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
              <div role="tabpanel">
                {tab === 'shots' && <ShotsTab match={match.data} />}
                {tab === 'network' && <NetworkTab match={match.data} />}
                {tab === 'momentum' && <MomentumTab timeline={match.data.stats.momentum_timeline ?? []} />}
              </div>
            </section>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6">
              <AskPanel matchId={id} />
              {match.data.scenario_slugs.length > 0 && (
                <div className="panel bg-yellow p-5">
                  <h2 className="text-xl font-[850]">Think you'd have done better?</h2>
                  <p className="mt-1">This match has a moment you can manage.</p>
                  {match.data.scenario_slugs.map((slug) => (
                    <Link key={slug} to={`/play/${slug}`} className="btn btn-ink lift mt-4">
                      Play the moment
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MatchHeader({ match }: { match: MatchDetail }) {
  const teams = match.stats.team_stats?.teams ?? {}
  const home = teams[String(match.home_team_id)]
  const away = teams[String(match.away_team_id)]
  const homeName = match.home_team?.name ?? 'Home'
  const awayName = match.away_team?.name ?? 'Away'
  return (
    <section className="panel mt-8 grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-12" aria-label="Match summary">
      <div>
        <Scoreline home={teamCode(homeName)} away={teamCode(awayName)} score={{ home: match.home_score, away: match.away_score }} size="lg" />
        <p className="mt-2 text-sm text-ink-soft">
          {competitionName(match.competition)} {match.season},{' '}
          {new Date(match.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Score after
          extra time where played; shootouts not included.
        </p>
      </div>
      {home && away && <TeamCompare home={home} away={away} />}
    </section>
  )
}

function TeamCompare({ home, away }: { home: TeamStats; away: TeamStats }) {
  const rows: [string, number, number, (v: number) => string][] = [
    ['Expected goals', home.total_xg, away.total_xg, (v) => v.toFixed(2)],
    ['Shots', home.total_shots, away.total_shots, (v) => String(v)],
    ['Share of passes', home.possession_pct, away.possession_pct, (v) => `${v}%`],
    ['Pass accuracy', home.pass_accuracy_pct, away.pass_accuracy_pct, (v) => `${v}%`],
  ]
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        {home.name} compared with {away.name}
      </caption>
      <thead>
        <tr>
          <th className="w-16 pb-2 text-left font-[800]">{teamCode(home.name)}</th>
          <th className="pb-2" />
          <th className="w-16 pb-2 text-right font-[800]">{teamCode(away.name)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, h, a, fmt]) => {
          const total = h + a || 1
          return (
            <tr key={label}>
              <td className="score-narrow py-1.5 text-lg">{fmt(h)}</td>
              <td className="px-3 py-1.5">
                <span className="block text-center text-xs text-ink-soft">{label}</span>
                <span className="mt-1 flex h-2.5 overflow-hidden rounded-full border-2 border-ink">
                  <span style={{ width: `${(h / total) * 100}%`, background: 'var(--kit-you, var(--color-sky))' }} />
                  <span className="border-l-2 border-ink" style={{ width: `${(a / total) * 100}%`, background: 'var(--kit-them, var(--color-vermilion))' }} />
                </span>
              </td>
              <td className="score-narrow py-1.5 text-right text-lg">{fmt(a)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ShotsTab({ match }: { match: MatchDetail }) {
  const shots = useQuery({ queryKey: ['shots', match.id], queryFn: () => api.shots(match.id) })
  if (!shots.data) return <div className="aspect-[3/2] bg-pitch" aria-busy="true" />
  return <ShotMap shots={shots.data} homeId={match.home_team_id} homeName={match.home_team?.name ?? 'Home'} awayName={match.away_team?.name ?? 'Away'} />
}

function NetworkTab({ match }: { match: MatchDetail }) {
  const networks = match.stats.pass_networks ?? {}
  const [teamId, setTeamId] = useState(String(match.home_team_id))
  const net: PassNetwork | undefined = networks[teamId]
  if (!net?.nodes?.length) {
    return <p className="p-6">No passing network for this match yet. Re-run the seeder to compute one.</p>
  }
  const isHome = teamId === String(match.home_team_id)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex gap-1.5" role="group" aria-label="Team">
          {[match.home_team, match.away_team].map((t, i) =>
            t ? (
              <button
                key={t.id}
                type="button"
                aria-pressed={teamId === String(t.id)}
                onClick={() => setTeamId(String(t.id))}
                className={`rounded-full border-2 border-ink px-3 py-1 text-sm font-semibold ${teamId === String(t.id) ? '' : 'bg-paper hover:bg-cream-deep'}`}
                style={teamId === String(t.id) ? { background: kitFor(t.name, i ? 'away' : 'home').fill, color: kitFor(t.name, i ? 'away' : 'home').ink } : undefined}
              >
                {t.name}
              </button>
            ) : null,
          )}
        </div>
        <p className="text-sm text-ink-soft">Attacking right. Point at a player or a pair to trace their links.</p>
      </div>
      <div className="border-t-2 border-ink">
        <PassNetworkView key={teamId} net={net} kit={kitFor(net.team_name, isHome ? 'home' : 'away')} />
      </div>
    </div>
  )
}

function MomentumTab({ timeline }: { timeline: MomentumBucket[] }) {
  if (!timeline.length) return <p className="p-6">No momentum data for this match.</p>
  const max = Math.max(...timeline.map((b) => Math.abs(b.momentum)), 0.5)
  const W = 120
  const H = 64
  const mid = H / 2
  const bw = W / timeline.length
  const home = timeline[0].team_home
  const away = timeline[0].team_away
  return (
    <div className="p-4 sm:p-5">
      <p className="text-sm text-ink-soft">
        Each bar is five minutes. Up means {home} were on top, down means {away}. Built from xG and forward passes.
      </p>
      <svg viewBox={`0 0 ${W} ${H + 8}`} className="mt-3 block w-full" role="img" aria-label={`Momentum by five-minute spell, ${home} above the line and ${away} below`}>
        {[45, 90, 105].map((m) => {
          const x = (m / 5) * bw
          return x < W ? (
            <g key={m}>
              <line x1={x} y1={2} x2={x} y2={H - 2} stroke="var(--color-ink)" strokeWidth={0.2} strokeDasharray="1 1" />
              <text x={x + 0.8} y={4.5} fontSize={2.4} fill="var(--color-ink-soft)">
                {m}'
              </text>
            </g>
          ) : null
        })}
        {timeline.map((b, i) => {
          const h = (Math.abs(b.momentum) / max) * (mid - 4)
          const up = b.momentum >= 0
          return (
            <rect key={b.interval} x={i * bw + bw * 0.12} y={up ? mid - h : mid} width={bw * 0.76} height={Math.max(h, 0.3)} rx={0.6} fill={up ? 'var(--kit-you, var(--color-sky))' : 'var(--kit-them, var(--color-vermilion))'} stroke="var(--color-ink)" strokeWidth={0.3}>
              <title>{`Minutes ${b.interval}: xG ${b.home_xg.toFixed(2)} v ${b.away_xg.toFixed(2)}, forward passes ${b.home_progressive_passes} v ${b.away_progressive_passes}`}</title>
            </rect>
          )
        })}
        <line x1={0} y1={mid} x2={W} y2={mid} stroke="var(--color-ink)" strokeWidth={0.5} />
        {[0, 30, 60, 90, 120].map((m) => {
          const x = (m / 5) * bw
          return x <= W ? (
            <text key={m} x={Math.min(x, W - 4)} y={H + 6} fontSize={2.6} fill="var(--color-ink-soft)">
              {m}'
            </text>
          ) : null
        })}
      </svg>
      <ul className="mt-3 flex gap-4 text-sm">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border-2 border-ink" style={{ background: 'var(--kit-you, var(--color-sky))' }} />
          {home}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border-2 border-ink" style={{ background: 'var(--kit-them, var(--color-vermilion))' }} />
          {away}
        </li>
      </ul>
    </div>
  )
}

const SUGGESTIONS = ['Who created the better chances?', 'When did the momentum swing?', 'How did the passing compare?']

function AskPanel({ matchId }: { matchId: number }) {
  const [question, setQuestion] = useState('')
  const [log, setLog] = useState<{ q: string; a: string; source: string }[]>([])
  const ask = useMutation({
    mutationFn: (q: string) => api.ask(matchId, q),
    onSuccess: (res, q) => setLog((l) => [...l, { q, a: res.answer, source: res.source }]),
  })
  const submit = (q: string) => {
    const text = q.trim()
    if (text.length < 2 || ask.isPending) return
    ask.mutate(text)
    setQuestion('')
  }
  return (
    <section className="panel p-5" aria-labelledby="ask-title">
      <h2 id="ask-title" className="text-xl font-[850]">
        Ask the analyst
      </h2>
      <p className="mt-1 text-sm text-ink-soft">Answers come only from this match's data.</p>
      <div className="mt-3 grid gap-3" aria-live="polite">
        {log.map((item, i) => (
          <div key={i}>
            <p className="ml-auto w-fit max-w-[90%] rounded-[12px] rounded-br-sm bg-ink px-3 py-2 text-sm text-cream">{item.q}</p>
            <p className="mt-2 max-w-[95%] rounded-[12px] rounded-bl-sm bg-cream px-3 py-2 text-sm leading-relaxed">{item.a}</p>
          </div>
        ))}
        {ask.isPending && <p className="text-sm font-semibold text-ink-soft">Checking the data…</p>}
        {ask.error && (
          <p role="alert" className="text-sm font-semibold text-vermilion-deep">
            {ask.error.message}
          </p>
        )}
      </div>
      {log.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border-2 border-ink bg-paper px-3 py-1 text-sm font-semibold hover:bg-yellow">
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(question)
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Your question
        </label>
        <input
          id="ask"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={400}
          placeholder="Ask about this match"
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border-2 border-ink bg-cream px-3 focus:bg-paper"
        />
        <button type="submit" className="btn btn-primary lift px-3" disabled={ask.isPending || question.trim().length < 2} aria-label="Ask">
          <Send size={18} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}
