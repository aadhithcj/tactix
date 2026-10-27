// Bake the home page into HTML so it renders without JavaScript and paints
// before the bundle loads. One page per hero moment goes to dist/hero/<slug>.html;
// on Vercel, middleware.ts serves a random one at "/" so each visit gets a
// different famous match. dist/index.html is the first hero, the fallback.
// Other routes use dist/spa.html, an empty shell, so a deep link never flashes
// the home page (see vercel.json).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const ssrEntry = path.join(root, 'dist-ssr', 'entry-server.js')

const { render, HERO_POOL } = await import(pathToFileURL(ssrEntry).href)
const shell = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const marker = '<div id="root"></div>'
if (!shell.includes(marker)) throw new Error('index.html has no empty #root to fill')

// Preload the headline's Latin font so the LCP text paints in its real face
// early instead of being discovered after the stylesheet. The score face is
// smaller on screen and left to load normally so it doesn't compete.
const fonts = fs
  .readdirSync(path.join(dist, 'assets'))
  .filter((f) => /^schibsted-grotesk-latin-wght-normal-.*\.woff2$/.test(f))
const preload = fonts.map((f) => `<link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin />`).join('')
const head = shell.replace('</head>', `${preload}</head>`)

fs.writeFileSync(path.join(dist, 'spa.html'), head)
// The prerendered page is complete without JS, so the bundle can yield
// bandwidth to the font and paint; it only delays hydration. Each page names
// its hero so the client hydrates the same one.
const heroPage = async (slug) =>
  head
    .replace(marker, `<div id="root">${await render('/', slug)}</div>`)
    .replace('<script type="module" crossorigin', `<script>window.__TACTIX_HERO__=${JSON.stringify(slug)}</script><script type="module" fetchpriority="low" crossorigin`)

fs.mkdirSync(path.join(dist, 'hero'), { recursive: true })
for (const slug of HERO_POOL) fs.writeFileSync(path.join(dist, 'hero', `${slug}.html`), await heroPage(slug))
fs.writeFileSync(path.join(dist, 'index.html'), await heroPage(HERO_POOL[0]))
console.log(`Prerendered ${HERO_POOL.length} hero pages`)
console.log(`Preloaded ${fonts.length} font files`)
fs.rmSync(path.join(root, 'dist-ssr'), { recursive: true, force: true })
console.log('Prerendered / into dist/index.html; SPA shell at dist/spa.html')
