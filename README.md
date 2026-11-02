# Ambatukam Game

A webcam meme game: make a fist as if you're gripping a rod and stroke up and down as fast as you can.
Hand tracking runs entirely in your browser, and your video never leaves your device.

**Play:** https://ambatukam.bahao.site

> For fun, 16+. Nothing explicit: the game only sees hand landmarks and draws a virtual rod.

![Start screen](docs/start.png)

## Features

- **Four modes:**

  | Mode | How it works | Score |
  |---|---|---|
  | **Single** | One hand, one rod, 10 / 20 / 30 s | Average strokes per second |
  | **Double** | Two hands, two rods, strokes add up | Average strokes per second |
  | **Random** | The rod keeps moving. Chase it to keep the **Heat** meter from running out | Seconds survived |
  | **PvP** | 1v1 on the same clock, Single or Double | Most strokes wins |

- **Leaderboard** for every mode and duration, with server-side anti-cheat checks.
- **Optional accounts:** a username and password, an optional email for password resets, a public
  profile at `/u/<name>` and a friend list that shows who is online. Guests can still play and submit
  scores.
- **PvP:** send a challenge link, invite a friend who is online, or get paired with a random opponent.
  Camera and voice are opt-in, and only turn on when both players agree.
- **English and Vietnamese**, switched with the EN / VI toggle.

## How to play

1. Pick a mode (and a duration), then press **Start camera & play**. After this click you only need
   your hands.
2. **Open your palm** for 1 s to get ready.
3. **Make a fist** and hold still for 1 s. The game places a virtual rod in your hand, tilted the way
   you grip it. In Double, grip with both hands. In Random, the rod appears on its own.
4. After 3-2-1, **stroke along the rod**. A stroke only counts while your fist stays on the rod.
5. The result shows your speed, rank title and record. Submit it to the leaderboard, save a
   1080×1080 image, or open your palm for 1 s to play again.

![Playing](docs/play.png)
![Result](docs/result.png)

## How it works

```
Browser                                      Cloudflare (one Worker)
┌──────────────────────────────┐            ┌────────────────────────────────────────┐
│ React UI                     │   /api/*   │ FastAPI on Python Workers              │
│ Game engine (TypeScript)     │ ─────────▶ │   D1: scores, accounts, friends,       │
│ MediaPipe hand landmarker    │            │       matches                          │
│ (camera stays on the device) │ ◀── WS ──▶ │   Durable Objects: PvP rooms, lobby    │
└──────────────────────────────┘            │ Static assets: the built frontend      │
                                            └────────────────────────────────────────┘
```

- **Hand tracking:** MediaPipe returns 21 landmarks per hand on every frame. The engine measures hand
  size, then works out grip (how far the fingers are curled), the rod axis (from the knuckle line) and
  strokes (direction changes along that axis). Every threshold scales with hand size, so standing
  closer or farther away doesn't matter. All tuning values are in `frontend/src/game/constants.ts`.
- **Backend:** stores names, scores and per-second stroke counts, never video. It also runs accounts,
  friends and PvP rooms.
- **PvP video and voice** go peer to peer through Cloudflare's TURN relay. This keeps each player's IP
  address hidden from the other.

## Anti-cheat

Scores are computed in the browser, so cheating can't be ruled out; the server makes it hard:

- Every run gets a single-use, HMAC-signed session token. A score is refused if it arrives before the
  run could have ended, or more than 15 minutes after it.
- The client sends a stroke count for each second, along with its frame rate and how much of the run
  the hand was on the rod. The server checks:
  - The per-second counts add up to the total.
  - Speed stays within human limits: at most 8 strokes/s per hand on average and 10 in any single
    second, and never more than the frame rate allows.
  - The rhythm isn't machine-regular.
- In Random, the server rebuilds the Heat meter second by second.
- Cloudflare Turnstile and per-IP rate limits apply on submit.

PvP is timed by the server. It checks live counts as they arrive and runs the same checks on the
final run. A run that fails counts as a loss.

The rules live in `backend/src/app/rules.py` and `backend/src/app/services/anticheat.py`.

## Privacy

- Video and audio stay on your device, except PvP camera or voice that both players turned on.
- Passwords are hashed with PBKDF2-SHA256. Session tokens and reset links are stored only as SHA-256
  hashes.
- IP addresses are used only as rate-limit keys and are never stored.

## Development

You need Node 22+ and [uv](https://docs.astral.sh/uv/) 0.13.4 or newer.

```bash
git clone https://github.com/NBaHao/ambatukam-game.git
cd ambatukam-game
make install         # npm ci + uv sync + local env files from the *.example templates
make migrate-local   # create the local D1 tables
make dev-api         # Worker (API) on http://localhost:8787
make dev-web         # Vite on http://localhost:5173, open this one
```

Browsers only allow the camera on `localhost` or HTTPS. Before committing, run
`make lint test build`.

**Debug** (only under `make dev-web`):

| URL | What it does |
|---|---|
| `?debug` | Shows diagnostics and exposes `window.__amb`, for example to feed in a fake hand |
| `?debug&auto=play` / `result` / `top10` | Jumps straight to a screen |
| `&mode=single\|double\|random`, `&lang=en\|vi` | Preselects the mode and language |

API docs (OpenAPI): http://localhost:8787/api/docs

## Deployment

Every push to `main` is built and deployed by Cloudflare Workers Builds. The deploy step applies
pending D1 migrations before it deploys the Worker. To deploy by hand, run `make deploy`.

Required secrets are `TOKEN_SECRET` and `TURNSTILE_SECRET`. Optional features turn on when their
secrets are set:

| Feature | Secrets |
|---|---|
| PvP video and voice | `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (Cloudflare Realtime TURN) |
| Password reset by email | `RESEND_API_KEY` ([Resend](https://resend.com)) |

Everything fits in Cloudflare's free tier. Setup steps, environment variables and the release
checklist are in [AGENTS.md](AGENTS.md).

## Project layout

```
frontend/   React 19 + TypeScript (Vite)
  src/game/     game engine: hand tracking, stroke counting, canvas (no React)
  src/pvp/      PvP rooms, matchmaking, WebRTC
  src/friends/  friends, presence, invites
backend/    FastAPI on Cloudflare Python Workers
  src/app/      routers, services, rules, D1 repositories
  migrations/   D1 schema
  tests/        pytest (fake D1, clock and captcha)
docs/       screenshots
```

## Contributing

Read [AGENTS.md](AGENTS.md) first. It covers code conventions, the values that must stay in sync
between frontend and backend, and the branch, commit and PR rules: work on a branch, use
Conventional Commits, and open PRs against `main`.

## License

The source code is released under the [MIT License](LICENSE).

The audio clips in `frontend/src/assets/audio` are not covered by it:

- The meme voice lines and the 3-2-1-GO voice are cut from third-party clips with no clear license.
- The countdown effects come from Mixkit under the
  [Mixkit Sound Effects Free License](https://mixkit.co/license/#sfxFree).

If you reuse this project, replace those files or check their terms yourself.
