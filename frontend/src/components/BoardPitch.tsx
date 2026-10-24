import { shortName } from '../lib/names'
import { CROP_X, type SceneToken } from '../lib/scene'
import { PitchLines } from './PitchLines'

interface BoardPitchProps {
  tokens: SceneToken[]
  beyond: SceneToken[]
  hero: SceneToken | null
  marker: SceneToken | null
  describedBy: string
  title: string
}

/**
 * Portrait, cropped pitch: your goal at the bottom, attacking up, showing
 * your half and the centre circle. Drawn in the team frame inside one
 * rotation, so token coordinates stay StatsBomb's. No animation library:
 * tokens glide with CSS transforms.
 */
export function BoardPitch({ tokens, beyond, hero, marker, describedBy, title }: BoardPitchProps) {
  // matrix(0,-1,1,0,0,CROP_X): screen x = y, screen y = CROP_X - x.
  const frame = `matrix(0,-1,1,0,0,${CROP_X})`
  const upright = 'rotate(90)'
  const run = hero ? runArrow(hero) : null

  return (
    <svg viewBox={`-1.5 -1.5 83 ${CROP_X + 3}`} className="block h-auto w-full" role="img" aria-labelledby={`${describedBy}-title`} aria-describedby={describedBy}>
      <title id={`${describedBy}-title`}>{title}</title>
      <rect x={-1.5} y={-1.5} width={83} height={CROP_X + 3} fill="var(--color-pitch)" />
      <g transform={frame}>
        {/* Mown stripes across the pitch */}
        {Array.from({ length: 4 }, (_, i) => (
          <rect key={i} x={i * 18 + 9} y={0} width={9} height={80} fill="var(--color-pitch-stripe)" />
        ))}
        <PitchLines />

        {/* Players beyond the crop: small markers on the top edge */}
        {beyond.map((t) => (
          <g key={`edge-${t.id}`} transform={`translate(${CROP_X + 0.4} ${t.dy})`} opacity={0.75}>
            {t.side === 'you' ? (
              <circle r={1.1} fill="var(--kit-you, var(--color-sky))" stroke="var(--color-ink)" strokeWidth={0.35} />
            ) : (
              <rect x={-1} y={-1} width={2} height={2} rx={0.5} fill="var(--kit-them, var(--color-vermilion))" stroke="var(--color-ink)" strokeWidth={0.35} />
            )}
          </g>
        ))}

        {marker && hero && (
          <line
            x1={marker.dx}
            y1={marker.dy}
            x2={hero.dx}
            y2={hero.dy}
            stroke="var(--color-ink)"
            strokeWidth={0.55}
            strokeDasharray="1.2 0.9"
            strokeLinecap="round"
            className="tx-fade-in"
          />
        )}

        {run && (
          <g className="tx-run" fill="none" stroke="var(--color-vermilion-deep)" strokeWidth={0.7} strokeLinecap="round" strokeLinejoin="round">
            <path d={run.line} pathLength={1} className="tx-draw" />
            <path d={run.head} className="tx-draw-head" />
          </g>
        )}

        {tokens.map((t) => (
          <g
            key={t.id}
            className="tx-glide"
            style={{ transform: `translate(${t.dx}px, ${t.dy}px)` }}
          >
            {t.hero && <circle r={t.r + 1.6} className="tx-pulse" fill="none" stroke="var(--color-vermilion-deep)" strokeWidth={0.6} />}
            {t.hero && <circle r={t.r + 1.6} fill="none" stroke="var(--color-ink)" strokeWidth={0.45} strokeDasharray="1.3 0.9" />}
            {t.side === 'you' ? (
              <circle r={t.r} fill="var(--kit-you, var(--color-sky))" stroke="var(--color-ink)" strokeWidth={t.id === marker?.id ? 0.8 : 0.5} />
            ) : (
              <rect
                x={-t.r}
                y={-t.r}
                width={t.r * 2}
                height={t.r * 2}
                rx={t.r * 0.38}
                fill="var(--kit-them, var(--color-vermilion))"
                stroke="var(--color-ink)"
                strokeWidth={t.hero ? 0.7 : 0.5}
              />
            )}
            <g transform={upright}>
              <text textAnchor="middle" dy={t.hero ? 1.05 : 0.8} fontSize={t.hero ? 2.9 : 2.2} className="score-narrow" fill={t.side === 'you' ? 'var(--kit-you-ink, var(--color-ink))' : 'var(--kit-them-ink, var(--color-ink))'}>
                {t.number ?? ''}
              </text>
              {t.label && t.labelAt && (
                <text
                  textAnchor={t.labelAt.anchor}
                  x={t.labelAt.x}
                  y={t.labelAt.y}
                  fontSize={t.hero ? 2.7 : 2.1}
                  fontWeight={t.hero ? 850 : 700}
                  fill="var(--color-ink)"
                  stroke="var(--color-chalk)"
                  strokeWidth={0.8}
                  paintOrder="stroke"
                >
                  {shortName(t.name)}
                </text>
              )}
            </g>
          </g>
        ))}
      </g>
    </svg>
  )
}

/** A short run from the threat down his channel towards your goal, in the team frame. */
function runArrow(hero: SceneToken) {
  const ring = hero.r + 1.8
  const sx = hero.dx - ring - 0.6
  const sy = hero.dy
  const tx = Math.max(12, hero.dx - ring - 13)
  const ty = hero.dy + (40 - hero.dy) * 0.18
  const ang = Math.atan2(ty - sy, tx - sx)
  const head = 1.7
  const h1 = [tx - head * Math.cos(ang - 0.5), ty - head * Math.sin(ang - 0.5)]
  const h2 = [tx - head * Math.cos(ang + 0.5), ty - head * Math.sin(ang + 0.5)]
  const cx = (sx + tx) / 2
  const cy = (sy + ty) / 2 + (hero.dy > 40 ? 1.5 : -1.5)
  return {
    line: `M${sx} ${sy} Q${cx} ${cy} ${tx} ${ty}`,
    head: `M${h1[0]} ${h1[1]} L${tx} ${ty} L${h2[0]} ${h2[1]}`,
  }
}
