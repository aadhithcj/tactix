import { simulateLocally } from './model'
import type {
  MatchDetail,
  MatchEvent,
  MatchSummary,
  ScenarioDetail,
  ScenarioSummary,
  SimulationRequest,
  SimulationResult,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** Bundled snapshots of the seeded data, used when the API can't be reached. */
const fixtures = import.meta.glob<{ default: unknown }>('../data/fixtures/*.json')

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

  matches: () => request<MatchSummary[]>('/api/matches', undefined, () => fixture('matches')),

  match: (id: number) =>
    request<MatchDetail>(`/api/matches/${id}`, undefined, () => fixture(`match-${id}`)),

  shots: (id: number) =>
    request<MatchEvent[]>(`/api/matches/${id}/events?event_type=Shot&limit=200`, undefined, () =>
      fixture(`shots-${id}`),
    ),

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
