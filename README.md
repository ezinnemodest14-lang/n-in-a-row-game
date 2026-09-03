# N-in-a-Row — Gomoku-Style Strategy Game

A full-stack N-in-a-row (Gomoku-like) game with a tournament-grade AI: **MCTS + RAVE** search, an 8-level **tactical safety net**, a **pure-TypeScript neural network** evaluator, persistent AI learning across sessions, a 14-section live analysis panel, and a **neural game review** that grades every move you play.

Built with Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui · Prisma + SQLite · Bun mini-service.

---

## ✨ Features

| Area | What you get |
|---|---|
| **Game modes** | Classic (first to N in a row, boards 3×3 → 24×24, win length 3–8) and Score Attack (points for triples/fours/fives, cross patterns, line breaks) |
| **AI engine** | UCT-MCTS with RAVE (C=220), root threat-prior bias, 3-level tree reuse between moves, playout policy with fork tiers — 100 to 50,000 simulations per move |
| **Tactical safety net** | 8-level priority override: win → block-win → open-four → block-four → counter-four → fork → block-fork → block-open-three (the AI never blunders a forced sequence) |
| **Neural evaluator** | Custom 40-feature MLP (no ML libraries) scoring win probability; blends with MCTS and powers NN move suggestions for *you* |
| **Persistent learning** | GlobalRAVE statistics survive restarts via SQLite; cross-game learning inherits knowledge between board sizes |
| **Self-play training** | Quick-Train runs thousands of AI-vs-AI games to seed the RAVE tables and train the neural net |
| **Game review** | NN replay of the whole game grades every move (brilliant → blunder), win-prob curve, accuracy %, human-readable takeaways |
| **Analysis panel** | 14 live sections: eval bar, threat counts, critical squares, tempo, board control, scoring projections, AI candidate moves with visit stats, and more |

---

## 🚀 Quick start

### Option A — Play instantly (Windows, no installs)
Download `n-in-a-row-portable-win64.zip` from the [Releases page](../../releases), unzip anywhere, **double-click `start.cmd`**. The browser opens at `http://localhost:3000`. Nothing else is required — Node runtime, server, and database are all inside.

### Option B — Run from source (any OS)
Requirements: **Node.js 20+** (or Bun), npm.

```bash
git clone https://github.com/ezinnemodest14-lang/n-in-a-row-game.git
cd n-in-a-row-game
npm install
npx prisma generate          # generate the Prisma client
npx prisma db push           # create db/custom.db (SQLite)
npm run dev                  # dev server on http://localhost:3000
```

### Option C — Production build

```bash
npm run build                # next build + standalone assembly (scripts/postbuild.mjs)
node .next/standalone/server.js   # serve on http://localhost:3000
```

Set `DATABASE_URL` if you want a specific SQLite file (default: `file:../db/custom.db`, resolved relative to `prisma/schema.prisma`).

---

## 🏗️ Architecture

```
┌────────────────────────────── Browser ──────────────────────────────┐
│  React 19 UI (Next.js App Router)                                   │
│  Board · AnalysisPanel (14 sections) · QuickPreview · EvalBar ·     │
│  Settings · Toolbar · GameInfo · ArchInfo                           │
│  State: zustand (src/store/game-store.ts)                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ fetch (JSON)
┌──────────────────────────────▼──────────────────────────────────────┐
│  Next.js server (Node.js) — API routes                              │
│   POST /api/game/new      → new game state                          │
│   POST /api/game/move     → player move + full AI turn + analysis   │
│   POST /api/game/review   → NN replay + per-move grading            │
│   POST /api/game/train    → self-play training run                  │
│                                                                      │
│  Game engine (src/lib/game/)                                        │
│   threat-classifier.ts  8-level tactical safety net, gap patterns   │
│   mcts.ts               UCT + RAVE, GlobalRAVE table, tree reuse    │
│   analyzer.ts           builds the 14-section analysis contract     │
│   scoring.ts            Score-Attack weights & breakdowns           │
│   nn-suggestions.ts     NN-based move hints for the human player    │
│   engine-runtime.ts     RAVE load/save via Prisma                   │
│                                                                      │
│  Prisma + SQLite (db/custom.db)                                     │
│   RaveMemory    persistent AI memory per (boardSize, mode)          │
│   TrainingRun   quick-train history                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP localhost:3020 (self-healing)
┌──────────────────────────────▼──────────────────────────────────────┐
│  nn-eval mini-service (Bun, mini-services/nn-service/)              │
│   GET  /health          service + model status                      │
│   POST /predict         { board, n } → win probability              │
│   POST /predict-batch   used by game review replay                  │
│   POST /train           self-play generation + weight update        │
│                                                                      │
│  Pure-TypeScript MLP over a 40-dim handcrafted feature vector:      │
│  4 directions × 2 players × (max run / open ends / threat count),   │
│  density, center influence, stone share, line potential, mobility,  │
│  turn parity. Weights persist to nn-model-weights.json.             │
└──────────────────────────────────────────────────────────────────────┘
```

### How an AI move is computed (`POST /api/game/move`)

1. **Tactical safety net** — before searching, the threat classifier checks 8 forced-move priorities. If one fires, the move is played instantly (reason reported to the UI).
2. **MCTS + RAVE search** — UCT tree search with RAVE statistics loaded from persistent memory, threat-prior progressive bias at the root, and tree reuse from the previous move.
3. **Neural blend** — if the NN service is healthy, its win-probability evaluation is blended into the candidate ranking and NN suggestions are generated for the player's next turn.
4. **Analysis** — built from the exact board the search ran on (threats, tempo, board control, scoring pace, critical squares) and returned with the move.

### Graceful degradation

The neural service is **optional**. `src/lib/neural-client.ts` health-checks `localhost:3020`, (re)spawns it automatically as a detached process when possible, and on repeated failure degrades to **MCTS-only** evaluation — the game always works, just without NN scoring/review. The NN service requires the [Bun runtime](https://bun.sh); without it the app runs in MCTS-only mode.

> In production the mini-service sits behind a Caddy gateway (`Caddyfile`, `?XTransformPort=3020`); locally it is reached directly on port 3020.

---

## 🧠 Algorithm deep dive

### Search: UCT-MCTS with a persistent global prior

Selection at each tree node maximizes:

```
score = β · raveRate + (1 − β) · UCT
UCT   = Q + √2 · √(ln N / (n + ε))
β     = √(C / (3n + C)),   C = 220
```

- **Q** — the child's empirical win rate; **N** — parent visits; **n** — child visits.
- `raveRate` comes from a **persistent, position-independent statistics table** keyed by `(player, cell)` per `(boardSize, gameMode)`. Every playout move updates the table, and the table survives restarts via SQLite (`RaveMemory`). It behaves as a learned, slowly-evolving move prior rather than textbook per-node AMAF/RAVE (see limitations).
- **Root progressive bias** — at the root only, threat-classifier scores add
  `0.9 · min(1, score/CAT_VALUE[OPEN_FOUR]) · √(ln(N+2)) / (n+8)`, so forced-looking cells get explored first and the bias decays as visits accumulate.
- **Tree reuse** — between turns the previous tree is descended into (verified by replaying the move path and byte-comparing boards), keeping statistics that are still valid.
- **Playout policy** — a fast tactical ladder (win → open four → block win → block four → fork → block fork → block open three), then a threat/score-weighted softmax (weights capped at 40 for diversity) multiplied by a RAVE-rate boost `0.6 + 0.8 · raveRate`. Playout moves feed the persistent table (except during Quick-Train, which uses zero decay by design).
- Move choice = **most-visited root child**; deterministic `mulberry32` seeding makes searches reproducible given a seed.

### Tactical safety net (threat classifier v3 + safety layer v4)

A cell classifier grades every empty cell per direction: solid runs, **gap-aware** patterns (`X_XX`, `XX_XX`), forks (two strong directions of any type), and double open-threes, on a 9-level scale (`NONE → ONE → TWO → SIMPLE_THREE → BROKEN_THREE → OPEN_THREE → SIMPLE_FOUR → OPEN_FOUR → WIN`).

Two layers use it:

1. **Root override** — before shipping the search's move, an 8-priority ladder checks win → block-win → open-four → block-open-four → block-four → (safety-scored open-three defense) → fork → block-fork → block-open-three. Forced situations are resolved by **`chooseSafeDefense`**, which simulates every candidate block and scores the opponent's resulting forcing outlook (danger 100 = ≥2 five-completions … −60 = we get ≥2). This prevents the classic Gomoku blunder of blocking a lagged four while the open three stays alive.
2. **Final guarantee** — after the NN blend, `ensureSafeMove` vetoes any move that would leave the opponent an unstoppable four; overrides are reported in the move reasoning.

### Neural evaluator (optional layer)

A dependency-free MLP (`mini-services/nn-service/`) over a **40-dimensional handcrafted feature vector**: per-direction max run / open ends / threat count for both players, stone density, center influence, stone share, line potential, mobility (4- and 8-neighborhood), and turn parity — all in [0,1], player-symmetric so the output reads as player-1 win probability. It contributes in two places:

- **Blend re-ranking** — when the search itself picked the move, the top root children are re-scored as `0.6 · MCTS winRate + 0.4 · NN winProb` and the best blended score wins. Tactical overrides always stand.
- **Player suggestions** — after the AI moves, the top tactical + positional candidates are simulated and NN-scored *for you*, tagged with the classifier's threat description, with an "engine and net agree" flag.

### Known algorithmic limitations & improvement roadmap

| # | Limitation | Planned improvement | Impact | Effort |
|---|---|---|---|---|
| 1 | Playout tactical checks scan **all** empty cells for both players — the dominant cost on large boards | Restrict playout/selection candidates to cells within distance 2 of existing stones (standard in strong Gomoku engines) | 5–20× more simulations/sec | Small |
| 2 | Safety net is 1-ply; deep forced sequences (chain of fours → double threat) can slip through | Recursive **VCF/VCT threat-space search** (Allis 1994) over forcing moves only | Biggest playing-strength gain | Medium |
| 3 | The persistent prior is position-independent — not textbook per-node AMAF/RAVE; β shrinks with child visits only | Per-node AMAF statistics, keeping the global table as cold-start prior | Better move quality per simulation | Medium |
| 4 | Tree nodes are keyed by move-from-parent — transpositions duplicate subtrees | Zobrist hashing + transposition table | Smaller tree, stronger reuse | Medium |
| 5 | Selection blends a [0,1] prior with an unbounded UCT term, damping exploration early | Blend values only (`(1−β)Q + β·raveQ`), add exploration separately | Cleaner search statistics | Trivial |
| 6 | NN blend re-ranks after search; low-visit children's win rates are noise blended at full weight | PUCT-style NN prior inside selection (AlphaZero-like) + visit-weighted blending + batch inference | Stronger, faster NN integration | Medium |

---

## 📦 Building the portable bundle (Windows)

```cmd
scripts\build-bundle.cmd
```

This runs `npm run build`, copies a `node.exe` runtime into the standalone output, and produces **`download/n-in-a-row-portable-win64.zip`** — a fully self-contained folder:

```
├── start.cmd              double-click launcher (sets DATABASE_URL, opens browser)
├── runtime\node.exe       bundled Node.js — no install needed on target machines
├── server.js              Next.js standalone server
├── .next\                 compiled app + traced minimal node_modules
├── public\                static assets
└── db\custom.db           SQLite database (AI memory travels with the bundle)
```

The launcher computes the database path from its own location at startup, so the bundle runs from **any folder on any Windows machine**.

---

## 🔧 Configuration

| Setting | Where | Default |
|---|---|---|
| `DATABASE_URL` | `.env` | `file:../db/custom.db` (relative to `prisma/`) |
| Web server port | `PORT` env / `start.cmd` | `3000` |
| NN service port | hardcoded by design | `3020` |

Prisma commands: `npm run db:push` (apply schema), `db:generate` (regenerate client), `db:migrate`, `db:reset`.

## 📁 Project structure

```
src/
├── app/                    Next.js App Router
│   ├── page.tsx            game page (composes all UI components)
│   └── api/game/           new | move | review | train routes
├── components/game/        Board, AnalysisPanel, QuickPreview, EvalBar,
│   └── ...                 Settings, Toolbar, GameInfo, ArchInfo
├── components/ui/          shadcn/ui primitives
├── lib/game/               the engine (see architecture above)
├── lib/neural-client.ts    server-side NN service client (self-healing)
├── lib/db.ts               Prisma singleton
└── store/game-store.ts     zustand game state
mini-services/nn-service/   Bun neural evaluator (port 3020)
prisma/schema.prisma        RaveMemory + TrainingRun models
scripts/                    postbuild.mjs · build-bundle.cmd · start.cmd
```

## 🧪 Development

```bash
npm run dev       # dev server (http://localhost:3000)
npm run lint      # eslint
npm run build     # production build + standalone assembly
```

## 📝 Notes & known limitations

- The portable bundle is **Windows-only** (bundled `node.exe`); on macOS/Linux build from source instead.
- The neural service needs **Bun**; without it the app automatically runs in MCTS-only mode.
- The NN service uses a fixed port (`3020`) by design so the Caddy gateway can route to it.
- Board coordinates are Go-style and skip the letter `I`.

