# TACTIX

Manage the moments that changed football history. Pick a real match moment, take a side, set your shape on the pitch, choose a plan, and get a Gaffer Rating, the Pundit's Take, and what really happened next.

- **Touchline Challenge** (`/`, `/play/:slug`): the game.
- **Analyst Mode** (`/analyst/:matchId`): shot maps, passing networks, momentum, xG, and an analyst you can ask.

Match data comes from [StatsBomb Open Data](https://github.com/statsbomb/open-data).

## Run it locally

```bash
# 1. Database + API
docker compose up -d --build

# 2. Load the scenarios (first run, or after adding to app/scenarios_catalog.py)
docker compose exec backend python scripts/seed_db.py

# 3. Frontend (proxies /api to 127.0.0.1:8000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

On Windows the bind mount doesn't forward file changes into the container, so restart the API after backend edits with `docker restart tactix_backend`.

## Configuration

| Where | Variable | Purpose |
| --- | --- | --- |
| `backend/.env` | `DATABASE_URL` | Postgres + pgvector connection |
| `backend/.env` | `GEMINI_API_KEY` | Optional. Enables Gemini for the Pundit's Take, reading custom plans and Analyst Q&A. Without it, the model's own templated prose is used. |
| `backend/.env` | `GEMINI_MODEL` | Defaults to `gemini-2.5-flash` |
| `frontend/.env` | `VITE_API_URL` | API base URL in production (e.g. your Render URL). Leave empty locally. |

## How the evaluation works

`backend/app/services/simulation.py` scores a decision against how the team really lined up at that minute:

- coverage of the opponent's real threat map (where they actually received, carried and shot),
- defensive line height, distance between the lines, bodies in the final third, distance to their key threat,
- a tactic profile (depth, press, marking, attack) from the preset or your own words.

These scale each side's real chance rate over the rest of normal time, with score effects. The output is projected expected goals and a rating, never a win probability. Gemini only writes the explanation.

If the API is unreachable, the frontend falls back to bundled copies of the seeded data and a TypeScript port of the model (`frontend/src/lib/model.ts`), kept in step by a parity test.

## Adding a moment

Add a `ScenarioSpec` to `backend/app/scenarios_catalog.py` (match ID, competition/season IDs, minute, title, and each side's dilemma), then re-run the seeder. Players, positions, bench, threat maps and the real outcome are derived from the event data.

To refresh the offline copies after reseeding, re-download the API responses into `frontend/src/data/fixtures/`.

## Tests

```bash
cd backend && pytest tests
cd frontend && npm test && npm run lint && npm run build
```
