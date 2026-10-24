import { useMutation, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ScoreBug, SiteFooter, SiteHeader, teamCode } from '../components/Chrome'
import { api } from '../lib/api'
import type { CatalogCompetition, CatalogMatch } from '../lib/types'

const MIN_MINUTE = 5
const MAX_MINUTE = 85
const QUICK_MINUTES = [30, 45, 60, 75]

const seasonKey = (c: Pick<CatalogCompetition, 'competition_id' | 'season_id'>) => `${c.competition_id}:${c.season_id}`

export default function AnyMatch() {
  const navigate = useNavigate()
  const competitions = useQuery({ queryKey: ['catalog', 'competitions'], queryFn: api.competitions, staleTime: Infinity })
  const [season, setSeason] = useState('')
  const [query, setQuery] = useState('')
  const [match, setMatch] = useState<CatalogMatch | null>(null)
  const [minute, setMinute] = useState(60)
  const ids = { comp: useId(), search: useId(), minute: useId() }

  const [competitionId, seasonId] = season ? season.split(':').map(Number) : [0, 0]
  const matches = useQuery({
    queryKey: ['catalog', 'matches', season],
    queryFn: () => api.catalogMatches(competitionId, seasonId),
    enabled: Boolean(season),
    staleTime: Infinity,
  })

  // One optgroup per competition, newest season first.
  const groups = useMemo(() => {
    const byName = new Map<string, CatalogCompetition[]>()
    for (const c of competitions.data ?? []) {
      const name = `${c.competition}${c.gender === 'female' ? " (women's)" : ''}`
      byName.set(name, [...(byName.get(name) ?? []), c])
    }
    return [...byName.entries()]
      .map(([name, seasons]) => [name, seasons.sort((a, b) => b.season.localeCompare(a.season))] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [competitions.data])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = matches.data ?? []
    return q ? list.filter((m) => `${m.home} ${m.away} ${m.stage}`.toLowerCase().includes(q)) : list
  }, [matches.data, query])

  const build = useMutation({
    mutationFn: () => api.createMoment({ competition_id: competitionId, season_id: seasonId, match_id: match!.match_id, minute }),
    onSuccess: ({ slug }) => navigate(`/play/${slug}`),
  })

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-cream">
        <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="max-w-[16ch] text-[clamp(2.4rem,5vw,4rem)] font-[850] leading-[1]">Pick any match</h1>
          <p className="mt-4 max-w-[58ch] text-body text-ink-soft">
            Every match in StatsBomb's free data, from Champions League finals to Arsenal's Invincibles. Freeze it at any
            minute, take a side, and make the call.
          </p>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] lg:items-start">
            <section className="panel p-4 sm:p-6" aria-labelledby="choose-title">
              <h2 id="choose-title" className="sr-only">
                Choose a match
              </h2>
              <label htmlFor={ids.comp} className="text-lg font-[800]">
                Competition
              </label>
              {competitions.error ? (
                <p role="alert" className="mt-2 font-semibold text-vermilion-deep">
                  {competitions.error.message}
                </p>
              ) : (
                <select
                  id={ids.comp}
                  value={season}
                  disabled={!competitions.data}
                  onChange={(e) => {
                    setSeason(e.target.value)
                    setMatch(null)
                    setQuery('')
                  }}
                  className="mt-2 min-h-12 w-full rounded-[10px] border-2 border-ink bg-paper px-3 text-body font-semibold"
                >
                  <option value="">{competitions.data ? 'Choose a competition and season' : 'Loading competitions…'}</option>
                  {groups.map(([name, seasons]) => (
                    <optgroup key={name} label={name}>
                      {seasons.map((c) => (
                        <option key={seasonKey(c)} value={seasonKey(c)}>
                          {c.competition} {c.season}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}

              {season && (
                <div className="mt-7">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <h3 className="text-lg font-[800]">Match</h3>
                    {matches.data && (
                      <p className="text-sm text-ink-soft">
                        {shown.length} of {matches.data.length} matches
                      </p>
                    )}
                  </div>
                  <div className="relative mt-2">
                    <Search size={18} strokeWidth={2.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
                    <label htmlFor={ids.search} className="sr-only">
                      Find a team or round
                    </label>
                    <input
                      id={ids.search}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find a team or round"
                      className="min-h-12 w-full rounded-[10px] border-2 border-ink bg-cream pl-10 pr-3 text-body focus:bg-paper"
                    />
                  </div>
                  {matches.isPending && <div className="mt-3 h-64 rounded-[10px] bg-cream-deep" aria-busy="true" />}
                  {matches.error && (
                    <p role="alert" className="mt-3 font-semibold text-vermilion-deep">
                      {matches.error.message}
                    </p>
                  )}
                  {matches.data && (
                    <ul className="mt-3 max-h-[26rem] overflow-y-auto rounded-[10px] border-2 border-ink bg-paper" aria-label="Matches">
                      {shown.length === 0 && <li className="p-4 text-ink-soft">No matches for “{query}”. Try a team name.</li>}
                      {shown.map((m, i) => {
                        const active = match?.match_id === m.match_id
                        return (
                          <li key={m.match_id} className={i ? 'border-t border-ink/15' : ''}>
                            <button
                              type="button"
                              aria-pressed={active}
                              onClick={() => setMatch(m)}
                              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-3 py-2.5 text-left sm:px-4 ${active ? 'bg-yellow' : 'hover:bg-cream'}`}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-[750]">
                                  {m.home} v {m.away}
                                </span>
                                <span className="block truncate text-sm text-ink-soft">
                                  {new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                  {m.stage && m.stage !== 'Regular Season' ? `, ${m.stage}` : ''}
                                </span>
                              </span>
                              <span className="score-narrow text-lg tabular-nums" aria-label={`Final score ${m.home_score} to ${m.away_score}`}>
                                {m.home_score}–{m.away_score}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </section>

            <section className="panel p-4 sm:p-6 lg:sticky lg:top-4" aria-labelledby="moment-title">
              <h2 id="moment-title" className="text-xl font-[850]">
                Your moment
              </h2>
              {!match ? (
                <p className="mt-2 text-body text-ink-soft">Choose a competition, then a match. You'll pick the minute here.</p>
              ) : (
                <>
                  <div className="mt-4">
                    <ScoreBug home={teamCode(match.home)} away={teamCode(match.away)} score={{ home: match.home_score, away: match.away_score }} minute={minute} size="md" />
                    <p className="mt-2 text-sm text-ink-soft">
                      {match.home} v {match.away}
                      {match.stadium ? `, ${match.stadium}` : ''}. The score shown is the final one; the board shows the
                      score at your minute.
                    </p>
                  </div>
                  <div className="mt-6">
                    <label htmlFor={ids.minute} className="flex items-baseline justify-between font-[800]">
                      Freeze it at
                      <span className="score text-4xl">{minute}'</span>
                    </label>
                    <input
                      id={ids.minute}
                      type="range"
                      min={MIN_MINUTE}
                      max={MAX_MINUTE}
                      value={minute}
                      onChange={(e) => setMinute(Number(e.target.value))}
                      className="mt-3 w-full accent-[var(--color-ink)]"
                    />
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick minutes">
                      {QUICK_MINUTES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={minute === m}
                          onClick={() => setMinute(m)}
                          className={`min-h-11 rounded-full border-2 border-ink px-3.5 font-[750] ${minute === m ? 'bg-ink text-cream' : 'bg-paper hover:bg-cream-deep'}`}
                        >
                          {m}'
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => build.mutate()} disabled={build.isPending} className="btn btn-primary lift mt-7 w-full min-h-14 text-lg">
                    {build.isPending ? 'Building the moment…' : 'Build this moment'}
                  </button>
                  <p className="mt-2 text-sm text-ink-soft" aria-live="polite">
                    {build.isPending
                      ? 'Fetching every event from the match. The first time takes a few seconds.'
                      : 'You can play either side once it’s built.'}
                  </p>
                  {build.error && (
                    <p role="alert" className="mt-3 rounded-[10px] border-2 border-vermilion-deep bg-vermilion/15 px-3 py-2 text-sm font-semibold">
                      {build.error.message}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
