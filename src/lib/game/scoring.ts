// ============================================================================
// Score Attack scoring — window-counting formula, ported from the verified
// reference implementation (flat Int8Array board).
// Weights (these are the canonical rules — also shown in Settings):
//   +1 per triple, +5 per four, +15 per five,
//   +10 full row / full column, +20 full diagonal,
//   +3 cross pattern (H+V three through one stone),
//   +2 breaking an opponent line of 3+.
// ============================================================================

export const SCORE_WEIGHTS = {
  triple: 1,
  four: 5,
  five: 15,
  fullRow: 10,
  fullCol: 10,
  fullDiag: 20,
  cross: 3,
  linebreak: 2,
} as const;

const SCORE_KEYS = Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[];

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function idx(n: number, r: number, c: number) {
  return r * n + c;
}

function inBounds(n: number, r: number, c: number) {
  return r >= 0 && r < n && c >= 0 && c < n;
}

/** Feature counts for placing a stone of `player` at (row, col). */
export function scoreMoveFeatures(
  board: Int8Array,
  n: number,
  row: number,
  col: number,
  player: number
): Record<string, number> {
  const opp = player === 1 ? 2 : 1;
  const feat = Object.fromEntries(SCORE_KEYS.map((k) => [k, 0])) as Record<string, number>;
  let horiz3 = false;
  let vert3 = false;

  for (const [dr, dc] of DIRS) {
    let left = 0;
    let r = row - dr;
    let c = col - dc;
    while (inBounds(n, r, c) && board[idx(n, r, c)] === player) {
      left++;
      r -= dr;
      c -= dc;
    }
    let right = 0;
    r = row + dr;
    c = col + dc;
    while (inBounds(n, r, c) && board[idx(n, r, c)] === player) {
      right++;
      r += dr;
      c += dc;
    }

    const runLen = left + 1 + right;
    const offset = left;
    for (const [K, key] of [
      [3, "triple"],
      [4, "four"],
      [5, "five"],
    ] as [number, string][]) {
      if (runLen >= K) {
        const startMin = Math.max(0, offset - (K - 1));
        const startMax = Math.min(offset, runLen - K);
        feat[key] += Math.max(0, startMax - startMin + 1);
      }
    }

    if (dr === 0 && dc === 1 && runLen >= 3) horiz3 = true;
    if (dr === 1 && dc === 0 && runLen >= 3) vert3 = true;

    // Line break: placing here splits an opponent line (opp on both sides).
    const l1r = row - dr;
    const l1c = col - dc;
    const r1r = row + dr;
    const r1c = col + dc;
    if (
      inBounds(n, l1r, l1c) &&
      inBounds(n, r1r, r1c) &&
      board[idx(n, l1r, l1c)] === opp &&
      board[idx(n, r1r, r1c)] === opp
    ) {
      feat.linebreak += 1;
    }
  }

  if (horiz3 && vert3) feat.cross = 1;

  const cellVal = (r: number, c: number) =>
    r === row && c === col ? player : board[idx(n, r, c)];

  let fullRow = true;
  for (let c = 0; c < n; c++)
    if (cellVal(row, c) !== player) {
      fullRow = false;
      break;
    }

  let fullCol = true;
  for (let r = 0; r < n; r++)
    if (cellVal(r, col) !== player) {
      fullCol = false;
      break;
    }

  feat.fullRow = fullRow ? 1 : 0;
  feat.fullCol = fullCol ? 1 : 0;

  let fullDiag = 0;
  if (row === col) {
    let ok = true;
    for (let i = 0; i < n; i++)
      if (cellVal(i, i) !== player) {
        ok = false;
        break;
      }
    if (ok) fullDiag += 1;
  }
  if (row + col === n - 1) {
    let ok = true;
    for (let i = 0; i < n; i++)
      if (cellVal(i, n - 1 - i) !== player) {
        ok = false;
        break;
      }
    if (ok) fullDiag += 1;
  }
  feat.fullDiag = fullDiag;

  return feat;
}

/** Point delta a single move scores (Score Attack). */
export function scoreMoveDelta(
  board: Int8Array,
  n: number,
  row: number,
  col: number,
  player: number
): number {
  const f = scoreMoveFeatures(board, n, row, col, player);
  return SCORE_KEYS.reduce((s, k) => s + f[k] * SCORE_WEIGHTS[k], 0);
}

/** Full-board score for both sides (Score Attack end-of-game totals). */
export function computeFullScore(
  board: Int8Array,
  n: number
): Record<number, number> {
  const totals: Record<number, number> = { 1: 0, 2: 0 };

  for (let p = 1; p <= 2; p++) {
    const seen: Record<string, Set<string>> = {
      triple: new Set(),
      four: new Set(),
      five: new Set(),
    };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[idx(n, r, c)] !== p) continue;
        for (const [dr, dc] of DIRS) {
          for (const [K, key] of [
            [3, "triple"],
            [4, "four"],
            [5, "five"],
          ] as [number, string][]) {
            let ok = true;
            const cells: number[] = [];
            for (let k = 0; k < K; k++) {
              const rr = r + dr * k;
              const cc = c + dc * k;
              if (!inBounds(n, rr, cc) || board[idx(n, rr, cc)] !== p) {
                ok = false;
                break;
              }
              cells.push(idx(n, rr, cc));
            }
            if (ok) seen[key].add(cells.join(","));
          }
        }
      }
    }

    let total =
      seen.triple.size * SCORE_WEIGHTS.triple +
      seen.four.size * SCORE_WEIGHTS.four +
      seen.five.size * SCORE_WEIGHTS.five;

    // Cross bonus: a stone with >=3 run in both H and V directions.
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[idx(n, r, c)] !== p) continue;
        let h = false;
        let v = false;
        for (const [dr, dc, flag] of [
          [0, 1, "h"],
          [1, 0, "v"],
        ] as [number, number, string][]) {
          let left = 0;
          let rr = r - dr;
          let cc = c - dc;
          while (inBounds(n, rr, cc) && board[idx(n, rr, cc)] === p) {
            left++;
            rr -= dr;
            cc -= dc;
          }
          let right = 0;
          rr = r + dr;
          cc = c + dc;
          while (inBounds(n, rr, cc) && board[idx(n, rr, cc)] === p) {
            right++;
            rr += dr;
            cc += dc;
          }
          if (left + 1 + right >= 3) {
            if (flag === "h") h = true;
            else v = true;
          }
        }
        if (h && v) total += SCORE_WEIGHTS.cross;
      }
    }

    for (let r = 0; r < n; r++) {
      let full = true;
      for (let c = 0; c < n; c++)
        if (board[idx(n, r, c)] !== p) {
          full = false;
          break;
        }
      if (full) total += SCORE_WEIGHTS.fullRow;
    }
    for (let c = 0; c < n; c++) {
      let full = true;
      for (let r = 0; r < n; r++)
        if (board[idx(n, r, c)] !== p) {
          full = false;
          break;
        }
      if (full) total += SCORE_WEIGHTS.fullCol;
    }

    let mainOk = true;
    for (let i = 0; i < n; i++)
      if (board[idx(n, i, i)] !== p) {
        mainOk = false;
        break;
      }
    if (mainOk) total += SCORE_WEIGHTS.fullDiag;

    let antiOk = true;
    for (let i = 0; i < n; i++)
      if (board[idx(n, i, n - 1 - i)] !== p) {
        antiOk = false;
        break;
      }
    if (antiOk) total += SCORE_WEIGHTS.fullDiag;

    totals[p] = total;
  }

  return totals;
}

/** Per-move score breakdown for display (which patterns a move hits). */
export function scoreMovePatterns(
  board: Int8Array,
  n: number,
  row: number,
  col: number,
  player: number
): string[] {
  const f = scoreMoveFeatures(board, n, row, col, player);
  const names: Record<string, string> = {
    triple: "triple",
    four: "four",
    five: "five",
    fullRow: "full row",
    fullCol: "full column",
    fullDiag: "full diagonal",
    cross: "cross",
    linebreak: "line break",
  };
  const out: string[] = [];
  for (const k of SCORE_KEYS) if (f[k] > 0) out.push(f[k] > 1 ? `${f[k]}× ${names[k]}` : names[k]);
  return out;
}

/** Breakdown counts for the scoreboard microtext (fives/fours/triples). */
export function scoreBreakdown(board: Int8Array, n: number): {
  fives: number;
  fours: number;
  triples: number;
} {
  const totals = computeFullScore(board, n);
  void totals;
  // Recount line sets for the breakdown chip.
  const counts = { fives: 0, fours: 0, triples: 0 };
  for (let p = 1; p <= 2; p++) {
    const seen: Record<string, Set<string>> = {
      triple: new Set(),
      four: new Set(),
      five: new Set(),
    };
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[r * n + c] !== p) continue;
        for (const [dr, dc] of DIRS) {
          for (const [K, key] of [
            [3, "triple"],
            [4, "four"],
            [5, "five"],
          ] as [number, string][]) {
            let ok = true;
            const cells: number[] = [];
            for (let k = 0; k < K; k++) {
              const rr = r + dr * k;
              const cc = c + dc * k;
              if (
                !(rr >= 0 && rr < n && cc >= 0 && cc < n) ||
                board[(rr) * n + cc] !== p
              ) {
                ok = false;
                break;
              }
              cells.push(rr * n + cc);
            }
            if (ok) seen[key].add(cells.join(","));
          }
        }
      }
    }
    counts.fives += seen.five.size;
    counts.fours += seen.four.size;
    counts.triples += seen.triple.size;
  }
  return counts;
}
