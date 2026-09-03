/**
 * index.ts — nn-eval mini-service (Bun runtime, hardcoded port 3020).
 *
 * A standalone neural-network evaluator for the N-in-a-row game. The Next.js
 * app reaches it through the Caddy gateway with `?XTransformPort=3020`, so it
 * must only ever serve relative-path JSON APIs on this fixed port.
 *
 * Routes (all JSON, CORS-enabled for any origin):
 *   GET  /health         → service + model status
 *   POST /predict        → { board, n } ⇒ { winProb1, featuresUsed, tookMs }
 *   POST /predict-batch  → { boards: number[][][], n } ⇒ { winProbs1, tookMs }
 *                          (used by the game-review replay)
 *   POST /train          → self-play data generation + mini-batch training,
 *                          persists weights to ./nn-model-weights.json
 *
 * On startup the service tries to restore nn-model-weights.json (silent
 * fallback to the deterministic seeded init if the file is missing/corrupt).
 */

import { extractFeatures, FEATURE_DIM, DIRS } from './features';
import { NeuralNet, paramCount, mulberry32 } from './neural-net';

const PORT = 3020; // hardcoded by design — do NOT read process.env.PORT
const WEIGHTS_PATH = '/home/z/my-project/mini-services/nn-service/nn-model-weights.json';

// ───────────────────────────── Service state ────────────────────────────────

let net = new NeuralNet(0x5eed);
let weightsLoaded = false;
let trained = false;
let trainingSamples = 0;
let trainingInFlight = false;

/** Custom error carrying an HTTP status code. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ─────────────────────────── Weight persistence ─────────────────────────────

async function loadWeights(): Promise<void> {
  try {
    const file = Bun.file(WEIGHTS_PATH);
    if (!(await file.exists())) {
      console.log('[nn-eval] no weights file — using deterministic seeded init');
      return;
    }
    const obj = JSON.parse(await file.text());
    net = NeuralNet.load(obj.net);
    const meta = (obj.meta ?? {}) as { trained?: boolean; trainingSamples?: number };
    trained = Boolean(meta.trained);
    trainingSamples = Number.isFinite(meta.trainingSamples) ? Number(meta.trainingSamples) : 0;
    weightsLoaded = true;
    console.log(
      `[nn-eval] weights loaded (${paramCount(net.sizes)} params, ` +
        `${trainingSamples} cumulative training samples)`,
    );
  } catch (err) {
    console.warn('[nn-eval] failed to load weights — using fresh init:', err);
  }
}

async function saveWeights(): Promise<void> {
  const payload = {
    meta: {
      trained,
      trainingSamples,
      savedAt: new Date().toISOString(),
      featureDim: FEATURE_DIM,
    },
    net: net.serialize(),
  };
  await Bun.write(WEIGHTS_PATH, JSON.stringify(payload));
  console.log(`[nn-eval] weights persisted to ${WEIGHTS_PATH}`);
}

// ────────────────────────────── HTTP helpers ────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await req.text();
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'request body must be valid JSON');
  }
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const num = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, num));
}

function healthPayload() {
  return {
    ok: true,
    service: 'nn-eval',
    featureDim: FEATURE_DIM,
    params: paramCount(net.sizes),
    trained,
    weightsLoaded,
    trainingSamples,
  };
}

// ────────────────────────────── /predict ────────────────────────────────────

function parseBoard(body: Record<string, unknown>): { board: number[][]; n: number } {
  const raw = body.board;
  if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) {
    throw new HttpError(400, 'body.board must be a non-empty 2D number array');
  }
  const n =
    typeof body.n === 'number' && Number.isFinite(body.n) && body.n >= 1
      ? Math.floor(body.n)
      : raw.length;
  if (n > 30) throw new HttpError(400, 'body.n must be ≤ 30');
  if (raw.length !== n || raw.some((row) => !Array.isArray(row) || row.length !== n)) {
    throw new HttpError(400, `body.board must be exactly ${n}×${n} (omit body.n to infer)`);
  }
  // Normalize cells: keep 0/1/2, map anything else to empty (0).
  const board: number[][] = raw.map((row) =>
    (row as unknown[]).map((v) => (v === 1 || v === 2 ? v : 0)),
  );
  return { board, n };
}

async function handlePredict(req: Request): Promise<Response> {
  const body = await readJson(req);
  const { board, n } = parseBoard(body);
  const t0 = performance.now();
  const features = extractFeatures(board, n);
  const winProb1 = net.forward(features);
  const tookMs = Number((performance.now() - t0).toFixed(3));
  return json({ winProb1, featuresUsed: true, tookMs });
}

// ──────────────────────────── /predict-batch ────────────────────────────────

const MAX_BATCH = 800; // a full 24×24 board game is ≤ 577 positions

async function handlePredictBatch(req: Request): Promise<Response> {
  const body = await readJson(req);
  const raw = body.boards;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, 'body.boards must be a non-empty array of boards');
  }
  if (raw.length > MAX_BATCH) {
    throw new HttpError(400, `body.boards must contain at most ${MAX_BATCH} boards`);
  }
  const n =
    typeof body.n === 'number' && Number.isFinite(body.n) && body.n >= 1
      ? Math.floor(body.n)
      : 0;
  if (n < 1 || n > 30) throw new HttpError(400, 'body.n must be 1..30');

  const t0 = performance.now();
  const winProbs1: number[] = new Array<number>(raw.length);
  for (let i = 0; i < raw.length; i++) {
    // Reuse parseBoard's normalization per board by wrapping it.
    const { board } = parseBoard({ board: raw[i], n });
    winProbs1[i] = net.forward(extractFeatures(board, n));
  }
  const tookMs = Number((performance.now() - t0).toFixed(3));
  return json({ winProbs1, count: winProbs1.length, tookMs });
}

// ───────────────────── Self-play playout data generator ─────────────────────

interface Cell {
  r: number;
  c: number;
}

/** Does (r, c) touch any occupied cell in its 8-neighborhood? */
function hasOccupiedNeighbor(board: number[][], n: number, r: number, c: number): boolean {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] !== 0) return true;
    }
  }
  return false;
}

/**
 * Length of the longest same-stone run passing through (r, c).
 * Precondition: board[r][c] is already set to the player's value.
 */
function runLengthThrough(board: number[][], n: number, r: number, c: number): number {
  const player = board[r][c];
  let best = 1;
  for (let d = 0; d < DIRS.length; d++) {
    const dr = DIRS[d][0];
    const dc = DIRS[d][1];
    let len = 1;
    for (let sign = -1; sign <= 1; sign += 2) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === player) {
        len++;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (len > best) best = len;
  }
  return best;
}

function isWinningMove(board: number[][], n: number, r: number, c: number, winLen: number): boolean {
  return runLengthThrough(board, n, r, c) >= winLen;
}

/**
 * Random-with-heuristic move picker:
 *  1. take an immediate win if one exists;
 *  2. block an immediate opponent win 85% of the time (keeps games varied);
 *  3. otherwise weighted-random among empty cells adjacent (8-neigh) to stones,
 *     weighting cells that extend own runs (and, less, cells that would extend
 *     the opponent's) plus a random jitter — mimicking plausible human play.
 */
function pickMove(
  board: number[][],
  n: number,
  player: number,
  winLen: number,
  rng: () => number,
): Cell {
  const opp = player === 1 ? 2 : 1;
  const empties: Cell[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (board[r][c] === 0) empties.push({ r, c });
  }
  const adjacent = empties.filter((cell) => hasOccupiedNeighbor(board, n, cell.r, cell.c));
  const pool = adjacent.length > 0 ? adjacent : empties;

  // 1) immediate win
  const wins: Cell[] = [];
  for (const cell of pool) {
    board[cell.r][cell.c] = player;
    if (isWinningMove(board, n, cell.r, cell.c, winLen)) wins.push(cell);
    board[cell.r][cell.c] = 0;
  }
  if (wins.length > 0) return wins[Math.floor(rng() * wins.length)];

  // 2) block an immediate opponent win (85%)
  const blocks: Cell[] = [];
  for (const cell of pool) {
    board[cell.r][cell.c] = opp;
    if (isWinningMove(board, n, cell.r, cell.c, winLen)) blocks.push(cell);
    board[cell.r][cell.c] = 0;
  }
  if (blocks.length > 0 && rng() < 0.85) return blocks[Math.floor(rng() * blocks.length)];

  // 3) weighted random among the adjacent pool
  let totalW = 0;
  const weights = new Array<number>(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const { r, c } = pool[i];
    board[r][c] = player;
    const own = runLengthThrough(board, n, r, c);
    board[r][c] = opp;
    const theirs = runLengthThrough(board, n, r, c);
    board[r][c] = 0;
    const w = 1 + 0.8 * (own - 1) + 0.35 * (theirs - 1) + rng() * 1.2;
    weights[i] = w;
    totalW += w;
  }
  let pick = rng() * totalW;
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * Play `games` full self-play playouts (player 1 always opens, matching the
 * real game), recording the extracted feature vector AFTER every move. The
 * outcome label from player 1's perspective (win 1.0 / loss 0.0 / draw 0.5) is
 * attached to every position of that game.
 */
function generateSelfPlay(
  games: number,
  n: number,
  winLen: number,
  seed: number,
): { X: Float64Array[]; y: number[] } {
  const rng = mulberry32(seed);
  const X: Float64Array[] = [];
  const y: number[] = [];
  for (let g = 0; g < games; g++) {
    const board: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const positions: Float64Array[] = [];
    let player = 1;
    let winner = 0;
    for (let move = 0; move < n * n; move++) {
      const mv = pickMove(board, n, player, winLen, rng);
      board[mv.r][mv.c] = player;
      positions.push(extractFeatures(board, n));
      if (isWinningMove(board, n, mv.r, mv.c, winLen)) {
        winner = player;
        break;
      }
      player = player === 1 ? 2 : 1;
    }
    const label = winner === 1 ? 1.0 : winner === 2 ? 0.0 : 0.5;
    for (const f of positions) {
      X.push(f);
      y.push(label);
    }
  }
  return { X, y };
}

// ─────────────────────────────── /train ─────────────────────────────────────

async function handleTrain(req: Request): Promise<Response> {
  if (trainingInFlight) {
    return json({ ok: false, error: 'a training run is already in progress' }, 409);
  }
  const body = await readJson(req);
  const games = clampInt(body.games, 60, 1, 400);
  const boardSize = clampInt(body.boardSize, 11, 5, 24);
  const winLength = clampInt(body.winLength, 5, 3, Math.min(10, boardSize));
  const epochs = clampInt(body.epochs, 3, 1, 60);

  trainingInFlight = true;
  try {
    const t0 = performance.now();
    const seed = (Date.now() ^ 0x9e3779b9) >>> 0;
    const { X, y } = generateSelfPlay(games, boardSize, winLength, seed);
    if (X.length === 0) throw new HttpError(500, 'self-play produced no samples');

    const before = net.evaluate(X, y);
    // lr 0.005, mini-batch 32, shuffled every epoch — per service spec.
    net.trainEpochs(X, y, { epochs, lr: 0.005, batchSize: 32, shuffle: true });
    const after = net.evaluate(X, y);

    trained = true;
    trainingSamples += X.length;
    await saveWeights();

    const tookMs = Number((performance.now() - t0).toFixed(1));
    return json({
      games,
      samples: X.length,
      lossBefore: Number(before.loss.toFixed(6)),
      lossAfter: Number(after.loss.toFixed(6)),
      accuracy: Number(after.accuracy.toFixed(4)),
      tookMs,
    });
  } finally {
    trainingInFlight = false;
  }
}

// ─────────────────────────────── Server ─────────────────────────────────────

async function main(): Promise<void> {
  await loadWeights(); // restore previous training state before serving
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // CORS preflight for any route.
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      try {
        if (pathname === '/health' && req.method === 'GET') return json(healthPayload());
        if (pathname === '/predict' && req.method === 'POST') return await handlePredict(req);
        if (pathname === '/predict-batch' && req.method === 'POST') return await handlePredictBatch(req);
        if (pathname === '/train' && req.method === 'POST') return await handleTrain(req);
        return json({ ok: false, error: `no route for ${req.method} ${pathname}` }, 404);
      } catch (err) {
        if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
        console.error('[nn-eval] unhandled error:', err);
        return json({ ok: false, error: 'internal server error' }, 500);
      }
    },
  });
  console.log(
    `[nn-eval] listening on http://localhost:${PORT} — feature dim ${FEATURE_DIM}, ` +
      `${paramCount(net.sizes)} params`,
  );
}

main().catch((err) => {
  console.error('[nn-eval] fatal startup error:', err);
  process.exit(1);
});
