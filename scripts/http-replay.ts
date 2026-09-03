// ============================================================================
// HTTP end-to-end replay — the EXACT move sequence from the user's screenshot
// through the real POST /api/game/move pipeline (MCTS + RAVE + NN blend +
// v4 tactical/safety layers). The request that produced the blind N10 must
// now produce a safe block (J9 expected).
//
// Each request sends the screenshot's exact pre-move board, so the final
// request reproduces the critical position precisely:
//   black(AI)=2 {D13,H9,K9,H7}   green(You)=1 {G7,J8,J7,L8} + move J6
// ============================================================================

const N = 15;
const URL = "http://localhost:3000/api/game/move";

const cellOf = (l: string) => {
  const letter = l[0];
  const row = N - parseInt(l.slice(1), 10);
  let c = letter.charCodeAt(0) - 65;
  if (letter > "I") c -= 1;
  return [row, c] as const;
};
const labelOf = (r: number, c: number) => {
  const letter = String.fromCharCode(65 + (c >= 8 ? c + 1 : c));
  return `${letter}${N - r}`;
};

function makeBoard(black: string[], green: string[]): number[][] {
  const b = Array.from({ length: N }, () => Array<number>(N).fill(0));
  for (const m of black) {
    const [r, c] = cellOf(m);
    b[r][c] = 2;
  }
  for (const m of green) {
    const [r, c] = cellOf(m);
    b[r][c] = 1;
  }
  return b;
}

async function move(black: string[], green: string[], next: string, history: unknown[]) {
  const [row, col] = cellOf(next);
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      board: makeBoard(black, green),
      boardSize: N,
      winLength: 5,
      gameMode: "classic",
      playerPiece: 1,
      aiPiece: 2,
      row,
      col,
      simulations: 3000,
      moveHistory: history,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(`move failed: ${JSON.stringify(data).slice(0, 300)}`);
  const last = data.state.moveHistory[data.state.moveHistory.length - 1];
  return {
    aiReply: `${labelOf(last.row, last.col)} (player=${last.player})`,
    aiWinProb: data.analysis?.aiWinProb ?? null,
    reasoning: data.analysis?.aiReasoning ?? "",
    stateBoard: data.state.board as number[][],
  };
}

const seq: { black: string[]; green: string[]; next: string }[] = [
  { black: [], green: [], next: "G7" },
  { black: ["D13"], green: ["G7"], next: "J8" },
  { black: ["D13", "H9"], green: ["G7", "J8"], next: "J7" },
  { black: ["D13", "H9", "K9"], green: ["G7", "J8", "J7"], next: "L8" },
  { black: ["D13", "H9", "K9", "H7"], green: ["G7", "J8", "J7", "L8"], next: "J6" },
];

const history: unknown[] = [];
let failures = 0;
for (let i = 0; i < seq.length; i++) {
  const s = seq[i];
  const t0 = Date.now();
  const r = await move(s.black, s.green, s.next, history);
  history.push({ row: cellOf(s.next)[0], col: cellOf(s.next)[1], player: 1, pointsScored: null });
  const replyCell = r.aiReply.slice(0, -11); // strip " (player=2)"
  history.push({ row: cellOf(replyCell)[0], col: cellOf(replyCell)[1], player: 2, pointsScored: null });
  console.log(
    `req${i + 1}: you ${s.next} -> AI ${r.aiReply}  [${Date.now() - t0}ms]  AI win% ${r.aiWinProb}` +
      (i === seq.length - 1 ? `\n       reasoning: ${r.reasoning}` : "")
  );
  if (i === seq.length - 1) {
    const okMove = replyCell === "J9" || replyCell === "J5";
    const okEval = typeof r.aiWinProb === "number" && r.aiWinProb <= 30.001;
    console.log(`${okMove ? "PASS" : "FAIL"}  critical reply blocks the open three (got ${replyCell})`);
    console.log(`${okEval ? "PASS" : "FAIL"}  eval bar honest: AI win% ${r.aiWinProb} ≤ 30 (was a blind 78.3%)`);
    if (!okMove) failures++;
    if (!okEval) failures++;
  }
}
console.log(failures === 0 ? "\nHTTP REPLAY PASS" : `\n${failures} HTTP REPLAY FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
