// Test harness: play a short scripted game through the real move API,
// verify nnSuggestions arrive in the analysis payload, then run the
// NN game review and print the summary.
const BASE = "http://localhost:3000";

interface MoveResp {
  ok: boolean;
  error?: string;
  state?: {
    board: number[][];
    status: string;
    moveHistory: { row: number; col: number; player: number; pointsScored?: number | null }[];
  };
  analysis?: {
    winProb: number;
    nnSuggestions?: { row: number; col: number; nnWinProb: number; tag: string; tactical?: boolean }[];
    nnMeta?: { params: number; trainingSamples: number } | null;
    nnReRank?: { agreed?: boolean };
  } | null;
}

function coord(r: number, c: number, n = 15) {
  const letter = String.fromCharCode(65 + (c >= 8 ? c + 1 : c));
  return `${letter}${n - r}`;
}

async function move(board: number[][], row: number, col: number, history: unknown[]) {
  const res = await fetch(`${BASE}/api/game/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      board, boardSize: 15, winLength: 5, gameMode: "classic",
      playerPiece: 1, aiPiece: 2, row, col, simulations: 800, moveHistory: history,
    }),
  });
  const data = (await res.json()) as MoveResp;
  if (!data.ok) throw new Error(`move failed: ${data.error}`);
  return data;
}

async function main() {
  let board = Array.from({ length: 15 }, () => new Array<number>(15).fill(0));
  let history: { row: number; col: number; player: number }[] = [];
  let lastSuggestions: MoveResp["analysis"] = null;

  // Player plays a diagonal-ish development; AI answers each time.
  // Fallbacks keep the script robust to the AI occupying a preferred cell.
  const playerPrefs: [number, number][][] = [
    [[7, 7], [6, 6], [8, 8], [7, 6]],
    [[8, 8], [7, 8], [6, 6], [8, 7]],
    [[6, 8], [6, 7], [5, 7], [7, 8]],
    [[9, 7], [9, 8], [10, 7], [9, 6]],
    [[5, 7], [4, 7], [5, 6], [6, 9]],
  ];
  for (const prefs of playerPrefs) {
    const [r, c] = prefs.find(([rr, cc]) => board[rr][cc] === 0) ?? prefs[0];
    const resp = await move(board, r, c, history);
    board = resp.state!.board;
    history = resp.state!.moveHistory.map((m) => ({ row: m.row, col: m.col, player: m.player }));
    lastSuggestions = resp.analysis ?? null;
    console.log(
      `you ${coord(r, c)} → AI ${resp.state!.moveHistory.length % 2 === 0 ? coord(...(lastEntry(resp)!)) : "?"} | status=${resp.state!.status} | winProb=${resp.analysis?.winProb}`
    );
    if (resp.analysis?.nnSuggestions?.length) {
      for (const s of resp.analysis.nnSuggestions) {
        console.log(`   NN sugg: ${coord(s.row, s.col)} ${s.nnWinProb.toFixed(1)}% ${s.tactical ? "[ENGINE✓]" : ""} — ${s.tag}`);
      }
      console.log(`   NN meta: ${JSON.stringify(resp.analysis.nnMeta)}`);
    } else {
      console.log("   (no NN suggestions in payload!)");
    }
  }

  console.log(`\nHistory: ${history.length} moves, status=${JSON.stringify(history.slice(-2))}`);

  // ---- Game review ----
  const t0 = Date.now();
  const rev = await fetch(`${BASE}/api/game/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      moveHistory: history, boardSize: 15, winLength: 5,
      gameMode: "classic", playerPiece: 1, aiPiece: 2,
    }),
  });
  const revData = (await rev.json()) as {
    ok: boolean; error?: string;
    review?: {
      usedNn: boolean;
      accuracy: { player: number; ai: number };
      points: { move: number; winProb: number }[];
      moves: { moveNo: number; player: number; coord: string; grade: string; delta: number; headline: string }[];
      summary: string[];
    };
  };
  const tookMs = Date.now() - t0;
  if (!revData.ok || !revData.review) throw new Error(`review failed: ${revData.error}`);
  const rv = revData.review;
  console.log(`\n=== GAME REVIEW (${tookMs}ms, usedNn=${rv.usedNn}) ===`);
  console.log(`accuracy: you ${rv.accuracy.player}% | ai ${rv.accuracy.ai}%`);
  console.log(`curve: ${rv.points.map((p) => p.winProb.toFixed(0)).join(" ")}`);
  for (const m of rv.moves) {
    console.log(`#${m.moveNo} ${m.player === 1 ? "YOU" : "AI "} ${m.coord} → ${m.grade.toUpperCase().padEnd(11)} (${m.delta >= 0 ? "+" : ""}${m.delta}) ${m.headline}`);
  }
  console.log("summary:");
  for (const s of rv.summary) console.log(`  - ${s}`);
}

function lastEntry(resp: MoveResp): [number, number] | null {
  const h = resp.state?.moveHistory;
  if (!h || h.length === 0) return null;
  const m = h[h.length - 1];
  return m.player === 2 ? [m.row, m.col] : null;
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
