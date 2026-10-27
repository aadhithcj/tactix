import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { makeQueryClient, routes } from './app'
import './index.css'
import { chooseHeroSlug, loadHero } from './lib/hero'

// The home hero must be known before the first render (and match the
// prerendered page, which names its hero in window.__TACTIX_HERO__).
await loadHero(chooseHeroSlug())

const router = createBrowserRouter(routes)
const app = (
  <StrictMode>
    <QueryClientProvider client={makeQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)

const container = document.getElementById('root')!
// The production build prerenders the home page into index.html; hydrate it there.
if (container.hasChildNodes() && window.location.pathname === '/') hydrateRoot(container, app)
else createRoot(container).render(app)
