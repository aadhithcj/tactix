import { toPng } from 'html-to-image'
import { Download } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ScenarioDetail, SimulationResult } from '../lib/types'
import { competitionName } from './Chrome'

/** A matchday-ticket share card, exported as a PNG. */
export function ShareTicket({ detail, result }: { detail: ScenarioDetail; result: SimulationResult }) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')
  const snap = detail.snapshot
  const side = snap.sides[String(result.team_id)]
  const home = snap.sides[String(snap.match.home_team_id)]
  const away = snap.sides[String(snap.match.away_team_id)]
  const plan = result.tactic === 'custom' ? 'Own plan' : result.profile.label

  const save = async () => {
    if (!ref.current) return
    setState('saving')
    try {
      const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: '#fbf0d9' })
      const a = document.createElement('a')
      a.href = url
      a.download = `tactix-${detail.slug}-${side.code.toLowerCase()}.png`
      a.click()
      setState('idle')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="w-full min-w-0 max-w-[460px]">
      <div ref={ref} className="p-2">
        <div className="flex overflow-hidden rounded-[14px] border-2 border-ink bg-paper">
          <div className="flex w-[34%] flex-col items-center justify-center gap-1 border-r-2 border-dashed border-ink bg-yellow px-2 py-5 text-center">
            <span className="text-xs font-[800]">Gaffer Rating</span>
            <span className="score text-5xl">{result.gaffer_rating.toFixed(1)}</span>
            <span className="text-xs font-[750]">{result.rating_label}</span>
          </div>
          <div className="min-w-0 flex-1 p-4">
            <p className="score mt-1 text-[clamp(0.95rem,4vw,1.25rem)]">
              <span className="whitespace-nowrap">
                {home.code} {snap.score.home}–{snap.score.away} {away.code}
              </span>{' '}
              <span className="rounded bg-vermilion px-1 text-sm align-middle">{snap.minute}'</span>
            </p>
            <p className="mt-1 text-xs font-semibold text-ink-soft">
              {competitionName(snap.match.competition)} final, {new Date(snap.match.date).getFullYear()}
            </p>
            <p className="mt-2 text-sm leading-snug">
              I managed <strong>{side.name}</strong> with <strong>{plan.toLowerCase()}</strong>.
            </p>
            <p className="mt-2 text-sm font-[800] leading-snug">“{result.pundit.headline}”</p>
            <p className="score mt-3 text-sm">TACTIX</p>
          </div>
        </div>
      </div>
      <button type="button" onClick={save} disabled={state === 'saving'} className="btn btn-plain lift mt-2 w-full">
        <Download size={18} strokeWidth={2.5} aria-hidden="true" />
        {state === 'saving' ? 'Saving image…' : 'Save as image'}
      </button>
      {state === 'error' && (
        <p role="alert" className="mt-2 text-sm font-semibold text-vermilion-deep">
          The image couldn't be created in this browser. Try a screenshot instead.
        </p>
      )}
    </div>
  )
}
