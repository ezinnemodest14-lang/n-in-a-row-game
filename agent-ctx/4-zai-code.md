# Task 4 — NN Eval Mini-Service (port 3020)

Agent: Z.ai Code
Status: COMPLETE & VERIFIED RUNNING

## What was built
New independent bun project at `/home/z/my-project/mini-services/nn-service/` (zero npm deps, pure TS):

- **package.json** — `dev: "bun --hot index.ts"` (exact per spec).
- **features.ts** — `extractFeatures(board, n): Float64Array` + `FEATURE_DIM = 40` + `DIRS`.
  Layout: idx 0..23 = 4 directions (horiz, vert, diag-down \, diag-up /) × 2 players ×
  [maxConsecutiveRun/5, openEnds/2 of longest run, threatCount (runs ≥ 3)/8 saturating];
  24 stone density; 25 empty ratio; 26/27 center influence (corner-normalized mean distance);
  28/29 stone share; 30/31 line potential Σ(stones-in-line)² over win-capable lines, s/(s+n);
  32..35 mobility (4-neigh / 8-neigh per player ÷ emptyCount); 36 lastMoverBias; 37 turn slot
  (parity inference); 38/39 zero pads. All clamped [0,1]; symmetric P1/P2 ordering;
  board: 0 empty, 1 = P1 (human/emerald), 2 = P2 (AI). Output is P1-perspective positive.
- **neural-net.ts** — pure-TS MLP 40→128(ReLU)→64(ReLU)→1(Sigmoid), **13,569 params**
  (the plan's "~10,305" does not match the explicitly specified topology — topology wins).
  Adam (β1 0.9 / β2 0.999 / ε 1e-8, bias-corrected), MSE loss, He init (hidden) + Xavier
  (output) via mulberry32-seeded Box–Muller. API: `forward`, `trainBatch(X,y,lr)` (full-batch
  Adam step → MSE), `trainEpochs` (shuffled mini-batches, default bs 32), `evaluate` (MSE +
  sign-accuracy), `serialize`/`static load` (JSON incl. Adam moments, magic `nn-eval-v1`).
- **index.ts** — `Bun.serve` on **hardcoded port 3020**; CORS `*` + 204 preflight; startup
  try-loads `nn-model-weights.json` (try/catch fallback to seeded init). `/train` generates
  self-play data internally (adjacency-weighted playouts: take win, 85% block, run-extending
  weights + jitter; features recorded after each move; labels 1/0/0.5 P1-perspective), then
  trains (lr 0.005, batch 32, shuffle) and persists weights via Bun.write; 409 if already
  training; input clamps on all params.

## Endpoints
- `GET  /health` → `{ok, service:'nn-eval', featureDim:40, params, trained, weightsLoaded, trainingSamples}`
- `POST /predict {board:number[][], n}` → `{winProb1: 0..1 (P1 perspective), featuresUsed: true, tookMs}`
- `POST /train {games=60, boardSize=11, winLength=5, epochs=3}` → `{games, samples, lossBefore, lossAfter, accuracy, tookMs}`

## Verification results (live curls)
- Train `{games:80, boardSize:11, epochs:3}` → 80 games, **2,758 samples**, lossBefore **0.255894** → lossAfter **0.205154**, accuracy **0.6653**, 620 ms.
- Health after: `{"ok":true,"service":"nn-eval","featureDim":40,"params":13569,"trained":true,"weightsLoaded":true,"trainingSamples":2758}`.
- Predict sanity (5×5, P1 open three): winProb1 0.4900638924897244, 0.158 ms.
- Restart test: kill + restart → weightsLoaded:true, bit-identical predict output → deterministic restore OK. CORS preflight 204 verified.
- Weights file: `nn-model-weights.json` (809 KB).
- `bunx tsc --strict` passes on features.ts + neural-net.ts.

## Notes for other agents
- Reach via gateway: relative URL + `?XTransformPort=3020` (e.g. `/api/...?XTransformPort=3020` proxies to this service). NEVER write `localhost:3020` in frontend code.
- If the sandbox killed the service, restart + verify in ONE chained command:
  `cd /home/z/my-project/mini-services/nn-service && nohup bun run dev > /dev/null 2>&1 & disown; sleep 1.5; curl -s http://localhost:3020/health`
- Pending integration (next tasks): `src/lib/neural-server.ts` / `neural-client.ts` wrappers, 60% MCTS + 40% NN blend in the move route, EvalBar consumption of winProb1.
