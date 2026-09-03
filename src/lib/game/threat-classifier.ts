// ============================================================================
// Threat Classifier v3
// For every empty cell + direction: "if I play here, what does this become?"
//
// v3 upgrades (per the implementation plan):
//   • Gap-pattern awareness: X_XX / XX_XX patterns are detected as four-level
//     threats, X_XX_XX-style continuations as three-level threats.
//   • Fork detection: two strong directions of ANY type (double open-threes
//     included — previously required different categories).
//   • Double-open-three tracking: guaranteed-win sequences get a strategic
//     bonus in scoring.
//   • Closed patterns are dead (a four with zero open ends classifies NONE).
//   • Half-open threes classify SIMPLE_THREE (never OPEN_THREE).
//   • totalConsec always includes the played cell itself (the historical
//     off-by-one bug — classifications must never be undervalued by one).
//
// Sign convention (rebuild-spec bug #15): evaluatePosition is POSITIVE when
// the human player is ahead. Kept as one explicit, tested formula.
// ============================================================================

import type { CriticalSquare, MoveReason } from "./types";

// UI contract re-exports (AnalysisPanel / QuickPreview import from here).
export type { PlayerBestMove, ScoringAnalysis, CriticalSquare } from "./types";

// ---------------------------------------------------------------------------
// Board primitives
// ---------------------------------------------------------------------------

export function emptyBoard(n: number): Int8Array {
  return new Int8Array(n * n);
}
export function idx(n: number, r: number, c: number): number {
  return r * n + c;
}
export function inBounds(n: number, r: number, c: number): boolean {
  return r >= 0 && r < n && c >= 0 && c < n;
}
export function legalMoves(board: Int8Array): number[] {
  const moves: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) moves.push(i);
  return moves;
}
export function cloneBoard(board: Int8Array): Int8Array {
  return board.slice();
}

export const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// ---------------------------------------------------------------------------
// Win detection (Classic mode)
// ---------------------------------------------------------------------------

export function checkWinAt(
  board: Int8Array,
  n: number,
  winLen: number,
  r: number,
  c: number,
  player: number
): boolean {
  for (const [dr, dc] of DIRS) {
    let count = 1;
    let rr = r + dr;
    let cc = c + dc;
    while (inBounds(n, rr, cc) && board[idx(n, rr, cc)] === player) {
      count++;
      rr += dr;
      cc += dc;
    }
    rr = r - dr;
    cc = c - dc;
    while (inBounds(n, rr, cc) && board[idx(n, rr, cc)] === player) {
      count++;
      rr -= dr;
      cc -= dc;
    }
    if (count >= winLen) return true;
  }
  return false;
}

/** Returns the full winning line through (r,c) as [row,col][] or null. */
export function findWinLine(
  board: Int8Array,
  n: number,
  winLen: number,
  r: number,
  c: number,
  player: number
): [number, number][] | null {
  for (const [dr, dc] of DIRS) {
    const cells: [number, number][] = [[r, c]];
    let rr = r + dr;
    let cc = c + dc;
    while (inBounds(n, rr, cc) && board[idx(n, rr, cc)] === player) {
      cells.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    rr = r - dr;
    cc = c - dc;
    while (inBounds(n, rr, cc) && board[idx(n, rr, cc)] === player) {
      cells.unshift([rr, cc]);
      rr -= dr;
      cc -= dc;
    }
    if (cells.length >= winLen) return cells;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CAT = {
  NONE: 0,
  ONE: 1,
  TWO: 2,
  SIMPLE_THREE: 3,
  BROKEN_THREE: 4,
  OPEN_THREE: 5,
  SIMPLE_FOUR: 6,
  OPEN_FOUR: 7,
  WIN: 8,
} as const;

export const CAT_NAME: Record<number, string> = {
  0: "None",
  1: "One",
  2: "Two",
  3: "Simple three",
  4: "Broken three",
  5: "Open three",
  6: "Simple four",
  7: "Open four",
  8: "Five — wins",
};

export const CAT_VALUE: Record<number, number> = {
  0: 0,
  1: 5,
  2: 50,
  3: 300,
  4: 1200,
  5: 3000,
  6: 8000,
  7: 20000,
  8: 1000000,
};

/** Strategic fork bonuses (implementation-plan v3 scoring). */
export const FORK_BONUS = {
  doubleOpenThree: 8000,
  openFour: 5000,
  fork: 3000,
} as const;

// ---------------------------------------------------------------------------
// Direction classification (v3, gap-aware)
// ---------------------------------------------------------------------------

interface DirClass {
  category: number;
  hasGap: boolean;
}

export function classifyDirection(
  board: Int8Array,
  n: number,
  row: number,
  col: number,
  dr: number,
  dc: number,
  player: number,
  winLen: number
): DirClass {
  // Consecutive run including the cell itself (v3: +1 is inherent here).
  let left = 0;
  let r = row - dr;
  let c = col - dc;
  while (inBounds(n, r, c) && board[idx(n, r, c)] === player) {
    left++;
    r -= dr;
    c -= dc;
  }
  const leftOpen = inBounds(n, r, c) && board[idx(n, r, c)] === 0;

  let right = 0;
  r = row + dr;
  c = col + dc;
  while (inBounds(n, r, c) && board[idx(n, r, c)] === player) {
    right++;
    r += dr;
    c += dc;
  }
  const rightOpen = inBounds(n, r, c) && board[idx(n, r, c)] === 0;

  // Solid run (includes the played cell — never off by one).
  const runLen = left + 1 + right;
  if (runLen >= winLen) return { category: CAT.WIN, hasGap: false };

  // Gap-aware extension: stones beyond exactly one empty cell on each side.
  let extL = 0;
  if (leftOpen) {
    let gr = row - dr * (left + 2);
    let gc = col - dc * (left + 2);
    while (inBounds(n, gr, gc) && board[idx(n, gr, gc)] === player) {
      extL++;
      gr -= dr;
      gc -= dc;
    }
  }
  let extR = 0;
  if (rightOpen) {
    let gr = row + dr * (right + 2);
    let gc = col + dc * (right + 2);
    while (inBounds(n, gr, gc) && board[idx(n, gr, gc)] === player) {
      extR++;
      gr += dr;
      gc += dc;
    }
  }

  // Broken potential: filling ONE gap joins everything into one run.
  const brokenPotential =
    runLen + (extL > 0 ? 1 + extL : 0) + (extR > 0 ? 1 + extR : 0);
  const hasGap = extL > 0 || extR > 0;

  // Broken four: X_XX / XX_XX style — one fill point completes the win.
  if (brokenPotential >= winLen) return { category: CAT.SIMPLE_FOUR, hasGap: true };

  const gap = winLen - runLen;

  if (gap === 1) {
    if (leftOpen && rightOpen) return { category: CAT.OPEN_FOUR, hasGap: false };
    if (leftOpen || rightOpen) return { category: CAT.SIMPLE_FOUR, hasGap: false };
    return { category: CAT.NONE, hasGap: false }; // closed four is dead
  }

  if (gap === 2) {
    if (!leftOpen && !rightOpen) return { category: CAT.NONE, hasGap: false };
    if (leftOpen && rightOpen) {
      const leftExtendOpen = (() => {
        const rr = row - dr * (left + 2);
        const cc = col - dc * (left + 2);
        return inBounds(n, rr, cc) && board[idx(n, rr, cc)] === 0;
      })();
      const rightExtendOpen = (() => {
        const rr = row + dr * (right + 2);
        const cc = col + dc * (right + 2);
        return inBounds(n, rr, cc) && board[idx(n, rr, cc)] === 0;
      })();
      // If a gapped continuation makes this at least a broken three, prefer it.
      if (leftExtendOpen || rightExtendOpen) {
        if (brokenPotential >= winLen - 1)
          return { category: CAT.BROKEN_THREE, hasGap: true };
        return { category: CAT.OPEN_THREE, hasGap: false };
      }
      return { category: CAT.BROKEN_THREE, hasGap: false };
    }
    // Half-open three — v3: SIMPLE_THREE, never OPEN_THREE.
    if (brokenPotential >= winLen - 1) return { category: CAT.BROKEN_THREE, hasGap: true };
    return { category: CAT.SIMPLE_THREE, hasGap: false };
  }

  if (gap === 3) return { category: runLen >= 2 ? CAT.TWO : CAT.ONE, hasGap: false };
  if (runLen >= 1) return { category: CAT.ONE, hasGap: false };
  return { category: CAT.NONE, hasGap: false };
}

export function classifyCell(
  board: Int8Array,
  n: number,
  row: number,
  col: number,
  player: number,
  winLen: number
): {
  category: number;
  secondCategory: number;
  isFork: boolean;
  score: number;
  direction: [number, number] | null;
  hasGap: boolean;
  openThreeCount: number;
} {
  let best: number = CAT.NONE;
  let second: number = CAT.NONE;
  let strongDirs = 0;
  let openThreeCount = 0;
  let bestDir: [number, number] | null = null;
  let hasGap = false;

  for (const [dr, dc] of DIRS) {
    const d = classifyDirection(board, n, row, col, dr, dc, player, winLen);
    if (d.category >= CAT.OPEN_THREE) strongDirs++;
    if (d.category === CAT.OPEN_THREE) openThreeCount++;
    if (d.category > best) {
      second = best;
      best = d.category;
      bestDir = [dr, dc];
      hasGap = d.hasGap;
    } else if (d.category > second) {
      second = d.category;
    } else if (d.category === best && d.hasGap) {
      hasGap = true;
    }
  }

  // v3: fork = two strong directions of ANY type (double open-threes included).
  const isFork = strongDirs >= 2;

  let score = CAT_VALUE[best] + 0.3 * CAT_VALUE[second];
  if (isFork) score += FORK_BONUS.fork;
  if (openThreeCount >= 2) score += FORK_BONUS.doubleOpenThree;
  if (best === CAT.OPEN_FOUR) score += FORK_BONUS.openFour;

  return { category: best, secondCategory: second, isFork, score, direction: bestDir, hasGap, openThreeCount };
}

export function classifyBoard(
  board: Int8Array,
  n: number,
  player: number,
  winLen: number
): Map<number, ReturnType<typeof classifyCell>> {
  const out = new Map<number, ReturnType<typeof classifyCell>>();
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) continue;
    const row = Math.floor(i / n);
    const col = i % n;
    out.set(i, classifyCell(board, n, row, col, player, winLen));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signed static eval — POSITIVE always means the human player is ahead.
// (rebuild-spec bug #15: this sign was inverted once; never again.)
// ---------------------------------------------------------------------------

export function evaluatePosition(
  board: Int8Array,
  n: number,
  winLen: number
): { raw: number; display: number } {
  function sideTotal(player: number): number {
    let total = 0;
    for (let i = 0; i < board.length; i++) {
      if (board[i] !== 0) continue;
      const row = Math.floor(i / n);
      const col = i % n;
      const c = classifyCell(board, n, row, col, player, winLen);
      total += CAT_VALUE[c.category] * 0.001 + CAT_VALUE[c.secondCategory] * 0.0003;
    }
    return total;
  }
  const playerTotal = sideTotal(1);
  const aiTotal = sideTotal(2);
  const diff = playerTotal - aiTotal;
  return {
    raw: diff,
    display: Math.max(-100, Math.min(100, Math.round(Math.tanh(diff / 40) * 100))),
  };
}

// ---------------------------------------------------------------------------
// Tactical safety net v3
// Priority: win → block-win → open-four → block-four → block-open-four
//           → fork → block-fork → block-open-three
// ---------------------------------------------------------------------------

export function tacticalMove(
  board: Int8Array,
  n: number,
  winLen: number,
  me: number,
  opp: number
): { cell: number; reason: MoveReason } | null {
  const myCells = classifyBoard(board, n, me, winLen);
  const oppCells = classifyBoard(board, n, opp, winLen);

  for (const [cell, c] of myCells) if (c.category === CAT.WIN) return { cell, reason: "win" };
  for (const [cell, c] of oppCells) if (c.category === CAT.WIN) return { cell, reason: "block-win" };
  for (const [cell, c] of myCells)
    if (c.category === CAT.OPEN_FOUR) return { cell, reason: "open-four" };

  // Block fours (solid or broken gap fours are equally urgent).
  for (const [cell, c] of oppCells)
    if (c.category === CAT.SIMPLE_FOUR) return { cell, reason: "block-four" };
  for (const [cell, c] of oppCells)
    if (c.category === CAT.OPEN_FOUR) return { cell, reason: "block-open-four" };

  // My fork — two live threats at once.
  let bestFork: { cell: number; score: number } | null = null;
  for (const [cell, c] of myCells) {
    if (c.isFork && (!bestFork || c.score > bestFork.score)) bestFork = { cell, score: c.score };
  }
  if (bestFork) return { cell: bestFork.cell, reason: "fork" };

  // v3: block opponent forks (double threats of any type).
  let bestBlockFork: { cell: number; score: number } | null = null;
  for (const [cell, c] of oppCells) {
    if (c.isFork && (!bestBlockFork || c.score > bestBlockFork.score))
      bestBlockFork = { cell, score: c.score };
  }
  if (bestBlockFork) return { cell: bestBlockFork.cell, reason: "block-fork" };

  for (const [cell, c] of oppCells)
    if (c.category === CAT.OPEN_THREE) return { cell, reason: "block-open-three" };

  return null;
}

// ---------------------------------------------------------------------------
// Natural-language reason text (shown in analysis)
// ---------------------------------------------------------------------------

export const REASON_TEXT: Record<MoveReason, string> = {
  win: "Completes a winning line.",
  "block-win": "Blocking your winning line — one more move and you'd have won.",
  "open-four": "Creates an open four — unstoppable next turn from either end.",
  "block-four": "Blocking your four before it could complete.",
  "block-open-four": "Trying to slow an open four — it likely can't be fully stopped now.",
  fork: "Creates a fork — two live threats at once, so only one can be blocked.",
  "block-fork": "Blocking your fork before two threats become unstoppable.",
  "block-open-three": "Blocking your open three before it becomes an open four.",
  search: "No forcing move available — playing the strongest position the search found.",
};

// ---------------------------------------------------------------------------
// Go-style coordinates: columns A..T skipping letter I, rows numbered from
// the bottom (top row = board size). Used by every UI component.
// ---------------------------------------------------------------------------

export function colLabel(c: number): string {
  return String.fromCharCode(65 + (c >= 8 ? c + 1 : c));
}
export function coordLabel(row: number, col: number, n: number): string {
  return `${colLabel(col)}${n - row}`;
}

/** Human-readable threat description for a classification. */
export function describeCategory(category: number, isFork: boolean): string {
  if (isFork) return "Fork — creates two live threats at once";
  switch (category) {
    case CAT.WIN:
      return "Completes five — immediate win";
    case CAT.OPEN_FOUR:
      return "Open four — unstoppable next turn";
    case CAT.SIMPLE_FOUR:
      return "Four — must be answered now";
    case CAT.OPEN_THREE:
      return "Open three — becomes an open four";
    case CAT.BROKEN_THREE:
      return "Broken three — gapped threat";
    case CAT.SIMPLE_THREE:
      return "Three — half-open line";
    case CAT.TWO:
      return "Two — building potential";
    case CAT.ONE:
      return "One — early development";
    default:
      return "Quiet move";
  }
}
