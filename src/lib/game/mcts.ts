// ============================================================================
// MCTS + RAVE engine (v3)
//
// Design (consistent with the reference implementation):
//   • The persistent GlobalRAVE table IS the RAVE source of truth — read at
//     every node (root and internal), including inside playouts. No separate
//     per-node RAVE bookkeeping.
//   • Playout policy v3: tactical overrides (win → open four → block win →
//     block four → fork → block fork → block open three), then threat/score
//     weighted softmax multiplied by the RAVE boost.
//   • UCT-RAVE selection with beta = sqrt(C / (3v + C)), C = 220.
//   • Root-only threat-prior progressive bias (priorWeight 0.9).
//   • Tactical override applied AFTER search (safety net).
//   • Backprop convention: root tracks value FOR aiPlayer; every descendant
//     tracks value for whoever MOVED to reach it.
//   • Tree reuse: if the previous tree contains the exact new position after
//     the opponent's move, descend into that subtree instead of restarting
//     (3-level fallback: reuse → fresh tree + global RAVE).
//   • mulberry32 seeded PRNG — deterministic given a seed.
// ============================================================================

import {
  CAT,
  CAT_VALUE,
  classifyBoard,
  classifyCell,
  checkWinAt,
  cloneBoard,
  emptyBoard,
  legalMoves,
  tacticalMove,
} from "./threat-classifier";

// Convenience re-exports used by the API routes.
export { emptyBoard, legalMoves, cloneBoard, checkWinAt, findWinLine, tacticalMove } from "./threat-classifier";
export { checkWinAt as winAt } from "./threat-classifier";
import { computeFullScore, scoreMoveDelta } from "./scoring";
import type { MctsResult, MoveReason } from "./types";

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// GlobalRAVE — persistent per-(boardSize, mode) cross-move / cross-game memory
// ---------------------------------------------------------------------------

export class GlobalRAVE {
  n: number;
  visits: { 1: Float64Array; 2: Float64Array };
  wins: { 1: Float64Array; 2: Float64Array };

  constructor(n: number) {
    this.n = n;
    this.visits = { 1: new Float64Array(n * n), 2: new Float64Array(n * n) };
    this.wins = { 1: new Float64Array(n * n), 2: new Float64Array(n * n) };
  }
  update(player: number, cell: number, reward: number) {
    const p = (player === 1 ? 1 : 2) as 1 | 2;
    this.visits[p][cell] += 1;
    this.wins[p][cell] += reward;
  }
  getRate(player: number, cell: number): number {
    const p = (player === 1 ? 1 : 2) as 1 | 2;
    const v = this.visits[p][cell];
    return v === 0 ? 0.5 : this.wins[p][cell] / v;
  }
  getVisits(player: number, cell: number): number {
    const p = (player === 1 ? 1 : 2) as 1 | 2;
    return this.visits[p][cell];
  }
  decay(factor: number) {
    for (const p of [1, 2] as const) {
      for (let i = 0; i < this.visits[p].length; i++) {
        this.visits[p][i] *= factor;
        this.wins[p][i] *= factor;
      }
    }
  }
  totalVisits(): number {
    let t = 0;
    for (const p of [1, 2] as const) for (let i = 0; i < this.visits[p].length; i++) t += this.visits[p][i];
    return Math.round(t);
  }
  coverage(): number {
    let covered = 0;
    const cells = this.n * this.n;
    for (const p of [1, 2] as const)
      for (let i = 0; i < cells; i++) if (this.visits[p][i] > 0) covered++;
    return covered / (2 * cells);
  }
  bestRate(): number {
    // Mean reward over cells with meaningful visits.
    let sum = 0;
    let count = 0;
    for (const p of [1, 2] as const)
      for (let i = 0; i < this.visits[p].length; i++) {
        if (this.visits[p][i] >= 4) {
          sum += this.wins[p][i] / this.visits[p][i];
          count++;
        }
      }
    return count === 0 ? 0.5 : sum / count;
  }
  toJSON() {
    return {
      n: this.n,
      v1: Array.from(this.visits[1]),
      v2: Array.from(this.visits[2]),
      w1: Array.from(this.wins[1]),
      w2: Array.from(this.wins[2]),
    };
  }
  static fromJSON(obj: { n: number; v1: number[]; v2: number[]; w1: number[]; w2: number[] }): GlobalRAVE {
    const g = new GlobalRAVE(obj.n);
    g.visits[1] = Float64Array.from(obj.v1);
    g.visits[2] = Float64Array.from(obj.v2);
    g.wins[1] = Float64Array.from(obj.w1);
    g.wins[2] = Float64Array.from(obj.w2);
    return g;
  }
}

// ---------------------------------------------------------------------------
// Playout policy v3
// ---------------------------------------------------------------------------

export function raveBeta(visits: number, C = 220): number {
  return Math.sqrt(C / (3 * visits + C));
}

class MCTSNode {
  player: number;
  children = new Map<number, MCTSNode>();
  untried: number[] | null = null;
  visits = 0;
  wins = 0;
  constructor(player: number) {
    this.player = player;
  }
}

function pickPlayoutMove(
  board: Int8Array,
  n: number,
  winLen: number,
  mode: string,
  player: number,
  opp: number,
  globalRave: GlobalRAVE,
  rng: () => number
): number | null {
  // 1) Tactical overrides (v3 priority chain).
  const tac = tacticalMove(board, n, winLen, player, opp);
  if (tac) return tac.cell;

  const moves = legalMoves(board);
  if (!moves.length) return null;

  const weights: number[] = [];
  let sum = 0;
  for (const cell of moves) {
    const row = Math.floor(cell / n);
    const col = cell % n;
    let w: number;
    if (mode === "classic") {
      const c = classifyCell(board, n, row, col, player, winLen);
      w = 1 + c.score * 0.03; // v3: stronger tactical bias (temp ~3.5 equivalent)
      if (c.isFork) w += 12; // fork bonus in playouts
      const oppC = classifyCell(board, n, row, col, opp, winLen);
      if (oppC.category >= CAT.SIMPLE_FOUR) w += 14; // defensive awareness
    } else {
      w = 1 + scoreMoveDelta(board, n, row, col, player) * 3 + scoreMoveDelta(board, n, row, col, opp) * 1.5;
    }
    w = Math.min(w, 40); // v3: randomness cap — keep playout diversity for RAVE
    w *= 0.6 + 0.8 * globalRave.getRate(player, cell);
    weights.push(w);
    sum += w;
  }

  let x = rng() * sum;
  for (let i = 0; i < moves.length; i++) {
    x -= weights[i];
    if (x <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}

function runPlayout(
  board: Int8Array,
  n: number,
  winLen: number,
  mode: string,
  startPlayer: number,
  globalRave: GlobalRAVE,
  rng: () => number,
  maxMoves: number
): { played: { player: number; cell: number }[]; winner: number; scoreDiff: number } {
  const work = cloneBoard(board);
  let player = startPlayer;
  const played: { player: number; cell: number }[] = [];
  let winner = 0;
  let moves = 0;

  while (moves < maxMoves) {
    const opp = player === 1 ? 2 : 1;
    const cell = pickPlayoutMove(work, n, winLen, mode, player, opp, globalRave, rng);
    if (cell === null) break;
    const row = Math.floor(cell / n);
    const col = cell % n;
    work[cell] = player;
    played.push({ player, cell });
    if (mode === "classic" && checkWinAt(work, n, winLen, row, col, player)) {
      winner = player;
      break;
    }
    player = opp;
    moves++;
  }

  let scoreDiff = 0;
  if (mode === "scoring" && legalMoves(work).length === 0) {
    const totals = computeFullScore(work, n);
    scoreDiff = totals[1] - totals[2];
  }
  return { played, winner, scoreDiff };
}

// ---------------------------------------------------------------------------
// Tree reuse cache (module-level, per config)
// ---------------------------------------------------------------------------

interface TreeCacheEntry {
  n: number;
  winLen: number;
  mode: string;
  root: MCTSNode;
  board: Int8Array; // board the root corresponds to
}
let treeCache: TreeCacheEntry | null = null;

function tryReuseTree(
  n: number,
  winLen: number,
  mode: string,
  board: Int8Array,
  movePath: number[]
): { root: MCTSNode | null; priorTreeVisits: number } {
  if (!treeCache || treeCache.n !== n || treeCache.winLen !== winLen || treeCache.mode !== mode) {
    return { root: null, priorTreeVisits: 0 };
  }
  // Verify the cache board differs from the current board exactly on movePath.
  let node = treeCache.root;
  let cur = cloneBoard(treeCache.board);
  for (const cell of movePath) {
    if (cur[cell] !== 0) return { root: null, priorTreeVisits: 0 };
    const child = node.children.get(cell);
    if (!child) return { root: null, priorTreeVisits: 0 };
    // Determine who moved: alternate from cache root's player
    const mover = node.player;
    cur[cell] = mover;
    node = child;
  }
  // The descended node's board must match the current board.
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== board[i]) return { root: null, priorTreeVisits: 0 };
  }
  const visits = node.visits;
  node.untried = null; // force recompute at the new frontier
  return { root: node, priorTreeVisits: visits };
}

function storeTree(n: number, winLen: number, mode: string, root: MCTSNode, board: Int8Array) {
  treeCache = { n, winLen, mode, root, board: cloneBoard(board) };
}

/** Clear the cached tree (on new game). */
export function resetTreeCache() {
  treeCache = null;
}

// ---------------------------------------------------------------------------
// runMCTS
// ---------------------------------------------------------------------------

export interface RunMctsOpts {
  board: Int8Array;
  n: number;
  winLen: number;
  mode: "classic" | "scoring";
  aiPlayer: number;
  simulations?: number;
  timeLimitMs?: number;
  globalRave: GlobalRAVE;
  seed?: number;
  priorWeight?: number;
  /** Moves (cells) played since the last search, newest game first order:
   *  the exact sequence applied to the previously cached tree's board. */
  movePath?: number[];
}

export function runMCTS(opts: RunMctsOpts): MctsResult {
  const {
    board,
    n,
    winLen,
    mode,
    aiPlayer,
    simulations = 1500,
    timeLimitMs = 1500,
    globalRave,
    seed = 1,
    priorWeight = 0.9,
    movePath = [],
  } = opts;

  const rng = mulberry32(seed);
  const humanPlayer = aiPlayer === 1 ? 2 : 1;

  // Tree reuse (level 1/2) — else fresh root (level 3, global RAVE carries knowledge).
  const reuse = tryReuseTree(n, winLen, mode, board, movePath);
  const root = reuse.root ?? new MCTSNode(aiPlayer);
  root.player = aiPlayer;
  root.untried = legalMoves(board);
  root.untried = root.untried.filter((c) => board[c] === 0);
  const treeReused = reuse.root !== null;
  const priorTreeVisits = reuse.priorTreeVisits;

  let nodesExpanded = 0;

  const threatPrior = mode === "classic" ? classifyBoard(board, n, aiPlayer, winLen) : null;
  const threatPriorOpp = mode === "classic" ? classifyBoard(board, n, humanPlayer, winLen) : null;

  const start = Date.now();
  let sims = 0;

  for (; sims < simulations; sims++) {
    if ((sims & 31) === 0 && Date.now() - start > timeLimitMs) break;

    // ---- Selection ----
    let node = root;
    const state = cloneBoard(board);
    const path: MCTSNode[] = [node];
    let curPlayer = aiPlayer;
    let terminal = false;
    let terminalWinner = 0;

    while (node.untried && node.untried.length === 0 && node.children.size > 0) {
      let bestCell: number | null = null;
      let bestScore = -Infinity;
      const logN = Math.log(node.visits + 1);
      for (const [cell, child] of node.children) {
        if (state[cell] !== 0) continue; // occupied-cell guard
        const q = child.visits > 0 ? child.wins / child.visits : 0.5;
        const uct = q + Math.SQRT2 * Math.sqrt(logN / (child.visits + 1e-6));
        const rv = globalRave.getVisits(node.player, cell);
        const raveRate = globalRave.getRate(node.player, cell);
        const beta = rv > 0 ? raveBeta(child.visits) : 0;
        let score = beta * raveRate + (1 - beta) * uct;
        if (node === root && threatPrior) {
          const tp = curPlayer === aiPlayer ? threatPrior : threatPriorOpp;
          const t = tp?.get(cell);
          if (t) {
            const norm = Math.min(1, t.score / CAT_VALUE[CAT.OPEN_FOUR]);
            score += (priorWeight * norm * Math.sqrt(Math.log(node.visits + 2))) / (child.visits + 8);
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestCell = cell;
        }
      }
      if (bestCell === null) break;
      state[bestCell] = curPlayer;
      const row = Math.floor(bestCell / n);
      const col = bestCell % n;
      if (mode === "classic" && checkWinAt(state, n, winLen, row, col, curPlayer)) {
        terminal = true;
        terminalWinner = curPlayer;
      }
      node = node.children.get(bestCell)!;
      path.push(node);
      curPlayer = curPlayer === 1 ? 2 : 1;
      if (terminal || legalMoves(state).length === 0) break;
    }

    // ---- Expansion ----
    if (!terminal && legalMoves(state).length > 0) {
      if (node.untried === null) node.untried = legalMoves(state);
      node.untried = node.untried.filter((c) => state[c] === 0);
      if (node.untried.length > 0) {
        const i = Math.floor(rng() * node.untried.length);
        const cell = node.untried[i];
        node.untried.splice(i, 1);
        state[cell] = curPlayer;
        const row = Math.floor(cell / n);
        const col = cell % n;
        const child = new MCTSNode(curPlayer === 1 ? 2 : 1);
        node.children.set(cell, child);
        nodesExpanded++;
        if (mode === "classic" && checkWinAt(state, n, winLen, row, col, curPlayer)) {
          terminal = true;
          terminalWinner = curPlayer;
        }
        node = child;
        path.push(node);
        curPlayer = curPlayer === 1 ? 2 : 1;
      }
    }

    // ---- Simulation ----
    let reward1: number;
    let playoutMoves: { player: number; cell: number }[] = [];
    if (terminal) {
      reward1 = terminalWinner === 1 ? 1 : 0;
    } else if (legalMoves(state).length === 0 && mode === "classic") {
      reward1 = 0.5;
    } else {
      const pl = runPlayout(state, n, winLen, mode, curPlayer, globalRave, rng, n * n + 2);
      playoutMoves = pl.played;
      if (mode === "classic") {
        reward1 = pl.winner === 0 ? 0.5 : pl.winner === 1 ? 1 : 0;
      } else {
        reward1 = 1 / (1 + Math.exp(-pl.scoreDiff / Math.max(4, n)));
      }
    }

    // Playout moves feed the global RAVE table.
    for (const mv of playoutMoves) {
      const r = mv.player === 1 ? reward1 : 1 - reward1;
      globalRave.update(mv.player, mv.cell, r);
    }

    // ---- Backprop ----
    // Root always tracks value FOR aiPlayer.
    path[0].visits += 1;
    path[0].wins += aiPlayer === 1 ? reward1 : 1 - reward1;
    // Descendants track value for whoever MOVED to reach them.
    for (let i = 1; i < path.length; i++) {
      const moverToReachThis = path[i - 1].player;
      path[i].visits += 1;
      path[i].wins += moverToReachThis === 1 ? reward1 : 1 - reward1;
    }
  }

  // ---- Pick move ----
  let bestCell: number | null = null;
  let bestVisits = -1;
  const rootChildren: MctsResult["topChildren"] = [];
  for (const [cell, child] of root.children) {
    if (board[cell] !== 0) continue;
    rootChildren.push({
      cell,
      row: Math.floor(cell / n),
      col: cell % n,
      visits: child.visits,
      winRate: child.visits > 0 ? child.wins / child.visits : 0,
      raveRate: globalRave.getRate(aiPlayer, cell),
    });
    if (child.visits > bestVisits) {
      bestVisits = child.visits;
      bestCell = cell;
    }
  }
  rootChildren.sort((a, b) => b.visits - a.visits);

  let reason: MoveReason = "search";
  const override = tacticalMove(board, n, winLen, aiPlayer, humanPlayer);
  if (override && board[override.cell] === 0) {
    bestCell = override.cell;
    reason = override.reason;
  }
  if (bestCell === null || board[bestCell] !== 0) {
    const lm = legalMoves(board);
    if (lm.length) bestCell = lm[Math.floor(rng() * lm.length)];
  }

  // Cache the tree for potential reuse next turn.
  if (bestCell !== null) {
    const nextRoot = root.children.get(bestCell);
    if (nextRoot) {
      const afterAi = cloneBoard(board);
      afterAi[bestCell] = aiPlayer;
      storeTree(n, winLen, mode, nextRoot, afterAi);
    } else {
      storeTree(n, winLen, mode, root, board);
    }
  }

  const rootWinRate = root.visits > 0 ? root.wins / root.visits : 0.5;

  function countNodes(node: MCTSNode): number {
    let total = 1;
    for (const [, child] of node.children) total += countNodes(child);
    return total;
  }

  return {
    move: bestCell ?? 0,
    reason,
    simulations: sims,
    elapsedMs: Date.now() - start,
    rootWinRate,
    raveBeta: raveBeta(root.visits),
    topChildren: rootChildren.slice(0, 6),
    totalVisits: root.visits,
    nodesExpanded,
    treeReused,
    priorTreeVisits,
    totalTreeNodes: countNodes(root),
  };
}

// ---------------------------------------------------------------------------
// Quick Train — fast self-play using the SAME lightweight policy playouts
// used in MCTS (tactical overrides + threat/score-weighted softmax), with NO
// tree search. Intentionally cheap so hundreds of games run in a fraction of
// a second, purely to seed GlobalRAVE before real play.
//
// Historical rules (rebuild-spec bug #4):
//   • Training must apply ZERO decay.
//   • Playouts must be genuinely randomized, not greedy.
//   • runPlayout does NOT update GlobalRAVE itself — the caller must.
// ---------------------------------------------------------------------------

export function trainGames(
  n: number,
  winLen: number,
  mode: "classic" | "scoring",
  count: number,
  globalRave: GlobalRAVE,
  seedBase = 1
): { p1: number; p2: number; draw: number; visitsBefore: number; visitsAfter: number } {
  const rng = mulberry32(seedBase);
  const outcomes = { p1: 0, p2: 0, draw: 0 };
  const visitsBefore = globalRave.totalVisits();

  for (let g = 0; g < count; g++) {
    const board = emptyBoard(n);
    const pl = runPlayout(board, n, winLen, mode, 1, globalRave, rng, n * n + 2);
    let reward1: number;
    if (mode === "classic") {
      reward1 = pl.winner === 1 ? 1 : pl.winner === 2 ? 0 : 0.5;
      if (pl.winner === 1) outcomes.p1++;
      else if (pl.winner === 2) outcomes.p2++;
      else outcomes.draw++;
    } else {
      reward1 = 1 / (1 + Math.exp(-pl.scoreDiff / Math.max(4, n)));
      if (pl.scoreDiff > 0) outcomes.p1++;
      else if (pl.scoreDiff < 0) outcomes.p2++;
      else outcomes.draw++;
    }
    // Explicit RAVE update (trainGames bypasses runMCTS's simulation step).
    for (const mv of pl.played) {
      const r = mv.player === 1 ? reward1 : 1 - reward1;
      globalRave.update(mv.player, mv.cell, r);
    }
  }

  return {
    p1: outcomes.p1,
    p2: outcomes.p2,
    draw: outcomes.draw,
    visitsBefore,
    visitsAfter: globalRave.totalVisits(),
  };
}
