const PITCH_X = 120
const PITCH_Y = 80

/** Chalk markings for a 120 x 80 StatsBomb pitch, attacking right. */
export function PitchLines() {
  const chalk = { fill: 'none', stroke: 'var(--color-chalk)', strokeWidth: 0.45, pointerEvents: 'none' as const }
  return (
    <g {...chalk}>
      <rect x={0.25} y={0.25} width={PITCH_X - 0.5} height={PITCH_Y - 0.5} />
      <line x1={60} y1={0} x2={60} y2={80} />
      <circle cx={60} cy={40} r={10} />
      <circle cx={60} cy={40} r={0.5} fill="var(--color-chalk)" />
      {/* Your end (left) */}
      <rect x={0} y={18} width={18} height={44} />
      <rect x={0} y={30} width={6} height={20} />
      <circle cx={12} cy={40} r={0.5} fill="var(--color-chalk)" />
      <path d="M18 32.7 A10 10 0 0 1 18 47.3" />
      <rect x={-1} y={36} width={1} height={8} strokeWidth={0.35} />
      {/* Their end (right) */}
      <rect x={102} y={18} width={18} height={44} />
      <rect x={114} y={30} width={6} height={20} />
      <circle cx={108} cy={40} r={0.5} fill="var(--color-chalk)" />
      <path d="M102 32.7 A10 10 0 0 0 102 47.3" />
      <rect x={120} y={36} width={1} height={8} strokeWidth={0.35} />
    </g>
  )
}
