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
  const [moved, setMoved] = useState<Record<number, { x: number; y: number }>>({})

  const onPitch: SnapshotPlayer[] = useMemo(() => {
    const players = side.players.map((p) => {
      const sub = subs.find((s) => s.off_id === p.id)
      if (!sub) return p
      const incoming = side.bench.find((b) => b.id === sub.on_id)!
      return {
        ...incoming,
        role: incoming.role ?? p.role,
        position: incoming.position ?? p.position,
        x: p.x,
        y: p.y,
      } as SnapshotPlayer
    })
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
      // Subbing a substitute who just came on swaps the original slot.
      setSubs((current) => {
        const existing = current.find((s) => s.on_id === offId)
        if (existing) return current.map((s) => (s === existing ? { ...s, on_id: onId } : s))
        return [...current, { off_id: offId, on_id: onId }]
      })
      setMoved((m) => {
        const pos = m[offId] ?? side.players.find((p) => p.id === offId)
        const rest = { ...m }
        delete rest[offId]
        return pos ? { ...rest, [onId]: { x: pos.x, y: pos.y } } : rest
      })
    },
    [side],
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
    setSubs([])
  }, [])

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
    placements: onPitch.map((p) => ({ player_id: p.id, x: p.x, y: p.y })),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
