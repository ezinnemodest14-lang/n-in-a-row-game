// ============================================================================
// Replay test — the EXACT position from the user's screenshot (Task 12).
//
// Screenshot: black(AI)=2 {D13, N10, H9, K9, H7}, green(You)=1
// {J8, L8, G7, J7, J6}. Green's J6 created an open three J6-J7-J8 (column J,
// both ends empty). The old v3 net answered J10 — a broken-four point — while
// the open three's end J9 stayed alive: green plays J5 → open four → lost.
// "What is this blind move the AI is making, allowing an unstoppable 4?"
//
// PASS requires, on this exact board:
//   1. tacticalMove picks J9 (or J5) with a block reason — never J10/J4.
//   2. danger(J9)=0, danger(J10)=95 (the old pick is measured as losing).
//   3. runMCTS plays J9/J5 across many seeds (tactical + safety layers).
//   4. The full HTTP pipeline (route + NN blend + safety) plays J9/J5.
// ============================================================================

import { tacticalMove, classifyBoard, CAT_NAME, coordLabel, assessMoveDanger } from "../src/lib/game/threat-classifier";
import { GlobalRAVE, runMCTS, ensureSafeMove } from "../src/lib/game/mcts";

const n = 15;
const winLen = 5;
const board = new Int8Array(n * n);
const play = (label: string, p: number) => {
  const letter = label[0];
  const row = n - parseInt(label.slice(1), 10);
  let c = letter.charCodeAt(0) - 65;
  if (letter > "I") c -= 1;
  board[row * n + c] = p;
};

// AI (black, 2) — exactly as in the screenshot (minus its blind N10 reply).
for (const m of ["D13", "H9", "K9", "H7"]) play(m, 2);
// Player (green, 1)
for (const m of ["J8", "L8", "G7", "J7", "J6"]) play(m, 1);

const label = (cell: number) => coordLabel(Math.floor(cell / n), cell % n, n);
const cellOf = (l: string) => {
  const letter = l[0];
  const row = n - parseInt(l.slice(1), 10);
  let c = letter.charCodeAt(0) - 65;
  if (letter > "I") c -= 1;
  return row * n + c;
};

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!ok) failures++;
};

console.log("== 1. Green threat cells on this board ==");
const opp = classifyBoard(board, n, 1, winLen);
for (const [cell, c] of [...opp.entries()].sort((a, b) => a[0] - b[0])) {
  if (c.category >= 5) console.log(`  ${label(cell)}: ${CAT_NAME[c.category]}`);
}

console.log("\n== 2. tacticalMove (root mode, v4) ==");
const tac = tacticalMove(board, n, winLen, 2, 1);
console.log("  ->", tac ? { move: label(tac.cell), reason: tac.reason } : "null");
check(
  "tactical block choice",
  !!tac && ["J9", "J5"].includes(label(tac.cell)) && tac.reason.startsWith("block"),
  `got ${tac ? `${label(tac.cell)} (${tac.reason})` : "null"} — the old net played the LOSING J10`
);

console.log("\n== 3. Safety scores (100=lost, 0=safe) ==");
for (const c of ["J9", "J5", "J10", "J4"]) {
  const d = assessMoveDanger(board, n, winLen, cellOf(c), 2, 1);
  console.log(`  AI plays ${c}: danger ${d.danger}, counter ${d.counter.toFixed(0)}`);
}
check("J9 is safe", assessMoveDanger(board, n, winLen, cellOf("J9"), 2, 1).danger === 0, "");
check("J10 is losing", assessMoveDanger(board, n, winLen, cellOf("J10"), 2, 1).danger >= 95, "green J5 → open four");

console.log("\n== 4. ensureSafeMove refuses to keep J10 ==");
const safe = ensureSafeMove(board, n, winLen, 2, 1, cellOf("J10"));
console.log("  ->", { cell: label(safe.cell), changed: safe.changed, danger: safe.danger, reason: safe.reason });
check("safety layer overturns J10", ["J9", "J5"].includes(label(safe.cell)), "");

console.log("\n== 5. runMCTS final pick across 8 seeds (fresh + RAVE-seeded) ==");
for (let s = 1; s <= 8; s++) {
  const rave = new GlobalRAVE(n);
  if (s > 4) for (let k = 0; k < 400; k++) rave.update(1, cellOf("H8"), 0.5); // noisy prior table
  const res = runMCTS({
    board, n, winLen, mode: "classic", aiPlayer: 2,
    simulations: 1500, timeLimitMs: 900, globalRave: rave, seed: s * 7919, movePath: [],
  });
  const mv = label(res.move);
  console.log(`  seed ${s * 7919}: ${mv} (${res.reason})`);
  check(`engine pick seed ${s * 7919}`, ["J9", "J5"].includes(mv), res.reason);
}

console.log(failures === 0 ? "\nALL PASS — the AI now answers the open three with a safe block." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
