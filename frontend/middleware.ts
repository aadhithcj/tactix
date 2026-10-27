// Vercel Routing Middleware: each visit to "/" gets a random famous moment,
// served from a page prerendered at build time (scripts/prerender.mjs), so the
// hero rotates with no flash and no wait on the API.
//
// Deliberately dependency-free: no imports, so nothing can fail to resolve in
// the edge runtime. Keep HERO_POOL in step with src/data/hero-pool.json (a
// build check in scripts/prerender.mjs enforces it).

export const config = { matcher: '/' }

const HERO_POOL = [
  'lusail-2022-71',
  'moscow-2018-60',
  'wembley-2021-60',
  'berlin-2024-75',
  'istanbul-2005-50',
  'munich-2012-84',
  'lisbon-2014-85',
  'lusail-2022-saudi-60',
]

export default function middleware(request: Request): Response | undefined {
  try {
    const slug = HERO_POOL[Math.floor(Math.random() * HERO_POOL.length)]
    // The header Vercel's rewrite() helper sets: serve this file, keep the URL.
    return new Response(null, { headers: { 'x-middleware-rewrite': new URL(`/hero/${slug}.html`, request.url).toString() } })
  } catch {
    // Anything unexpected: fall through to the prerendered index.html.
    return undefined
  }
}
