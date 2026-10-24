import { useMemo, useState } from 'react'
import type { Kit } from '../lib/kits'
import { PITCH_X, PITCH_Y } from '../lib/model'
import type { PassNetwork as Network } from '../lib/types'
import { shortName as surname } from '../lib/names'
import { PitchLines } from './PitchLines'

interface Pair {
  key: string
  a: number
  b: number
  weight: number
}

const MIN_GAP = 11.5 // Yards between token centres after relaxing.
const MAX_PAIRS = 14


/** Nudge overlapping average positions apart so every token and label reads. */
function relax(points: { id: number; x: number; y: number }[]) {
  const pts = points.map((p) => ({ ...p }))
  for (let iter = 0; iter < 60; iter++) {
    let moved = false
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x
        const dy = pts[j].y - pts[i].y
        const d = Math.hypot(dx, dy) || 0.01
        if (d < MIN_GAP) {
          const push = (MIN_GAP - d) / 2
          const ux = dx / d
          const uy = dy / d
          pts[i].x -= ux * push
          pts[i].y -= uy * push
          pts[j].x += ux * push
          pts[j].y += uy * push
          moved = true
        }
      }
    }
    for (const p of pts) {
      p.x = Math.max(5, Math.min(PITCH_X - 5, p.x))
      p.y = Math.max(5, Math.min(PITCH_Y - 6, p.y))
    }
    if (!moved) break
  }
  return new Map(pts.map((p) => [p.id, p]))
}

export function PassNetworkView({ net, kit }: { net: Network; kit: Kit }) {
  const [focusNode, setFocusNode] = useState<number | null>(null)
  const [focusPair, setFocusPair] = useState<string | null>(null)

  const { nodes, pos, pairs, maxPasses, maxWeight } = useMemo(() => {
    const nodes = net.nodes.slice(0, 11)
    const ids = new Set(nodes.map((n) => n.id))
    const combined = new Map<string, Pair>()
    for (const e of net.edges) {
      if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
      const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source]
      const key = `${a}-${b}`
      const pair = combined.get(key) ?? { key, a, b, weight: 0 }
      pair.weight += e.weight
      combined.set(key, pair)
    }
    const pairs = [...combined.values()].sort((x, y) => y.weight - x.weight).slice(0, MAX_PAIRS)
    return {
      nodes,
      pos: relax(nodes),
      pairs,
      maxPasses: Math.max(...nodes.map((n) => n.passes), 1),
      maxWeight: Math.max(...pairs.map((p) => p.weight), 1),
    }
  }, [net])

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const activePair = pairs.find((p) => p.key === focusPair)
  const lit = (p: Pair) =>
    activePair ? p.key === activePair.key : focusNode !== null ? p.a === focusNode || p.b === focusNode : true
  const nodeLit = (id: number) =>
    activePair ? id === activePair.a || id === activePair.b : focusNode === null || focusNode === id || pairs.some((p) => lit(p) && (p.a === id || p.b === id))
  const dimmed = focusNode !== null || activePair !== undefined
  const fill = kit.fill

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem]">
      <svg
        viewBox="-1 -1 122 82"
        className="block w-full border-ink lg:border-r-2"
        role="img"
        aria-label={`${net.team_name} passing network. Tokens sit at each player's average passing position; arcs join the ${pairs.length} most frequent passing pairs.`}
        onPointerLeave={() => {
          setFocusNode(null)
          setFocusPair(null)
        }}
      >
        <rect x={-1} y={-1} width={122} height={82} fill="var(--color-pitch)" />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={i * 20 + 10} y={0} width={10} height={80} fill="var(--color-pitch-stripe)" />
        ))}
        <g opacity={0.45}>
          <PitchLines />
        </g>

        {pairs.map((p) => {
          const a = pos.get(p.a)!
          const b = pos.get(p.b)!
          // A gentle bend keeps crossing links apart.
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const bend = Math.min(6, len * 0.12)
          const cx = mx - ((b.y - a.y) / len) * bend
          const cy = my + ((b.x - a.x) / len) * bend
          const t = p.weight / maxWeight
          const on = lit(p)
          return (
            <path
              key={p.key}
              d={`M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`}
              fill="none"
              stroke={dimmed && on ? 'var(--color-ink)' : 'var(--color-chalk)'}
              strokeWidth={0.5 + t * 2.4}
              strokeLinecap="round"
              opacity={on ? 0.55 + t * 0.45 : 0.12}
              style={{ transition: 'opacity 160ms, stroke 160ms' }}
              onPointerEnter={() => setFocusPair(p.key)}
              onPointerLeave={() => setFocusPair(null)}
            >
              <title>{`${byId.get(p.a)?.name} and ${byId.get(p.b)?.name}: ${p.weight} passes`}</title>
            </path>
          )
        })}

        {nodes.map((n) => {
          const p = pos.get(n.id)!
          const r = 2.7 + (n.passes / maxPasses) * 1.9
          const on = nodeLit(n.id)
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              opacity={on ? 1 : 0.35}
              style={{ transition: 'opacity 160ms', cursor: 'pointer' }}
              onPointerEnter={() => setFocusNode(n.id)}
              onPointerLeave={() => setFocusNode(null)}
            >
              <circle r={r + 2.5} fill="transparent" />
              <circle r={r} fill={fill} stroke="var(--color-ink)" strokeWidth={focusNode === n.id ? 0.9 : 0.5} />
              <text textAnchor="middle" dy="0.95" fontSize={2.6} className="score-narrow" fill={kit.ink}>
                {n.number ?? ''}
              </text>
              <text
                textAnchor="middle"
                y={r + 3}
                fontSize={2.1}
                fontWeight={700}
                fill="var(--color-ink)"
                stroke="var(--color-pitch)"
                strokeWidth={0.8}
                paintOrder="stroke"
              >
                {surname(n.name)}
              </text>
              <title>{`${n.name}: ${n.passes} completed passes`}</title>
            </g>
          )
        })}
      </svg>

      <div className="border-t-2 border-ink p-4 lg:border-t-0">
        <h3 className="font-[850]">Top partnerships</h3>
        <p className="text-xs text-ink-soft">Completed passes, both directions.</p>
        <ol className="mt-3 grid gap-1">
          {pairs.slice(0, 6).map((p, i) => {
            const a = byId.get(p.a)!
            const b = byId.get(p.b)!
            const active = focusPair === p.key
            return (
              <li key={p.key}>
                <button
                  type="button"
                  onPointerEnter={() => setFocusPair(p.key)}
                  onPointerLeave={() => setFocusPair(null)}
                  onFocus={() => setFocusPair(p.key)}
                  onBlur={() => setFocusPair(null)}
                  className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-[8px] px-2 py-1.5 text-left text-sm ${active ? 'bg-yellow' : 'hover:bg-cream'}`}
                >
                  <span className="score-narrow text-ink-soft">{i + 1}</span>
                  <span className="truncate font-semibold">
                    {surname(a.name)} &amp; {surname(b.name)}
                  </span>
                  <span className="tabular-nums font-[800]">{p.weight}</span>
                  <span className="col-start-2 col-end-4 mt-1 h-1.5 overflow-hidden rounded-full bg-cream-deep">
                    <span className="block h-full rounded-full bg-ink" style={{ width: `${(p.weight / maxWeight) * 100}%` }} />
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

