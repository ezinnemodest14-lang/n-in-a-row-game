// Rigged review test: player wins with 5 in a row on row 7 (H8..L8);
// AI plays scattered stones. Verify final point = 100, winning move is
// "brilliant", and the forced-block detector fires on the AI's misses.
const BASE = "http://localhost:3000";

async function main() {
  const history: { row: number; col: number; player: number }[] = [];
  const push = (row: number, col: number, player: number) =>
    history.push({ row, col, player });

  // Interleave: player builds H8,I8,J8,K8,L8 (row index 7, cols 7..11);
  // AI plays its own line on row 9 (cols 7..10) — one short, then fails to
  // block the player's four at L8 (classic missed-block blunder to verify).
  push(7, 7, 1); push(9, 7, 2);
  push(7, 8, 1); push(9, 8, 2);
  push(7, 9, 1); push(9, 9, 2);
  push(7, 10, 1); push(9, 10, 2);
  // AI has a four on row 9 (I9..M9 = cols 8..11? no: cols 7..10 = four cells,
  // five completes at col 11 (M9) or col 6 (G9)). Player ignores BOTH and
  // completes their own five — the AI's previous move was the missed block.
  push(7, 11, 1);

  const res = await fetch(`${BASE}/api/game/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      moveHistory: history, boardSize: 15, winLength: 5,
      gameMode: "classic", playerPiece: 1, aiPiece: 2,
    }),
  });
  const data = (await res.json()) as {
    ok: boolean; error?: string;
    review?: {
      usedNn: boolean;
      accuracy: { player: number; ai: number };
      points: { move: number; winProb: number }[];
      moves: { moveNo: number; player: number; coord: string; grade: string; delta: number; headline: string }[];
      summary: string[];
    };
  };
  if (!data.ok || !data.review) throw new Error(data.error ?? "review failed");
  const rv = data.review;
  console.log(`usedNn=${rv.usedNn} accuracy: you ${rv.accuracy.player}% ai ${rv.accuracy.ai}%`);
  console.log(`curve: ${rv.points.map((p) => p.winProb).join(" ")}`);
  for (const m of rv.moves) {
    console.log(`#${m.moveNo} ${m.player === 1 ? "YOU" : "AI "} ${m.coord} → ${m.grade.toUpperCase().padEnd(11)} (${m.delta >= 0 ? "+" : ""}${m.delta}) ${m.headline}`);
  }
  for (const s of rv.summary) console.log(`- ${s}`);

  // Assertions
  const finalPt = rv.points[rv.points.length - 1];
  if (finalPt.winProb !== 100) throw new Error(`final point should be 100, got ${finalPt.winProb}`);
  const lastMove = rv.moves[rv.moves.length - 1];
  if (lastMove.grade !== "brilliant") throw new Error(`winning move should be brilliant, got ${lastMove.grade}`);
  // AI's move #8 extended its own line instead of blocking the player's four
  // at G8 — the review must flag it as the game-losing blunder.
  const aiBlunder = rv.moves.find((m) => m.grade === "blunder" && m.player === 2);
  if (!aiBlunder) throw new Error("AI's missed block should be a blunder");
  // Taking your own win outranks blocking the opponent's four — brilliant,
  // NOT a blunder even though the AI also had a four on the board.
  if (lastMove.grade !== "brilliant") throw new Error("win outranks block");
  console.log("\nALL REVIEW ASSERTIONS PASS ✓");
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
