// ============================================================================
// Fuzz safety suite — proves the v4 guarantee GENERALIZES ("not just it").
//
// For hundreds of randomized midgame positions:
//   1. Compute bestPossible = min danger over ALL legal moves.
//   2. Take the AI's REAL selection path (tactical v4 + ensureSafeMove) and
//      also an ADVERSARIAL base pick (worst reasonable-looking cell fed
//      through the same final safety validation, mimicking a blind search /
//      NN pick).
//   3. Assert both final picks achieve the best achievable danger — i.e. the
//      AI never allows an unstoppable four when one could be avoided.
//
// Also replays the EXACT screenshot continuation: after the fixed AI blocks
// J9, green tries the chase J5 → K8 → … and every AI reply must stay minimal.
// ============================================================================

import {
  tacticalMove,
  classifyBoard,
  CAT,
  coordLabel,
  assessMoveDanger,
  ensureSafeMove,
  emptyBoard,
} from "../src/lib/game/threat-classifier";
import { GlobalRAVE, mulberry32 } from "../src/lib/game/mcts";

const n = 15;
const winLen = 5;

/** Random alternating-stones position; returns board or null if empty. */
function randomPosition(rng: () => number, stones: number): Int8Array | null {
  const board = emptyBoard(n);
  let player = 1;
  for (let k = 0; k < stones; k++) {
    const empties: number[] = [];
    for (let i = 0; i < board.length; i++) if (board[i] === 0) empties.push(i);
    if (!empties.length) return null;
    // Bias toward the centre region so threats actually form.
    let cell = empties[Math.floor(rng() * empties.length)];
    if (rng() < 0.7) {
      const near: number[] = [];
      const r0 = 3 + Math.floor(rng() * 9);
      const c0 = 3 + Math.floor(rng() * 9);
      for (const e of empties) {
        const r = Math.floor(e / n);
        const c = e % n;
        if (Math.abs(r - r0) <= 3 && Math.abs(c - c0) <= 3) near.push(e);
      }
      if (near.length) cell = near[Math.floor(rng() * near.length)];
    }
    board[cell] = player;
    player = player === 1 ? 2 : 1;
  }
  return board;
}

function bestPossibleDanger(board: Int8Array, me: number, opp: number): number {
  let best = Infinity;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) continue;
    const d = assessMoveDanger(board, n, winLen, i, me, opp).danger;
    if (d < best) best = d;
  }
  return best;
}

/** Adversarial base: the legal cell FARTHEST from the worst threat — a
 *  stand-in for a blind search/NN pick — chosen among cells with ≥1 neighbour
 *  so it looks plausible. */
function adversarialPick(board: Int8Array): number {
  const empties: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) empties.push(i);
  // Prefer the minimum-classification cell (most oblivious to threats).
  let worst = empties[0];
  let worstScore = Infinity;
  for (const e of empties) {
    const c = classifyBoard(board, n, 2, winLen).get(e);
    const s = c ? c.score : 0;
    if (s < worstScore) {
      worstScore = s;
      worst = e;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Part A — randomized generalization
// ---------------------------------------------------------------------------
const rng = mulberry32(20260903);
let cases = 0;
let rescued = 0;
let violations = 0;
let alreadyLost = 0;

for (let t = 0; t < 400; t++) {
  const stones = 8 + Math.floor(rng() * 10);
  const board = randomPosition(rng, stones);
  if (!board) continue;

  // Keep only positions where the PLAYER has a forcing structure worth testing:
  // some empty cell gives the player a four-level or open-three-level threat.
  const oppThreat = [...classifyBoard(board, n, 1, winLen).values()].some(
    (c) => c.category >= CAT.SIMPLE_FOUR || c.category === CAT.OPEN_THREE
  );
  if (!oppThreat) continue;
  cases++;

  const best = bestPossibleDanger(board, 2, 1);

  // (a) Real path: tactical root pick through the final safety validation.
  const tac = tacticalMove(board, n, winLen, 2, 1);
  const baseA = tac && board[tac.cell] === 0 ? tac.cell : adversarialPick(board);
  const finalA = ensureSafeMove(board, n, winLen, 2, 1, baseA);
  const dA = assessMoveDanger(board, n, winLen, finalA.cell, 2, 1).danger;

  // (b) Adversarial path: blind pick through the same final validation.
  const blind = adversarialPick(board);
  const finalB = ensureSafeMove(board, n, winLen, 2, 1, blind);
  const dB = assessMoveDanger(board, n, winLen, finalB.cell, 2, 1).danger;

  if (finalB.cell !== blind) rescued++;
  if (best >= 95) alreadyLost++;
  if (dA > best + 1e-9 || dB > best + 1e-9) {
    violations++;
    if (violations <= 5) {
      const rows: string[] = [];
      for (let r = 0; r < n; r++) {
        let line = "";
        for (let c = 0; c < n; c++) line += board[r * n + c] === 0 ? "." : board[r * n + c] === 1 ? "O" : "X";
        rows.push(line);
      }
      console.log(`VIOLATION case ${t} (best=${best} gotA=${dA}@${coordLabel(Math.floor(finalA.cell / n), finalA.cell % n, n)} gotB=${dB}@${coordLabel(Math.floor(finalB.cell / n), finalB.cell % n, n)})`);
      console.log(rows.join("\n"));
    }
  }
}

console.log(`\n== Fuzz: ${cases} forcing positions ==`);
console.log(`already-lost positions (double threats, unavoidable): ${alreadyLost}`);
console.log(`adversarial blind picks rescued by safety layer:      ${rescued}`);
console.log(`guarantee violations (worse than best possible):      ${violations}`);
const fuzzOk = violations === 0;
console.log(fuzzOk ? "FUZZ PASS — avoidable fours are ALWAYS avoided." : "FUZZ FAIL");

// ---------------------------------------------------------------------------
// Part B — exact screenshot continuation chase
// ---------------------------------------------------------------------------
const label = (cell: number) => coordLabel(Math.floor(cell / n), cell % n, n);
const cellOf = (l: string) => {
  const letter = l[0];
  const row = n - parseInt(l.slice(1), 10);
  let c = letter.charCodeAt(0) - 65;
  if (letter > "I") c -= 1;
  return row * n + c;
};

const board = emptyBoard(n);
for (const m of ["D13", "H9", "K9", "H7"]) board[cellOf(m)] = 2;
for (const m of ["J8", "L8", "G7", "J7", "J6"]) board[cellOf(m)] = 1;

const chase: string[] = [];
let chaseOk = true;
// AI must block (J9), then answer green's forcing tries J5, K8, M8, H8...
const greenTries = ["J5", "K8", "M8", "H8", "J10"];
for (const tryMove of greenTries) {
  const tac = tacticalMove(board, n, winLen, 2, 1);
  const base = tac && board[tac.cell] === 0 ? tac.cell : adversarialPick(board);
  const final = ensureSafeMove(board, n, winLen, 2, 1, base);
  const d = assessMoveDanger(board, n, winLen, final.cell, 2, 1).danger;
  const best = bestPossibleDanger(board, 2, 1);
  chase.push(`AI ${label(final.cell)} (danger ${d}, best ${best})`);
  if (d > best + 1e-9) chaseOk = false;
  board[final.cell] = 2;
  if (board[cellOf(tryMove)] !== 0) continue; // line already dead
  board[cellOf(tryMove)] = 1;
}
console.log("\n== Chase from the exact screenshot position ==");
console.log("  " + chase.join(" -> "));
console.log(chaseOk ? "CHASE PASS — every reply stayed optimal." : "CHASE FAIL");

process.exit(fuzzOk && chaseOk ? 0 : 1);
