import pool from '../data/hero-pool.json'
import { loadFixture } from './api'
import type { ScenarioDetail } from './types'

/** Curated moments that take turns as the home page hero. */
export const HERO_POOL: string[] = pool

let current: ScenarioDetail | null = null

/** Pick a hero: the one the server baked into the page, or a random one. */
export function chooseHeroSlug(): string {
  const baked = typeof window !== 'undefined' ? (window as { __TACTIX_HERO__?: string }).__TACTIX_HERO__ : undefined
  if (baked && HERO_POOL.includes(baked)) return baked
  return HERO_POOL[Math.floor(Math.random() * HERO_POOL.length)]
}

/** Load a hero's bundled snapshot and make it the current one. */
export async function loadHero(slug: string): Promise<ScenarioDetail> {
  current = await loadFixture<ScenarioDetail>(`scenario-${slug}`)
  return current
}

export function getHero(): ScenarioDetail {
  if (!current) throw new Error('Hero not loaded: call loadHero() before rendering')
  return current
}
