/**
 * features.ts — 40-dimensional feature extraction for the N-in-a-row (Gomoku-like)
 * neural evaluator. Pure TypeScript: no external ML libraries, no npm dependencies.
 *
 * Board convention:
 *   0 = empty cell
 *   1 = player 1 (human, emerald stones) — always moves first
 *   2 = player 2 (AI, slate/black stones)
 *
 * All features are scaled to [0, 1] (clamped). The two players are laid out
 * symmetrically everywhere (player 1's stat immediately followed by player 2's),
 * so the ordering carries no built-in bias and the downstream network output can
 * be read as the win probability from player 1's perspective
 * ("player-1-perspective positive").
 *
 * ─── Feature vector layout (index: meaning) ──────────────────────────────────
 *  Direction block — indices 0..23 (4 directions × 2 players × 3 stats):
 *    Direction order: 0 = horizontal, 1 = vertical, 2 = diag-down "\", 3 = diag-up "/".
 *    Within each direction, player 1 occupies +0..+2 and player 2 occupies +3..+5:
 *      +0  maxConsecutiveRun / 5   longest maximal same-player run along that
 *                                  direction, normalized by the 5-length window
 *      +1  openEnds / 2            open (empty & in-bounds) ends of that longest
 *                                  run: 0 = closed both ends, 0.5 = one open,
 *                                  1.0 = both ends open
 *      +2  threatCount / 8         number of maximal runs with length >= 3 along
 *                                  that direction, saturating at 8 runs
 *  24  stone density       total stones on board / (n*n)
 *  25  empty ratio         1 − index 24
 *  26  center influence P1 mean Euclidean distance-to-center of P1 stones divided
 *                          by the max possible distance (corner). 0.5 neutral
 *                          placeholder when the player has no stones.
 *  27  center influence P2 same for player 2.
 *  28  stone share P1      stones1 / totalStones. 0.5 on an empty board.
 *  29  stone share P2      stones2 / totalStones. 0.5 on an empty board.
 *  30  line potential P1   Σ over win-capable lines (length >= 5) of
 *                          (P1 stones in line)², saturating map s/(s+n).
 *  31  line potential P2   same formula for player 2.
 *  32  mobility P1 (4-neigh)  empty cells 4-adjacent to a P1 stone / emptyCount
 *  33  mobility P1 (8-neigh)  empty cells 8-adjacent to a P1 stone / emptyCount
 *  34  mobility P2 (4-neigh)  same for player 2
 *  35  mobility P2 (8-neigh)  same for player 2
 *  36  last mover bias     1.0 = P1 made the last move, 0.0 = P2 made the last
 *                          move, 0.5 = empty board. Inferred from stone parity
 *                          (P1 always moves first).
 *  37  turn slot           1.0 = P1 to move next, 0.0 = P2 to move next
 *                          (parity inference; P1 opens the game).
 *  38  reserved pad        always 0
 *  39  reserved pad        always 0
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Fixed feature vector dimensionality (must equal the MLP input layer size). */
export const FEATURE_DIM = 40;

/** Minimum line length that can possibly produce a win (5-length windows). */
const WIN_WINDOW = 5;

/** Run length at or above which a maximal run counts as a "threat". */
const THREAT_MIN_RUN = 3;

/** Saturating divisor for the per-direction threat-count feature. */
const THREAT_COUNT_SCALE = 8;

/**
 * The four scan directions, in feature order:
 *   horizontal (0,1) · vertical (1,0) · diag-down "\" (1,1) · diag-up "/" (1,-1)
 */
export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Per-direction, per-player run statistics used by the direction block. */
interface RunStats {
  /** Length of the longest maximal run (ties resolved toward more open ends). */
  maxRun: number;
  /** Open ends (0, 1 or 2) of that longest run. */
  openEnds: number;
  /** How many maximal runs reached length >= THREAT_MIN_RUN. */
  threats: number;
}

/**
 * Scan every maximal run of `player` along direction (dr, dc) and aggregate
 * { maxRun, openEnds, threats }. A run only starts being counted at cells whose
 * predecessor (one step in the anti-direction) is not the same player, so each
 * maximal run is visited exactly once — O(n²) per direction per player.
 */
function scanRuns(board: number[][], n: number, dr: number, dc: number, player: number): RunStats {
  let maxRun = 0;
  let openEndsOfMax = 0;
  let threats = 0;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== player) continue;

      // Skip stones that are interior to a run (their predecessor is ours).
      const pr = r - dr;
      const pc = c - dc;
      const prevInside = pr >= 0 && pr < n && pc >= 0 && pc < n;
      if (prevInside && board[pr][pc] === player) continue;

      // Walk forward to the end of the run.
      let len = 1;
      let er = r + dr;
      let ec = c + dc;
      while (er >= 0 && er < n && ec >= 0 && ec < n && board[er][ec] === player) {
        len++;
        er += dr;
        ec += dc;
      }
      // (er, ec) now sits one step past the run's final stone.

      const openBefore = prevInside && board[pr][pc] === 0 ? 1 : 0;
      const endInside = er >= 0 && er < n && ec >= 0 && ec < n;
      const openAfter = endInside && board[er][ec] === 0 ? 1 : 0;
      const open = openBefore + openAfter;

      if (len >= THREAT_MIN_RUN) threats++;
      if (len > maxRun || (len === maxRun && open > openEndsOfMax)) {
        maxRun = len;
        openEndsOfMax = open;
      }
    }
  }
  return { maxRun, openEnds: openEndsOfMax, threats };
}

/**
 * "Line potential" — for every win-capable line (maximal straight line of at
 * least WIN_WINDOW cells along any of the 4 directions), add (stones in line)²
 * per player. Squaring rewards concentration of stones on a single line, which
 * is what actually produces wins.
 */
function linePotentials(board: number[][], n: number): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;
  for (let d = 0; d < DIRS.length; d++) {
    const [dr, dc] = DIRS[d];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        // Only enumerate a line at its first cell (predecessor out of bounds).
        const pr = r - dr;
        const pc = c - dc;
        if (pr >= 0 && pr < n && pc >= 0 && pc < n) continue;

        let len = 0;
        let k1 = 0;
        let k2 = 0;
        let er = r;
        let ec = c;
        while (er >= 0 && er < n && ec >= 0 && ec < n) {
          len++;
          const v = board[er][ec];
          if (v === 1) k1++;
          else if (v === 2) k2++;
          er += dr;
          ec += dc;
        }
        if (len >= WIN_WINDOW) {
          p1 += k1 * k1;
          p2 += k2 * k2;
        }
      }
    }
  }
  return { p1, p2 };
}

/**
 * Extract the full 40-dimensional feature vector for `board` (n×n).
 * See the layout table in the file header. Everything is clamped to [0, 1].
 */
export function extractFeatures(board: number[][], n: number): Float64Array {
  const f = new Float64Array(FEATURE_DIM);
  const n2 = n * n;
  const center = (n - 1) / 2;
  const maxDist = Math.SQRT2 * center || 1;

  // ── Pass 1: stone counts + center influence (feeds indices 24..29) ──
  let stones1 = 0;
  let stones2 = 0;
  let dist1 = 0;
  let dist2 = 0;
  for (let r = 0; r < n; r++) {
    const row = board[r];
    for (let c = 0; c < n; c++) {
      const v = row[c];
      if (v === 1) {
        stones1++;
        dist1 += Math.hypot(r - center, c - center);
      } else if (v === 2) {
        stones2++;
        dist2 += Math.hypot(r - center, c - center);
      }
    }
  }
  const total = stones1 + stones2;

  f[24] = clamp01(total / n2); // stone density
  f[25] = clamp01(1 - f[24]); // empty ratio
  f[26] = stones1 > 0 ? clamp01(dist1 / stones1 / maxDist) : 0.5; // center P1
  f[27] = stones2 > 0 ? clamp01(dist2 / stones2 / maxDist) : 0.5; // center P2
  f[28] = total > 0 ? clamp01(stones1 / total) : 0.5; // stone share P1
  f[29] = total > 0 ? clamp01(stones2 / total) : 0.5; // stone share P2

  // ── Direction block (indices 0..23): 4 directions × {P1, P2} × 3 stats ──
  for (let d = 0; d < DIRS.length; d++) {
    const [dr, dc] = DIRS[d];
    const dirBase = d * 6;

    const s1 = scanRuns(board, n, dr, dc, 1);
    f[dirBase + 0] = clamp01(s1.maxRun / WIN_WINDOW); // P1 max run
    f[dirBase + 1] = clamp01(s1.openEnds / 2); // P1 open ends of max run
    f[dirBase + 2] = clamp01(s1.threats / THREAT_COUNT_SCALE); // P1 threats (runs >= 3)

    const s2 = scanRuns(board, n, dr, dc, 2);
    f[dirBase + 3] = clamp01(s2.maxRun / WIN_WINDOW); // P2 max run
    f[dirBase + 4] = clamp01(s2.openEnds / 2); // P2 open ends of max run
    f[dirBase + 5] = clamp01(s2.threats / THREAT_COUNT_SCALE); // P2 threats (runs >= 3)
  }

  // ── Line potential (indices 30, 31): saturating map s/(s+n) ∈ (0,1) ──
  const lp = linePotentials(board, n);
  f[30] = lp.p1 > 0 ? clamp01(lp.p1 / (lp.p1 + n)) : 0;
  f[31] = lp.p2 > 0 ? clamp01(lp.p2 / (lp.p2 + n)) : 0;

  // ── Mobility (indices 32..35): reachable empty cells per player ──
  const empty = n2 - total;
  if (empty > 0) {
    let m1_4 = 0;
    let m1_8 = 0;
    let m2_4 = 0;
    let m2_8 = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[r][c] !== 0) continue;
        let a1_4 = false;
        let a2_4 = false;
        let a1_8 = false;
        let a2_8 = false;
        for (let drr = -1; drr <= 1; drr++) {
          for (let dcc = -1; dcc <= 1; dcc++) {
            if (drr === 0 && dcc === 0) continue;
            const rr = r + drr;
            const cc = c + dcc;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            const v = board[rr][cc];
            if (v === 1) {
              a1_8 = true;
              if (drr === 0 || dcc === 0) a1_4 = true; // orthogonal ⇒ also 4-neigh
            } else if (v === 2) {
              a2_8 = true;
              if (drr === 0 || dcc === 0) a2_4 = true;
            }
          }
        }
        if (a1_4) m1_4++;
        if (a1_8) m1_8++;
        if (a2_4) m2_4++;
        if (a2_8) m2_8++;
      }
    }
    f[32] = clamp01(m1_4 / empty); // P1 4-neighborhood mobility
    f[33] = clamp01(m1_8 / empty); // P1 8-neighborhood mobility
    f[34] = clamp01(m2_4 / empty); // P2 4-neighborhood mobility
    f[35] = clamp01(m2_8 / empty); // P2 8-neighborhood mobility
  }

  // ── Last mover bias (36) + turn slot (37), inferred from stone parity ──
  if (total === 0) {
    f[36] = 0.5; // no moves yet — neutral
    f[37] = 1.0; // player 1 opens the game
  } else if (total % 2 === 1) {
    f[36] = 1.0; // odd stone count ⇒ player 1 made the last move
    f[37] = 0.0; // player 2 to move next
  } else {
    f[36] = 0.0; // even stone count ⇒ player 2 made the last move
    f[37] = 1.0; // player 1 to move next
  }

  // Indices 38 and 39 remain 0 (reserved pads) — Float64Array is zero-filled.
  return f;
}
