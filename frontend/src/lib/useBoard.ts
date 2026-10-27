import { useCallback, useMemo, useState } from 'react'
import { threatCoverage, PITCH_X, PITCH_Y } from './model'
import type { ScenarioDetail, SnapshotPlayer, TacticKey } from './types'

export interface Sub {
  off_id: number
  on_id: number
}

/** Everything the manager can change on the board, plus live coverage. */
export function useBoard(detail: ScenarioDetail, teamId: number) {
  const side = detail.snapshot.sides[String(teamId)]
  const opp = Object.values(detail.snapshot.sides).find((s) => s.team_id !== teamId)!
  const [subs, setSubs] = useState<Sub[]>([])
  // Substitutions made before a live match resumed: they've happened and can't be undone.
  const [locked, setLocked] = useState(0)
  const [moved, setMoved] = useState<Record<number, { x: number; y: number }>>({})

  const onPitch: SnapshotPlayer[] = useMemo(() => {
    // In order, so a substitute can later be substituted himself.
    let players = side.players
    for (const sub of subs) {
      const incoming = side.bench.find((b) => b.id === sub.on_id)
      if (!incoming) continue
      players = players.map((p) =>
        p.id === sub.off_id
          ? ({ ...incoming, role: incoming.role ?? p.role, position: incoming.position ?? p.position, x: p.x, y: p.y } as SnapshotPlayer)
          : p,
      )
    }
    return players.map((p) => (moved[p.id] ? { ...p, ...moved[p.id] } : p))
  }, [side, subs, moved])

  const live = useMemo(() => threatCoverage(onPitch, side.threat_grid), [onPitch, side.threat_grid])
  const real = useMemo(() => threatCoverage(side.players, side.threat_grid), [side])

  const move = useCallback((id: number, x: number, y: number) => {
    setMoved((m) => ({ ...m, [id]: { x: clamp(x, 1, PITCH_X - 1), y: clamp(y, 1, PITCH_Y - 1) } }))
  }, [])

  const applyShape = useCallback(
    (tactic: TacticKey) => {
      const shape = detail.suggested_shapes[String(teamId)]?.[tactic]
      if (!shape) return
      const next: Record<number, { x: number; y: number }> = {}
      for (const pt of shape) {
        const sub = subs.find((s) => s.off_id === pt.player_id)
        next[sub ? sub.on_id : pt.player_id] = { x: pt.x, y: pt.y }
      }
      setMoved(next)
    },
    [detail, teamId, subs],
  )

  const substitute = useCallback(
    (offId: number, onId: number) => {
      // Subbing a substitute who just came on swaps the original slot,
      // unless that substitution has already happened in a live match.
      setSubs((current) => {
        const existing = current.findIndex((s) => s.on_id === offId)
        if (existing >= locked) return current.map((s, i) => (i === existing ? { ...s, on_id: onId } : s))
        return [...current, { off_id: offId, on_id: onId }]
      })
      setMoved((m) => {
        const pos = m[offId] ?? onPitch.find((p) => p.id === offId)
        const rest = { ...m }
        delete rest[offId]
        return pos ? { ...rest, [onId]: { x: pos.x, y: pos.y } } : rest
      })
    },
    [locked, onPitch],
  )

  const undoSub = useCallback((sub: Sub) => {
    setSubs((current) => current.filter((s) => s !== sub))
    setMoved((m) => {
      const pos = m[sub.on_id]
      const rest = { ...m }
      delete rest[sub.on_id]
      return pos ? { ...rest, [sub.off_id]: pos } : rest
    })
  }, [])

  const reset = useCallback(() => {
    setMoved({})
    setSubs((current) => current.slice(0, locked))
  }, [locked])

  const lockSubs = useCallback((count?: number) => setLocked(count ?? subs.length), [subs.length])

  const usedBench = new Set(subs.map((s) => s.on_id))
  const subsLeft = side.subs_allowed - side.subs_used - subs.length

  return {
    side,
    opp,
    onPitch,
    subs,
    subsLeft,
    bench: side.bench.filter((b) => !usedBench.has(b.id)),
    coverage: live.coverage,
    realCoverage: real.coverage,
    exposure: live.exposure,
    moved,
    move,
    applyShape,
    substitute,
    undoSub,
    reset,
    lockSubs,
    isLocked: (sub: Sub) => subs.indexOf(sub) < locked,
    placements: onPitch.map((p) => ({ player_id: p.id, x: p.x, y: p.y })),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
