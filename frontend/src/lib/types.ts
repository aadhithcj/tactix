export type Role = 'GK' | 'DEF' | 'MID' | 'FWD'
export type TacticKey = 'park_bus' | 'high_press' | 'mark_threat' | 'custom'

export interface SnapshotPlayer {
  id: number
  name: string
  number: number | null
  position: string
  role: Role
  x: number
  y: number
  touches?: number
}

export interface BenchPlayer {
  id: number
  name: string
  number: number | null
  position: string | null
  role: Role | null
}

export interface KeyThreat {
  player_id: number
  name: string
  number: number | null
  x: number
  y: number
  xg: number
  shots: number
  final_third_passes: number
  threat_share: number
}

export interface Side {
  team_id: number
  name: string
  code: string
  is_home: boolean
  formation: string
  dilemma: string
  players: SnapshotPlayer[]
  bench: BenchPlayer[]
  subs_used: number
  subs_allowed: number
  threat_grid: number[][]
  key_threat: KeyThreat | null
  baseline: {
    xg_for_per_min: number
    xg_against_per_min: number
    xg_for_so_far: number
    xg_against_so_far: number
  }
  actual_after: { xg_for: number; xg_against: number }
}

export interface Goal {
  minute: number
  period: number
  team: string
  player: string
}

export interface Snapshot {
  match: {
    id: number
    competition: string
    season: string
    date: string
    venue: string
    home_team_id: number
    away_team_id: number
    home: string
    away: string
  }
  minute: number
  horizon_minutes: number
  full_time_minute: number
  score: { home: number; away: number }
  sides: Record<string, Side>
  actual: {
    goals_after: Goal[]
    score_at_full_time: { home: number; away: number }
    final_score: { home: number; away: number }
    went_to_extra_time: boolean
    shootout: Record<string, number> | null
  }
}

export interface ShapePoint {
  player_id: number
  x: number
  y: number
}

export interface ScenarioDetail {
  slug: string
  title: string
  tagline: string
  minute: number
  snapshot: Snapshot
  suggested_shapes: Record<string, Record<string, ShapePoint[]>>
}

export interface ScenarioSummary {
  slug: string
  title: string
  tagline: string
  minute: number
  match_id: number
  competition: string
  season: string
  date: string
  venue: string
  home: string
  away: string
  score: { home: number; away: number }
  final_score: { home: number; away: number }
  sides: { team_id: number; name: string; code: string; dilemma: string }[]
}

export interface Metric {
  key: string
  label: string
  value: number
  baseline: number
  unit: string
  better: 'higher' | 'lower' | 'context'
}

export interface ExposedZone {
  x: number
  y: number
  w: number
  h: number
  share: number
  label: string
}

export interface Finding {
  tone: 'good' | 'bad' | 'neutral'
  text: string
}

export interface SimulationRequest {
  team_id: number
  tactic: TacticKey
  custom_plan?: string | null
  placements: ShapePoint[]
  substitutions: { off_id: number; on_id: number }[]
}

export interface SimulationResult {
  scenario: string
  team_id: number
  opponent_id: number
  tactic: TacticKey
  profile: { depth: number; press: number; marking: number; attack: number; label: string }
  plan_source: 'gemini' | 'model' | 'preset'
  gaffer_rating: number
  rating_label: string
  structure_fit: number
  projection: {
    minutes: number
    xg_for: number
    xg_against: number
    baseline_xg_for: number
    baseline_xg_against: number
    likely_score: { home: number; away: number }
  }
  metrics: Metric[]
  exposed_zones: ExposedZone[]
  findings: Finding[]
  lineup: SnapshotPlayer[]
  substitutions: { off: string; on: string }[]
  pundit: { headline: string; take: string; source: 'gemini' | 'model' }
  actual: Snapshot['actual'] & { xg_for_after: number; xg_against_after: number }
  model_note: string
}

export interface MatchSummary {
  id: number
  competition: string
  season: string
  match_date: string
  home_team_id: number
  away_team_id: number
  home_score: number
  away_score: number
  home_xg: number
  away_xg: number
  home_team: { id: number; name: string } | null
  away_team: { id: number; name: string } | null
}

export interface TeamStats {
  team_id: number
  name: string
  possession_pct: number
  total_xg: number
  shootout_xg: number
  total_passes: number
  successful_passes: number
  pass_accuracy_pct: number
  total_shots: number
}

export interface MomentumBucket {
  minute: number
  interval: string
  team_home: string
  team_away: string
  home_xg: number
  away_xg: number
  home_progressive_passes: number
  away_progressive_passes: number
  momentum: number
}

export interface PassNetwork {
  team_name: string
  edges: { source: number; source_name: string; target: number; target_name: string; weight: number }[]
  nodes: { id: number; name: string; x: number; y: number; passes: number; number?: number | null }[]
}

export interface MatchDetail extends MatchSummary {
  stats: {
    team_stats?: { teams: Record<string, TeamStats> }
    pass_networks?: Record<string, PassNetwork>
    momentum_timeline?: MomentumBucket[]
  }
  scenario_slugs: string[]
}

export interface MatchEvent {
  id: string
  minute: number
  second: number
  period: number | null
  team_id: number
  player_id: number | null
  player_name: string | null
  event_type: string
  x: number | null
  y: number | null
  end_x: number | null
  end_y: number | null
  xg: number | null
  outcome: string | null
  play_pattern: string | null
}
