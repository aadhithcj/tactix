# TACTIX

Manage the moments that changed football history. Pick a real match moment, take a side, set your shape on the pitch, choose a plan, and get a Gaffer Rating, the Pundit's Take, and what really happened next.

- **Touchline Challenge** (`/`, `/play/:slug`): the game, starting from four curated moments (the 2022 World Cup Final at 71:27 is the headline one).
- **Any match** (`/moments/new`): pick any match in StatsBomb's open data, freeze it at a minute, and play it.
- **Analyst Mode** (`/analyst/:matchId`): shot maps, passing networks, momentum, xG, and an analyst you can ask.

Match data comes from [StatsBomb Open Data](https://github.com/statsbomb/open-data).

## What you need to add

Everything runs without keys. Add these to switch on the extras and to deploy:

| Where | Variable | Needed for |
| --- | --- | --- |
| `backend/.env` (local) or the API host | `GEMINI_API_KEY` | Gemini writing the Pundit's Take, reading "Your own plan" and answering Analyst questions. Without it the model's own prose and keyword reading are used. Get one at https://aistudio.google.com/apikey |
| API host | `DATABASE_URL` | Production Postgres with pgvector, e.g. Supabase. `postgres://` URLs are accepted as-is. |
| API host | `CORS_ORIGINS` | Your frontend's URL, comma-separated if more than one. Vercel previews are allowed by `CORS_ORIGIN_REGEX`. |
| Frontend host | `VITE_API_URL` | The API's public URL, e.g. `https://tactix-api.onrender.com`. |

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env` to start.

## Run it locally

```bash
# 1. Database + API (seeds the curated moments in the background on first start)
docker compose up -d --build

# 2. Frontend (proxies /api to 127.0.0.1:8000)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. To reseed by hand: `docker compose exec backend python scripts/seed_db.py`.

On Windows the bind mount doesn't forward file changes into the container, so restart the API after backend edits with `docker restart tactix_backend`.

## Deploy

**Database (Supabase).** Create a project and copy the connection string (Project settings, Database). The API enables the `vector` extension and creates its tables on first start.

**API (Render).** New, Blueprint, point it at this repo: `render.yaml` defines the service. Set `DATABASE_URL`, `CORS_ORIGINS` and optionally `GEMINI_API_KEY`. On first start it fetches the curated moments from StatsBomb (about a minute); `GET /api/health` reports when the database is reachable. Any Docker host works the same way: the image honours `$PORT`.

**Frontend (Vercel).** Import the repo with root directory `frontend` (Vite preset, build `npm run build`, output `dist`) and set `VITE_API_URL`. The build prerenders the home page into `index.html` so it renders without JavaScript; `vercel.json` sends every other route to the app shell.

## How the evaluation works

`backend/app/services/simulation.py` scores a decision against how the team really lined up at that minute:

- coverage of the opponent's real threat map (where they actually received, carried and shot),
- defensive line height, distance between the lines, bodies in the final third, distance to their key threat,
- a tactic profile (depth, press, marking, attack) from the preset or your own words.

These scale each side's real chance rate over the rest of normal time, with score effects. The output is projected expected goals and a rating, never a win probability. Gemini only writes the explanation.

If the API is unreachable, the frontend falls back to bundled copies of the curated moments and a TypeScript port of the model (`frontend/src/lib/model.ts`), kept in step by a parity test.

## Adding moments

- **Curated:** add a `ScenarioSpec` to `backend/app/scenarios_catalog.py` (match, competition and season IDs, minute and optional second, title, each side's dilemma) and run the seeder. Retired slugs are removed on a full seed. Refresh the offline copies in `frontend/src/data/fixtures/` from the API afterwards.
- **Any match:** `POST /api/catalog/moments` with a competition, season, match and minute builds one on demand (the "Pick any match" page uses it). Titles and dilemmas are written from the score and time left.
- **Kits:** team colours live in `frontend/src/lib/kits.ts`, with a change kit for clashes.

To go beyond StatsBomb's open data (every match ever), swap the event source in `backend/app/services/data_engine.py` and `moments.py` for a licensed feed; the snapshot builder and the model only need events in StatsBomb's shape.

## Tests

```bash
cd backend && pytest tests
cd frontend && npm test && npm run lint && npm run build
```
