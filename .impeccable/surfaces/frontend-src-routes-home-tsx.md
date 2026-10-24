---
version: 1
slug: "frontend-src-routes-home-tsx"
primary_target: "frontend/src/routes/Home.tsx"
related_targets: ["frontend/src/routes/Play.tsx","frontend/src/routes/Analyst.tsx"]
---

# Touchline Challenge (home, play flow, verdict) + Analyst Mode

Scope: frontend/src routes `/` (Persuade), `/play/:slug` (Experience), `/analyst/:matchId` (Operate).
Audience: casual fans first, enthusiasts and data-curious second. Job: pick a real moment, take a side, set the shape and plan, get a verdict, replay.
Proof/content: real StatsBomb positions, threat maps, xG, what really happened. No invented win %, testimonials or user counts.
Direction source: pinned by the user's brief (Gumroad-inspired, cream/ink/green/vermilion/yellow/sky), refined mid-build by the user: soft pitch green (#8CC57E), brand vermilion #FF5A36 and ink #14161F from their favicon, broadcast-frame home redesign, redrawn passing network.

## Direction contract

THESIS: The moment is the page, framed like the broadcast. The first viewport is the real 70th minute of the 2022 final: a TV score bug, the true positions on the pitch, and the tactical choices in a lower third as the primary action. Refuses the split hero (copy left, screenshot right) and the feature-card grid.

OWN-WORLD: Programme-stock cream ground, pure black ink outlines (2px), pitch green fields that own whole bands, sky tokens for you, vermilion tokens for them, yellow for the one action that matters. Friendly radii (pills for chips, 14px panels), Gumroad-style lift with a hard ink shadow only on interactive things. Schibsted Grotesk for words, Anybody expanded black for numbers.

STORY: See the moment, understand the stakes in one line, choose a plan, move players and watch coverage react, blow the whistle, receive a stamped rating and a pundit's take next to what really happened, replay.

FIRST VIEWPORT: Thin top nav. Edge-to-edge soft-green striped band holding the pitch (sized to fit the viewport height) with 22 tokens at real 70' positions, Mbappé ringed and drawn on top. Ink score bug top-left: ARG (sky) 2–0 (cream) FRA (vermilion) and a yellow clock ticking on from 70:00. A cream lower third under a yellow date tab: the question as the h1 with one stakes line and a 'Manage France instead' link, beside four plan chips with drawn tactic glyphs (yellow on hover/focus). Primary action = choosing a chip; all of it visible at 1280x720.

FORM: Pinned brief world (Gumroad-inspired product UI + tactical board + editorial verdict). Signature interaction: drag a token and the live coverage meter and threat heat respond; choosing a plan springs the shape. Motion grammar: one stamp-thunk on the verdict rating; the score-bug clock ticks; tokens spring on shape change; nothing else animates on its own.
seed: none (direction pinned by the user's brief, so no roll was run)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
