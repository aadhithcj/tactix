import { useMutation, useQuery } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ScoreBug, SiteFooter, SiteHeader, teamCode } from '../components/Chrome'
import { Listbox } from '../components/Listbox'
import { api } from '../lib/api'
import { codeFor, knownKit } from '../lib/kits'
import type { LibraryMatch, LibrarySeason } from '../lib/types'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

const MIN_MINUTE = 5
const MAX_MINUTE = 85
const QUICK_MINUTES = [30, 45, 60, 75]
const PAGE = 40

// National-team tournaments; everything else in the open data is club football.
const INTERNATIONAL = new Set([
  'FIFA World Cup',
  'UEFA Euro',
  'Copa America',
  'African Cup of Nations',
  'FIFA U20 World Cup',
  "Women's World Cup",
  "UEFA Women's Euro",
])

type Gender = 'male' | 'female'

interface CompetitionGroup {
  name: string
  international: boolean
  seasons: LibrarySeason[]
  matches: number
  years: string
}

const yearOf = (season: string) => season.slice(-4)

function yearsLabel(seasons: LibrarySeason[]) {
  const years = seasons.map((s) => Number(yearOf(s.season))).filter(Boolean)
  const lo = Math.min(...years)
  const hi = Math.max(...years)
  return lo === hi ? String(lo) : `${lo}–${hi}`
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export default function AnyMatch() {
  const navigate = useNavigate()
  const reduce = usePrefersReducedMotion()
  // Arriving from Analyst Mode's "Choose any match" makes analysing the main action.
  const analyseFirst = useSearchParams()[0].get('mode') === 'analyse'
  const library = useQuery({
    queryKey: ['catalog', 'library'],
    queryFn: api.library,
    staleTime: Infinity,
    // The server builds the library on first use; check back until it's ready.
    refetchInterval: (q) => (q.state.data?.ready === false ? 2500 : false),
  })

  const [gender, setGender] = useState<Gender>('male')
  const [team, setTeam] = useState<string | null>(null)
  const [competition, setCompetition] = useState<string | null>(null)
  const [seasonKey, setSeasonKey] = useState<string | null>(null)
  const [finalsOnly, setFinalsOnly] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const [match, setMatch] = useState<LibraryMatch | null>(null)
  const [minute, setMinute] = useState(60)
  const panel = useRef<HTMLElement>(null)

  const seasons = library.data?.seasons ?? []
  const allMatches = library.data?.matches ?? []

  const seasonById = useMemo(() => new Map(seasons.map((s) => [`${s.competition_id}:${s.season_id}`, s])), [seasons])
  const seasonOf = (m: LibraryMatch) => seasonById.get(`${m.competition_id}:${m.season_id}`)

  const genderMatches = useMemo(
    () => allMatches.filter((m) => seasonById.get(`${m.competition_id}:${m.season_id}`)?.gender === gender),
    [allMatches, seasonById, gender],
  )

  const groups: CompetitionGroup[] = useMemo(() => {
    const byName = new Map<string, LibrarySeason[]>()
    for (const s of seasons) {
      if (s.gender !== gender || s.matches === 0) continue
      byName.set(s.competition, [...(byName.get(s.competition) ?? []), s])
    }
    return [...byName.entries()]
      .map(([name, list]) => ({
        name,
        international: INTERNATIONAL.has(name),
        seasons: list.sort((a, b) => b.season.localeCompare(a.season)),
        matches: list.reduce((n, s) => n + s.matches, 0),
        years: yearsLabel(list),
      }))
      .sort((a, b) => b.matches - a.matches)
  }, [seasons, gender])

  const teams: TeamEntry[] = useMemo(() => {
    const count = new Map<string, number>()
    const national = new Set<string>()
    const pool = genderMatches.filter((m) => {
      const key = `${m.competition_id}:${m.season_id}`
      return (!competition || seasonById.get(key)?.competition === competition) && (!seasonKey || key === seasonKey)
    })
    for (const m of pool) {
      const intl = INTERNATIONAL.has(seasonById.get(`${m.competition_id}:${m.season_id}`)?.competition ?? '')
      for (const t of [m.home, m.away]) {
        count.set(t, (count.get(t) ?? 0) + 1)
        if (intl) national.add(t)
      }
    }
    return [...count.entries()]
      .map(([name, n]) => ({ name, n, national: national.has(name) }))
      .sort((a, b) => pinRank(a.name) - pinRank(b.name) || b.n - a.n)
  }, [genderMatches, seasonById, competition, seasonKey])

  const filtering = Boolean(team || competition || finalsOnly)
  const results = useMemo(() => {
    let list = genderMatches
    if (team) list = list.filter((m) => m.home === team || m.away === team)
    if (competition) list = list.filter((m) => seasonById.get(`${m.competition_id}:${m.season_id}`)?.competition === competition)
    if (seasonKey) list = list.filter((m) => `${m.competition_id}:${m.season_id}` === seasonKey)
    // With nothing chosen yet, start from the finals.
    if (finalsOnly || !filtering) list = list.filter((m) => m.stage === 'Final')
    return list
  }, [genderMatches, team, competition, seasonKey, finalsOnly, filtering, seasonById])

  const activeGroup = groups.find((g) => g.name === competition)

  const pickCompetition = (name: string | null) => {
    setCompetition(name)
    setSeasonKey(null)
    setShown(PAGE)
  }

  const pickMatch = (m: LibraryMatch) => {
    setMatch(m)
    // On narrow screens the build panel sits below the list.
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }))
    }
  }

  const clearAll = () => {
    setTeam(null)
    setCompetition(null)
    setSeasonKey(null)
    setFinalsOnly(false)
    setShown(PAGE)
  }

  const build = useMutation({
    mutationFn: () =>
      api.createMoment({ competition_id: match!.competition_id, season_id: match!.season_id, match_id: match!.match_id, minute }),
    onSuccess: ({ slug }) => navigate(`/play/${slug}`),
  })

  const analyse = useMutation({
    mutationFn: () => api.analyse({ competition_id: match!.competition_id, season_id: match!.season_id, match_id: match!.match_id }),
    onSuccess: ({ match_id }) => navigate(`/analyst/${match_id}`),
  })

  const ready = library.data?.ready
  const competitionsCount = new Set(seasons.map((s) => s.competition)).size

  return (
    <>
      <SiteHeader />
      <main id="main" className="bg-cream">
        <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6 sm:py-14">
          <h1 className="max-w-[16ch] text-[clamp(2.4rem,5vw,4rem)] font-[850] leading-[1]">Pick a match</h1>
          <p className="mt-4 max-w-[62ch] text-body text-ink-soft">
            {ready
              ? `${allMatches.length.toLocaleString('en-GB')} matches across ${competitionsCount} competitions in StatsBomb's free data: World Cups, Euros, Champions League finals, Messi's Barcelona, Arsenal's Invincibles and more. Freeze one at any minute and take charge.`
              : "Every match in StatsBomb's free data: World Cups, Euros, Champions League finals, Messi's Barcelona, Arsenal's Invincibles and more. Freeze one at any minute and take charge."}
          </p>

          {library.error && (
            <p role="alert" className="panel mt-8 p-5 font-semibold">
              {library.error.message}
            </p>
          )}
          {!library.error && !ready && (
            <div className="mt-10 grid gap-3" aria-busy="true">
              <p className="font-semibold text-ink-soft" role="status">
                Loading the match library. The first visit after a deploy takes a few seconds.
              </p>
              <div className="h-14 rounded-[12px] border-2 border-ink bg-cream-deep" />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-24 rounded-[12px] border-2 border-ink/30 bg-cream-deep" />
                ))}
              </div>
            </div>
          )}

          {ready && (
            <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:items-start">
              <div className="min-w-0">
                {/* Filters */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-[850]">Find a match</h2>
                  <div role="group" aria-label="Men's or women's football" className="flex rounded-full border-2 border-ink bg-paper p-1">
                    {(
                      [
                        ['male', "Men's"],
                        ['female', "Women's"],
                      ] as [Gender, string][]
                    ).map(([g, label]) => (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={gender === g}
                        onClick={() => {
                          setGender(g)
                          clearAll()
                          setMatch(null)
                        }}
                        className={`min-h-10 rounded-full px-4 font-[750] ${gender === g ? 'bg-ink text-cream' : 'hover:bg-cream-deep'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Listbox
                    label="Team"
                    value={team ?? ''}
                    onChange={(v) => {
                      setTeam(v || null)
                      setShown(PAGE)
                    }}
                    searchPlaceholder="Find a team"
                    options={[
                      { value: '', label: 'All teams', detail: `${teams.length} teams` },
                      ...teams.map((t) => ({
                        value: t.name,
                        label: t.name,
                        detail: `${t.n} ${t.n === 1 ? 'match' : 'matches'}${t.national ? ', national team' : ''}`,
                        icon: <KitSwatch team={t.name} />,
                      })),
                    ]}
                  />
                  <Listbox
                    label="Competition"
                    value={competition ?? ''}
                    onChange={(v) => pickCompetition(v || null)}
                    options={[
                      { value: '', label: 'All competitions', detail: `${groups.length} competitions` },
                      ...[...groups.filter((g) => g.international), ...groups.filter((g) => !g.international)].map((g) => ({
                        value: g.name,
                        label: g.name,
                        detail: `${g.international ? 'International' : 'Club'}, ${g.years}, ${g.matches} ${g.matches === 1 ? 'match' : 'matches'}`,
                      })),
                    ]}
                  />
                  <Listbox
                    label="Season"
                    value={seasonKey ?? ''}
                    onChange={(v) => {
                      setSeasonKey(v || null)
                      setShown(PAGE)
                    }}
                    disabled={!activeGroup || activeGroup.seasons.length < 2}
                    options={[
                      { value: '', label: 'All seasons', detail: activeGroup ? `${activeGroup.seasons.length} seasons` : 'Choose a competition first' },
                      ...(activeGroup?.seasons ?? []).map((s) => ({
                        value: `${s.competition_id}:${s.season_id}`,
                        label: s.season,
                        detail: `${s.matches} ${s.matches === 1 ? 'match' : 'matches'}`,
                      })),
                    ]}
                  />
                </div>

                {/* Results */}
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-[850]" aria-live="polite">
                    {filtering ? `${results.length.toLocaleString('en-GB')} ${results.length === 1 ? 'match' : 'matches'}` : 'Finals to start with'}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={finalsOnly}
                      onClick={() => setFinalsOnly((f) => !f)}
                      className={`min-h-10 rounded-full border-2 border-ink px-3.5 text-sm font-[750] ${finalsOnly ? 'bg-ink text-cream' : 'bg-paper hover:bg-cream-deep'}`}
                    >
                      Finals only
                    </button>
                    {filtering && (
                      <button type="button" onClick={clearAll} className="min-h-10 px-2 text-sm font-semibold underline underline-offset-4">
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <ul className="mt-3 overflow-hidden rounded-[12px] border-2 border-ink bg-paper" aria-label="Matches">
                  {results.length === 0 && (
                    <li className="p-5 text-body text-ink-soft">
                      No matches with these filters. Try another season, or turn off “Finals only”.
                    </li>
                  )}
                  {results.slice(0, shown).map((m, i) => (
                    <MatchRow
                      key={m.match_id}
                      m={m}
                      season={seasonOf(m)}
                      first={i === 0}
                      active={match?.match_id === m.match_id}
                      onPick={() => pickMatch(m)}
                    />
                  ))}
                </ul>
                {results.length > shown && (
                  <button type="button" onClick={() => setShown((n) => n + PAGE)} className="btn btn-plain lift mt-3 min-h-12 w-full">
                    Show {Math.min(PAGE, results.length - shown)} more of {results.length - shown}
                  </button>
                )}
              </div>

              {/* Build panel */}
              <section ref={panel} className="panel scroll-mt-4 p-4 sm:p-6 lg:sticky lg:top-4" aria-labelledby="moment-title">
                <h2 id="moment-title" className="text-xl font-[850]">
                  Your moment
                </h2>
                {!match ? (
                  <p className="mt-2 text-body text-ink-soft">
                    Search a team or open a competition, then pick a match. You'll choose the minute here.
                  </p>
                ) : (
                  <MomentBuilder
                    match={match}
                    season={seasonOf(match)}
                    minute={minute}
                    setMinute={setMinute}
                    building={build.isPending}
                    analysing={analyse.isPending}
                    analyseFirst={analyseFirst}
                    error={(build.error ?? analyse.error)?.message}
                    onBuild={() => build.mutate()}
                    onAnalyse={() => analyse.mutate()}
                  />
                )}
              </section>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}


interface TeamEntry {
  name: string
  n: number
  national: boolean
}


// The sides most people come looking for go first, in this order; the rest
// follow by how many matches the library has for them.
const PINNED = [
  'Manchester United',
  'Barcelona',
  'Real Madrid',
  'Liverpool',
  'Arsenal',
  'Manchester City',
  'Chelsea',
  'Bayern Munich',
  'Juventus',
  'AC Milan',
  'Paris Saint-Germain',
  'Bayer Leverkusen',
  'Argentina',
  'France',
  'Brazil',
  'England',
  'Spain',
  'Germany',
  'Portugal',
  'Italy',
  'Netherlands',
]
const pinRank = (name: string) => {
  const i = PINNED.indexOf(name)
  return i === -1 ? PINNED.length : i
}

/** Kit-coloured tiles for every side in the library, most-played first. */

function KitSwatch({ team }: { team: string }) {
  const kit = knownKit(team)
  return (
    <span
      className={`score-narrow grid size-8 shrink-0 place-items-center rounded-[6px] border-2 text-[0.7rem] ${kit ? 'border-ink' : 'border-ink/40'}`}
      style={{ background: kit?.fill ?? 'transparent', color: kit?.ink ?? 'var(--color-ink)' }}
      aria-hidden="true"
    >
      {codeFor(team)}
    </span>
  )
}

function KitDot({ team }: { team: string }) {
  // Only real colours: a team we don't have a kit for gets a plain outline.
  const kit = knownKit(team)
  return (
    <span
      className={`size-3.5 shrink-0 rounded-full border-2 ${kit ? 'border-ink' : 'border-ink/40'}`}
      style={{ background: kit?.fill ?? 'transparent' }}
      aria-hidden="true"
    />
  )
}



function MatchRow({
  m,
  season,
  first,
  active,
  onPick,
}: {
  m: LibraryMatch
  season?: LibrarySeason
  first: boolean
  active: boolean
  onPick: () => void
}) {
  const stage = m.stage && m.stage !== 'Regular Season' ? m.stage : ''
  return (
    <li className={first ? '' : 'border-t border-ink/15'}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onPick}
        className={`grid w-full grid-cols-[4.6rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-3 text-left sm:grid-cols-[5.4rem_minmax(0,1fr)_auto] sm:px-4 ${active ? 'bg-yellow' : 'hover:bg-cream'}`}
      >
        <span className="text-sm leading-tight text-ink-soft">{formatDate(m.date)}</span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2 font-[750]">
            <KitDot team={m.home} />
            <span className="truncate">{m.home}</span>
            <span className="shrink-0 text-ink-soft">v</span>
            <KitDot team={m.away} />
            <span className="truncate">{m.away}</span>
          </span>
          <span className="block truncate text-sm text-ink-soft">
            {season ? `${season.competition} ${season.season}` : ''}
            {stage ? `, ${stage}` : ''}
          </span>
        </span>
        <span className="score-narrow text-lg tabular-nums" aria-label={`Final score ${m.home_score} to ${m.away_score}`}>
          {m.home_score}–{m.away_score}
        </span>
      </button>
    </li>
  )
}

function MomentBuilder({
  match,
  season,
  minute,
  setMinute,
  building,
  analysing,
  analyseFirst,
  error,
  onBuild,
  onAnalyse,
}: {
  match: LibraryMatch
  season?: LibrarySeason
  minute: number
  setMinute: (m: number) => void
  building: boolean
  analysing: boolean
  analyseFirst: boolean
  error?: string
  onBuild: () => void
  onAnalyse: () => void
}) {
  const minuteId = useId()
  return (
    <>
      <div className="mt-4">
        <ScoreBug
          home={teamCode(match.home)}
          away={teamCode(match.away)}
          score={{ home: match.home_score, away: match.away_score }}
          minute={minute}
          size="md"
        />
        <p className="mt-2 font-[750]">
          {match.home} v {match.away}
        </p>
        <p className="text-sm text-ink-soft">
          {season ? `${season.competition} ${season.season}, ` : ''}
          {formatDate(match.date)}
          {match.stadium ? `, ${match.stadium}` : ''}. That's the final score; the board shows the score at your minute.
        </p>
      </div>
      <div className="mt-6">
        <label htmlFor={minuteId} className="flex items-baseline justify-between font-[800]">
          Freeze it at
          <span className="score text-4xl">{minute}'</span>
        </label>
        <input
          id={minuteId}
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
      {(() => {
        const busy = building || analysing
        const play = (
          <button
            key="play"
            type="button"
            onClick={onBuild}
            disabled={busy}
            className={`btn lift w-full ${analyseFirst ? 'btn-plain min-h-12' : 'btn-primary min-h-14 text-lg'}`}
          >
            {building ? 'Building the moment…' : 'Build this moment'}
          </button>
        )
        const study = (
          <button
            key="study"
            type="button"
            onClick={onAnalyse}
            disabled={busy}
            className={`btn lift w-full ${analyseFirst ? 'btn-primary min-h-14 text-lg' : 'btn-plain min-h-12'}`}
          >
            {analysing ? 'Opening Analyst Mode…' : 'Analyse this match'}
          </button>
        )
        return <div className="mt-7 grid gap-2.5">{analyseFirst ? [study, play] : [play, study]}</div>
      })()}
      <p className="mt-2 text-sm text-ink-soft" aria-live="polite">
        {building || analysing
          ? 'Fetching every event from the match. The first time takes a few seconds.'
          : 'Play either side, or open its shot map, passing networks and momentum.'}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-[10px] border-2 border-vermilion-deep bg-vermilion/15 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      )}
    </>
  )
}
