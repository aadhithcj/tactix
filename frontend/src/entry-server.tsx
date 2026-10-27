import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { makeQueryClient, routes } from './app'
import { HERO_POOL, loadHero } from './lib/hero'

export { HERO_POOL }

/** Render the home page, with a given hero, to HTML at build time (see scripts/prerender.mjs). */
export async function render(url = '/', heroSlug = HERO_POOL[0]): Promise<string> {
  await loadHero(heroSlug)
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}
