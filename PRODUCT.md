# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Monorepo. Backend: Python, FastAPI, SQLAlchemy 2.0, PostgreSQL + pgvector, StatsBomb open data (statsbombpy). Frontend: Vite, React, TypeScript (chosen by the user in their implementation plan). Deploy targets: Vercel (frontend), Render or OCI (backend), Supabase (database).

## Users

- Casual football fans who should understand what to do without reading anything.
- Football enthusiasts who want control over formation, positioning, substitutions and tactical approach.
- Data-oriented users who move into Analyst Mode to inspect the evidence.

## Product Purpose

TACTIX lets fans manage famous match moments: it drops them into a real historical situation (e.g. Argentina 2–0 France, 70th minute, 2022 World Cup Final), lets them take a side, move players on a pitch in StatsBomb's 120 × 80 coordinate frame, pick or describe a tactic, and then see an evaluated, hypothetical outcome. Success is a user who replays the moment to try something else.

## Positioning

"What would you have done?" Not a stats site (tells you what happened), not an analytics platform (shows numbers), not a season-long manager game. One real moment, one decision, a verdict, and a reason to replay.

## Operating Context

Two experiences on shared match data and one visual identity:
- **Touchline Challenge** (primary): scenario pick → team pick → interactive pitch → tactic (Park the bus / High press / Mark the threat / Custom) → simulation → Gaffer Rating + Pundit's Take + share card.
- **Analyst Mode** (supporting): shot maps, pass networks, momentum, possession, xG, team comparison, AI-assisted analysis. Must never overwhelm the main game.

## Capabilities and Constraints

- Simulation is hybrid: a deterministic spatial model scores the decision from real event data; Gemini writes the Pundit's Take when `GEMINI_API_KEY` is set, with a templated fallback otherwise.
- The user's pitch changes (positions, substitutions) must actually influence the evaluation.
- No invented precise win-probability percentages. Any projected impact must come from a defined model and be labelled as an estimate.
- Ships with a handful of seeded StatsBomb scenarios. Planned: ingest every available match via an external data API so users can play any match; the scenario system must not assume a fixed list.
- Terminology: Gaffer Rating, The Pundit's Take, Touchline Challenge, Analyst Mode.

## Brand Commitments

- Name: TACTIX.
- Binding visual direction from the user: Gumroad-inspired main interface (bold headlines, friendly rounded components, generous whitespace, clear CTAs) in a cream, ink, green, vermilion, yellow and sky-blue palette; gameplay as a clean tactical board; results with a football-editorial feel (stamps or ticket elements allowed there, not everywhere). The earlier "Gaffer's Notebook" idea informs football details only.
- The user explicitly rejects generic, templated "AI-looking" design.

## Evidence on Hand

- StatsBomb open data events for seeded matches (2022 World Cup Final, match 3869685, plus additional seeded finals).
- No testimonials, user counts, press or validated win-probability model exist; do not fabricate them.

## Product Principles

1. The decision is the product; stats serve the decision.
2. Real moments, real coordinates: every scenario is anchored in actual match data.
3. Honest evaluation: explain reasoning, never fake precision.
4. Built for replay: every verdict invites another attempt.
5. Accessible before impressive.
