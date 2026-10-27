import { reportLocally, simulateLocally } from './model'
import { REPLAY_TYPES } from './replay'
import type {
  CatalogCompetition,
  CatalogMatch,
  Library,
  MatchDetail,
  MatchEvent,
  MatchSummary,
  ReportRequest,
  ScenarioDetail,
  ScenarioSummary,
  SimulationRequest,
  SimulationResult,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** Bundled snapshots of the seeded data, used when the API can't be reached. */
const fixtures = import.meta.glob<{ default: unknown }>('../data/fixtures/*.json')

export async function loadFixture<T>(name: string): Promise<T> {
  return fixture<T>(name)
}

async function fixture<T>(name: string): Promise<T> {
  const load = fixtures[`../data/fixtures/${name}.json`]
  if (!load) throw new ApiError(`No offline copy of ${name}`, 404)
  return (await load()).default as T
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Listener = (offline: boolean) => void
const listeners = new Set<Listener>()
let offline = false

function setOffline(value: boolean) {
  if (offline === value) return
  offline = value
  listeners.forEach((l) => l(value))
}

export function subscribeOffline(listener: Listener): () => void {
  listeners.add(listener)
  listener(offline)
  return () => listeners.delete(listener)
}

async function request<T>(path: string, init?: RequestInit, fallback?: () => Promise<T>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
  } catch {
    if (fallback) {
      setOffline(true)
      return fallback()
    }
    throw new ApiError('Could not reach the TACTIX server. Check your connection and try again.', 0)
  }

  // A dev proxy with no backend behind it answers 5xx; treat that as offline too.
  if (response.status >= 500 && fallback) {
    setOffline(true)
    return fallback()
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const body = await response.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* keep generic message */
    }
    throw new ApiError(detail, response.status)
  }
  setOffline(false)
  return response.json() as Promise<T>
}

export const api = {
  scenarios: () =>
    request<ScenarioSummary[]>('/api/scenarios', undefined, () => fixture('scenarios')),

  scenario: (slug: string) =>
    request<ScenarioDetail>(`/api/scenarios/${slug}`, undefined, () => fixture(`scenario-${slug}`)),

  simulate: (slug: string, body: SimulationRequest) =>
    request<SimulationResult>(
      `/api/scenarios/${slug}/simulate`,
      { method: 'POST', body: JSON.stringify(body) },
      async () => simulateLocally(slug, await fixture<ScenarioDetail>(`scenario-${slug}`), body),
    ),

  /** The verdict on a live match played out in the browser. */
  report: (slug: string, body: ReportRequest) =>
    request<SimulationResult>(
      `/api/scenarios/${slug}/report`,
      { method: 'POST', body: JSON.stringify(body) },
      async () => reportLocally(slug, await fixture<ScenarioDetail>(`scenario-${slug}`), body, body.live),
    ),

  matches: () => request<MatchSummary[]>('/api/matches', undefined, () => fixture('matches')),

  match: (id: number) =>
    request<MatchDetail>(`/api/matches/${id}`, undefined, () => fixture(`match-${id}`)),

  /** Every ball event from a minute on, for the real-match replay. Needs the API: no offline copy. */
  replayEvents: (id: number, minuteFrom: number) =>
    request<MatchEvent[]>(
      `/api/matches/${id}/events?minute_from=${minuteFrom}&limit=5000&${REPLAY_TYPES.map((t) => `event_type=${encodeURIComponent(t)}`).join('&')}`,
    ),

  shots: (id: number) =>
    request<MatchEvent[]>(`/api/matches/${id}/events?event_type=Shot&limit=200`, undefined, () =>
      fixture(`shots-${id}`),
    ),

  competitions: () => request<CatalogCompetition[]>('/api/catalog/competitions'),

  /** Every open-data match; ready is false while the server is still building it. */
  library: () => request<Library>('/api/catalog/library'),

  catalogMatches: (competitionId: number, seasonId: number) =>
    request<CatalogMatch[]>(`/api/catalog/matches?competition_id=${competitionId}&season_id=${seasonId}`),

  /** Build (or reuse) a playable moment from any open-data match. */
  createMoment: (body: { competition_id: number; season_id: number; match_id: number; minute: number }) =>
    request<{ slug: string }>('/api/catalog/moments', { method: 'POST', body: JSON.stringify(body) }),

  /** Store any open-data match so Analyst Mode can show it. */
  analyse: (body: { competition_id: number; season_id: number; match_id: number }) =>
    request<{ match_id: number }>('/api/catalog/analyse', { method: 'POST', body: JSON.stringify(body) }),

  ask: (id: number, question: string) =>
    request<{ answer: string; source: 'gemini' | 'model' }>(
      `/api/matches/${id}/ask`,
      { method: 'POST', body: JSON.stringify({ question }) },
      async () => ({
        answer:
          'The analyst needs the TACTIX server, which is offline right now. The charts on this page still use the real match data.',
        source: 'model' as const,
      }),
    ),
}
