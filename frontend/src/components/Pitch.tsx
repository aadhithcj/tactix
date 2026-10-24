import { motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExposedZone, SnapshotPlayer } from '../lib/types'
import { PITCH_X, PITCH_Y } from '../lib/model'
import { shortName } from '../lib/names'
import { PitchLines } from './PitchLines'

export interface Token {
  id: number
  number: number | null
  name: string
  position?: string | null
  x: number
  y: number
}

interface PitchProps {
  /** Your players, in your frame: x = 0 is your goal, y = 80 your right touchline. */
  you: Token[]
  /** Opponents, already in your frame. */
  them: Token[]
  ghosts?: Token[]
  keyThreatId?: number | null
  selectedId?: number | null
  onSelect?: (id: number | null) => void
  onMove?: (id: number, x: number, y: number) => void
  onDragState?: (dragging: boolean) => void
  heat?: { x: number; y: number; w: number; h: number; value: number }[]
  zones?: ExposedZone[]
  showNames?: boolean
  orientation?: 'auto' | 'horizontal' | 'vertical'
  className?: string
  label: string
}

const ZONE_W = PITCH_X / 12
const ZONE_H = PITCH_Y / 8
const SPRING = { type: 'spring', stiffness: 260, damping: 26, mass: 0.8 } as const

/**
 * Put each name below its token, or above when that spot is crowded, or
 * nowhere when both are. Works in screen space so it holds when the pitch is
 * drawn vertically.
 */
function placeLabels(you: Token[], them: Token[], vertical: boolean, keyThreat?: Token) {
  const screen = (t: { x: number; y: number }) => (vertical ? { sx: t.y, sy: PITCH_X - t.x } : { sx: t.x, sy: t.y })
  const tokens = [...you, ...them].map(screen)
  const placed: { sx: number; sy: number; half: number }[] = []
  if (keyThreat) {
    // The key threat's name is always shown, so reserve its spot first.
    const k = screen(keyThreat)
    placed.push({ sx: k.sx, sy: k.sy - 6.4, half: shortName(keyThreat.name).length * 0.62 + 0.6 })
  }
  const out = new Map<number, 'below' | 'above' | null>()
  for (const t of you) {
    const { sx, sy } = screen(t)
    const half = shortName(t.name).length * 0.58 + 0.6
    const fits = (ly: number) =>
      tokens.every((o) => Math.abs(o.sx - sx) > half + 2.7 || Math.abs(o.sy - ly) > 3.6 || (o.sx === sx && o.sy === sy)) &&
      placed.every((l) => Math.abs(l.sx - sx) > l.half + half || Math.abs(l.sy - ly) > 2.4)
    const side = fits(sy + 5) ? 'below' : fits(sy - 4.8) ? 'above' : null
    if (side) placed.push({ sx, sy: side === 'below' ? sy + 5 : sy - 4.8, half })
    out.set(t.id, side)
  }
  return out
}

function useVertical(mode: PitchProps['orientation']) {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  if (mode === 'horizontal') return false
  if (mode === 'vertical') return true
  return narrow
}

export function Pitch({
  you,
  them,
  ghosts,
  keyThreatId,
  selectedId,
  onSelect,
  onMove,
  onDragState,
  heat,
  zones,
  showNames = true,
  orientation = 'auto',
  className = '',
  label,
}: PitchProps) {
  const vertical = useVertical(orientation)
  const reduce = useReducedMotion()
  const frame = useRef<SVGGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const interactive = Boolean(onMove)
  // Decorative pitches (home, pick screen, verdict) stay out of the tab order.
  const focusable = Boolean(onMove || onSelect)

  const toPitch = useCallback((clientX: number, clientY: number) => {
    const g = frame.current
    const ctm = g?.getScreenCTM()
    if (!g || !ctm) return null
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return {
      x: Math.max(2, Math.min(PITCH_X - 2, pt.x)),
      y: Math.max(2, Math.min(PITCH_Y - 2, pt.y)),
    }
  }, [])

  const startDrag = (id: number) => (e: React.PointerEvent) => {
    if (!interactive) {
      onSelect?.(id)
      return
    }
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDragging(id)
    onDragState?.(true)
    onSelect?.(id)
  }

  const moveDrag = (e: React.PointerEvent) => {
    if (dragging === null) return
    const p = toPitch(e.clientX, e.clientY)
    if (p) onMove?.(dragging, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10)
  }

  const endDrag = () => {
    if (dragging === null) return
    setDragging(null)
    onDragState?.(false)
  }

  const keyMove = (t: Token) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 6 : 2
    // Arrow keys follow the screen, whichever way the pitch is drawn.
    const map: Record<string, [number, number]> = vertical
      ? { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowRight: [0, step], ArrowLeft: [0, -step] }
      : { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(t.id === selectedId ? null : t.id)
      return
    }
    const d = map[e.key]
    if (!d || !interactive) return
    e.preventDefault()
    onSelect?.(t.id)
    onMove?.(t.id, Math.max(2, Math.min(PITCH_X - 2, t.x + d[0])), Math.max(2, Math.min(PITCH_Y - 2, t.y + d[1])))
  }

  const maxHeat = useMemo(() => Math.max(0.0001, ...(heat ?? []).map((h) => h.value)), [heat])
  const ghostById = useMemo(() => new Map((ghosts ?? []).map((g) => [g.id, g])), [ghosts])
  const keyThreat = them.find((t) => t.id === keyThreatId)
  const labels = useMemo(() => placeLabels(you, them, vertical, keyThreat), [you, them, vertical, keyThreat])

  // In vertical mode the team frame is rotated so you attack up the screen.
  const groupTransform = vertical ? 'matrix(0,-1,1,0,0,120)' : undefined
  const upright = vertical ? 'rotate(90)' : undefined
  const viewBox = vertical ? '-1 -1 82 122' : '-1 -1 122 82'

  return (
    <svg
      viewBox={viewBox}
      className={`block w-full select-none touch-none ${className}`}
      role="group"
      aria-label={label}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect?.(null)
      }}
    >
      <g ref={frame} transform={groupTransform}>
        {/* Turf with mown stripes */}
        <rect x={0} y={0} width={PITCH_X} height={PITCH_Y} fill="var(--color-pitch)" onPointerDown={() => onSelect?.(null)} />
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={i * 20 + 10} y={0} width={10} height={PITCH_Y} fill="var(--color-pitch-stripe)" pointerEvents="none" />
        ))}

        {heat?.map((h, i) => {
          // Opaque vermilion hatching, denser where more threat is left open,
          // so it reads as red on grass instead of blending into brown.
          const t = h.value / maxHeat
          if (t < 0.22) return null
          const level = t < 0.5 ? 1 : t < 0.8 ? 2 : 3
          return (
            <rect
              key={i}
              x={h.x + 0.6}
              y={h.y + 0.6}
              width={h.w - 1.2}
              height={h.h - 1.2}
              rx={1.2}
              fill={`url(#tx-heat-${level})`}
              stroke="var(--color-vermilion)"
              strokeWidth={level === 3 ? 0.5 : 0.3}
              pointerEvents="none"
            />
          )
        })}

        <PitchLines />

        {zones?.map((z, i) => (
          <g key={i} pointerEvents="none">
            <rect
              x={z.x + 0.4}
              y={z.y + 0.4}
              width={z.w - 0.8}
              height={z.h - 0.8}
              rx={1.4}
              fill="url(#tx-heat-3)"
              stroke="var(--color-vermilion)"
              strokeWidth={0.5}
            />
            <g transform={`translate(${z.x + z.w / 2} ${z.y + z.h / 2})`}>
              <g transform={upright}>
                <circle r={2.6} fill="var(--color-ink)" />
                <text textAnchor="middle" dy="0.95" fontSize={2.6} fontWeight={800} fill="var(--color-yellow)" className="score-narrow">
                  {i + 1}
                </text>
              </g>
            </g>
          </g>
        ))}

        {/* Where players really stood, with a thread to where you moved them */}
        {you.map((t) => {
          const g = ghostById.get(t.id)
          if (!g || Math.hypot(g.x - t.x, g.y - t.y) < 1.5) return null
          return (
            <g key={`ghost-${t.id}`} pointerEvents="none">
              <line x1={g.x} y1={g.y} x2={t.x} y2={t.y} stroke="var(--color-ink)" strokeWidth={0.35} strokeDasharray="1 1" opacity={0.6} />
              <circle cx={g.x} cy={g.y} r={1.6} fill="none" stroke="var(--color-ink)" strokeWidth={0.35} opacity={0.6} />
            </g>
          )
        })}

        {them
          .filter((t) => t.id !== keyThreatId)
          .map((t) => (
            <motion.g
              key={`them-${t.id}`}
              initial={false}
              animate={{ x: t.x, y: t.y }}
              transition={reduce ? { duration: 0 } : SPRING}
              pointerEvents="none"
            >
              <rect x={-2.7} y={-2.7} width={5.4} height={5.4} rx={1} fill="var(--kit-them, var(--color-vermilion))" stroke="var(--color-ink)" strokeWidth={0.45} />
              <g transform={upright}>
                <text textAnchor="middle" dy="0.95" fontSize={2.5} className="score-narrow" fill="var(--kit-them-ink, var(--color-ink))">
                  {t.number ?? ''}
                </text>
              </g>
            </motion.g>
          ))}

        {you.map((t) => {
          const isDragging = dragging === t.id
          const isSelected = selectedId === t.id
          return (
            <motion.g
              key={`you-${t.id}`}
              initial={false}
              animate={{ x: t.x, y: t.y }}
              transition={isDragging || reduce ? { duration: 0 } : SPRING}
              onPointerDown={startDrag(t.id)}
              onKeyDown={keyMove(t)}
              tabIndex={focusable ? 0 : undefined}
              role={focusable ? 'button' : undefined}
              aria-label={focusable ? `${t.number ? `Number ${t.number}, ` : ''}${t.name}${t.position ? `, ${t.position}` : ''}. ${interactive ? 'Drag or use arrow keys to move.' : ''}` : undefined}
              aria-pressed={focusable ? isSelected : undefined}
              style={{ cursor: interactive ? (isDragging ? 'grabbing' : 'grab') : 'pointer', outline: 'none' }}
              className="tx-token"
            >
              {isDragging && <circle r={9} fill="var(--kit-you, var(--color-sky))" opacity={0.28} pointerEvents="none" />}
              <circle r={6} fill="transparent" />
              {isSelected && <circle r={4.4} fill="none" stroke="var(--color-ink)" strokeWidth={0.6} />}
              <circle
                className="tx-token-face"
                r={isDragging ? 3.4 : 3}
                fill={isSelected ? 'var(--color-yellow)' : 'var(--kit-you, var(--color-sky))'}
                stroke="var(--color-ink)"
                strokeWidth={0.55}
                style={{ transition: 'r 120ms ease-out' }}
              />
              <g transform={upright} pointerEvents="none">
                <text textAnchor="middle" dy="0.95" fontSize={2.7} className="score-narrow" fill={isSelected ? 'var(--color-ink)' : 'var(--kit-you-ink, var(--color-ink))'}>
                  {t.number ?? ''}
                </text>
                {(isSelected || isDragging || (showNames && labels.get(t.id))) && (
                  <text
                    textAnchor="middle"
                    y={(labels.get(t.id) ?? 'below') === 'below' ? 5.6 : -4.2}
                    fontSize={2.05}
                    fontWeight={700}
                    fill="var(--color-ink)"
                    stroke="var(--color-pitch)"
                    strokeWidth={0.7}
                    paintOrder="stroke"
                  >
                    {shortName(t.name)}
                  </text>
                )}
              </g>
            </motion.g>
          )
        })}

        {/* Their key threat last, so nothing ever covers him */}
        {keyThreat && (
          <motion.g
            key={`them-${keyThreat.id}`}
            initial={false}
            animate={{ x: keyThreat.x, y: keyThreat.y }}
            transition={reduce ? { duration: 0 } : SPRING}
            pointerEvents="none"
          >
            <circle r={5.2} fill="none" stroke="var(--color-ink)" strokeWidth={0.5} strokeDasharray="1.4 1" />
            <rect x={-2.9} y={-2.9} width={5.8} height={5.8} rx={1.1} fill="var(--kit-them, var(--color-vermilion))" stroke="var(--color-ink)" strokeWidth={0.6} />
            <g transform={upright}>
              <text textAnchor="middle" dy="0.95" fontSize={2.5} className="score-narrow" fill="var(--kit-them-ink, var(--color-ink))">
                {keyThreat.number ?? ''}
              </text>
              <text textAnchor="middle" y={-6.4} fontSize={2.3} fontWeight={800} fill="var(--color-ink)" stroke="var(--color-chalk)" strokeWidth={0.8} paintOrder="stroke">
                {shortName(keyThreat.name)}
              </text>
            </g>
          </motion.g>
        )}
      </g>
      <defs>
        {[
          [1, 2.6, 0.4],
          [2, 1.8, 0.55],
          [3, 1.3, 0.65],
        ].map(([level, gap, width]) => (
          <pattern key={level} id={`tx-heat-${level}`} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={gap} stroke="var(--color-vermilion)" strokeWidth={width} />
          </pattern>
        ))}
      </defs>
    </svg>
  )
}

export { ZONE_W, ZONE_H }

/** Mirror the opponent's frame into yours. */
export function mirror<T extends { x: number; y: number }>(p: T): T {
  return { ...p, x: PITCH_X - p.x, y: PITCH_Y - p.y }
}

export function toTokens(players: SnapshotPlayer[]): Token[] {
  return players.map((p) => ({ id: p.id, number: p.number, name: p.name, position: p.position, x: p.x, y: p.y }))
}
