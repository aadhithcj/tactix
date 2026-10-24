import { QueryClient } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Link, Outlet, ScrollRestoration, type RouteObject } from 'react-router'
import { SiteFooter, SiteHeader } from './components/Chrome'
import Home from './routes/Home'

// The board and the analyst views load on demand to keep the first page light.
const Play = lazy(() => import('./routes/Play'))
const Analyst = lazy(() => import('./routes/Analyst'))

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false } },
  })
}

function Root() {
  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-md bg-yellow px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <Suspense fallback={<div className="min-h-dvh bg-cream" aria-busy="true" />}>
        <Outlet />
      </Suspense>
      <ScrollRestoration />
    </>
  )
}

function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[720px] px-4 py-24">
        <p className="score text-7xl">404</p>
        <h1 className="mt-4 text-3xl font-[850]">Nothing on this part of the pitch</h1>
        <p className="mt-2 text-lg text-ink-soft">The page you asked for doesn't exist. Pick a moment to manage instead.</p>
        <Link to="/" className="btn btn-primary lift mt-6">
          See all moments
        </Link>
      </main>
      <SiteFooter />
    </>
  )
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/play/:slug', element: <Play /> },
      { path: '/analyst', element: <Analyst /> },
      { path: '/analyst/:matchId', element: <Analyst /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]
