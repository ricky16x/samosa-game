# The Great Samosa Run 🛵

A tiny retro-pixel arcade game set in Delhi. Dodge autos, cows, buses and potholes, collect samosas and chai, and keep your delivery hot.

## Features
- Top-down endless traffic runner
- Mobile touch controls: on-screen left/right buttons and swipe steering
- Three lanes, increasing speed, collision/invulnerability, heat meter
- Chai boosts heat; extra samosas award points
- Five-delivery win condition, local personal best, pause and sound toggle
- Go serverless API at `/api/score` for validating a score submission

## Run locally
The game frontend is static. From this directory:

```bash
go run ./local.go
```

Or use any static file server. For example:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. The Go API is deployed as a Vercel Function; the static game can be tested without it.

## Deploy to Vercel
1. Push this folder to a GitHub repository.
2. Import the repository in Vercel.
3. Use the project root as the root directory. No build command is needed.
4. Deploy. Vercel serves `index.html`, `style.css`, and `game.js` as static assets and builds `api/score.go` as a Go Function.
5. Open the deployment URL on a phone. Add it to your home screen for an app-like experience.

## API
`POST /api/score`

```json
{"score": 1250, "deliveries": 3}
```

The function validates the payload and returns an acknowledgement. It does **not** store a global leaderboard: Vercel Functions are stateless. The current personal best is stored locally in the player's browser (`localStorage`). Add Vercel KV, Postgres, or another persistent database to support a shared leaderboard.

## Controls
- Tap ◀ / ▶ to change lanes.
- Swipe left/right on the road to steer.
- Tap pause to take a chai break.

## Source size
The hand-written project is intentionally small (well below 2,000 lines). No framework or runtime dependency is required for the game client.
