// Vercel Routing Middleware: each visit to "/" gets a random famous moment,
// served from a page prerendered at build time (scripts/prerender.mjs), so
// the hero rotates with no flash and no wait on the API.
import { rewrite } from '@vercel/functions'
import pool from './src/data/hero-pool.json'

export const config = { matcher: '/' }

export default function middleware(request: Request) {
  const slug = pool[Math.floor(Math.random() * pool.length)]
  return rewrite(new URL(`/hero/${slug}.html`, request.url))
}
