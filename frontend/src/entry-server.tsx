import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { makeQueryClient, routes } from './app'

/** Render the home page to HTML at build time (see scripts/prerender.mjs). */
export function render(url = '/'): string {
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  return renderToString(
    <StrictMode>
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}
