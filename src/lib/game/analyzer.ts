// ============================================================================
// Analyzer — builds the full `Analysis` object consumed by the UI, plus
// per-turn learning telemetry and Score Attack analytics.
//
// Sign/derivation rules carried over from the reference build:
//   • evalScore is POSITIVE when the human player is ahead (bug #15).
//   • winProb (player) is DERIVED as 100 - aiWinProb — never round both
//     independently (bug #17).
// ============================================================================

import {
  CAT,
  CAT_NAME,
  CAT_VALUE,
  classifyBoard,
  classifyCell,
  describeCategory,
  evaluatePosition,
} from "./threat-classifier";
import { scoreMoveDelta, scoreMovePatterns, computeFullScore } from "./scoring";
import type { MctsResult } from "./types";
import type {
  AiCandidateMove,
  Analysis,
  BoardControl,
  CriticalSquare,
  LearningSnapshot,
  PlayerBestMove,
  ScoringAnalysis,
  ThreatCounts,
} from "./types";
import type { GlobalRAVE } from "./mcts";
import type { NnSuggestion } from "./types";
import { REASON_TEXT } from "./threat-classifier";

function emptyThreats(): ThreatCounts {
  return { Five: 0, OpenFour: 0, HalfOpenFour: 0, OpenThree: 0, HalfOpenThree: 0 };
}

function countThreats(board: Int8Array, n: number, player: number, winLen: number): ThreatCounts {
  const counts = emptyThreats();
  const cells = classifyBoard(board, n, player, winLen);
  for (const [, c] of cells) {
    switch (c.category) {
      case CAT.WIN:
        counts.Five++;
        break;
      case CAT.OPEN_FOUR:
        counts.OpenFour++;
        break;
      case CAT.SIMPLE_FOUR:
        counts.HalfOpenFour++;
        break;
      case CAT.OPEN_THREE:
        counts.OpenThree++;
        break;
      case CAT.SIMPLE_THREE:
        counts.HalfOpenThree++;
        break;
      default:
        break;
    }
  }
  return counts;
}

function buildCriticalSquares(
  board: Int8Array,
  n: number,
  winLen: number
): CriticalSquare[] {
  const squares: CriticalSquare[] = [];
  const seen = new Set<string>();
  const push = (cell: number, severity: "vital" | "important", forPlayer: string, reason: string) => {
    const key = `${cell}`;
    if (seen.has(key)) return;
    seen.add(key);
    squares.push({
      row: Math.floor(cell / n),
      col: cell % n,
      severity,
      forPlayer,
      reason,
    });
  };

  const playerCells = classifyBoard(board, n, 1, winLen);
  const aiCells = classifyBoard(board, n, 2, winLen);

  for (const [cell, c] of playerCells) {
    if (c.category === CAT.WIN) push(cell, "vital", "player", "Completes your five — winning move");
    else if (c.category === CAT.OPEN_FOUR) push(cell, "vital", "player", "Creates an unstoppable open four");
    else if (c.category === CAT.SIMPLE_FOUR) push(cell, "vital", "player", "Creates a four — forces a reply");
    else if (c.isFork) push(cell, "vital", "player", "Fork — two threats at once");
    else if (c.category === CAT.OPEN_THREE) push(cell, "important", "player", "Extends an open three");
  }
  for (const [cell, c] of aiCells) {
    if (c.category === CAT.WIN) push(cell, "vital", "ai", "AI would complete five here — block or win first");
    else if (c.category === CAT.OPEN_FOUR) push(cell, "vital", "ai", "AI open four here — must be stopped");
    else if (c.category === CAT.SIMPLE_FOUR) push(cell, "vital", "ai", "AI four here — deny the line");
    else if (c.isFork) push(cell, "important", "ai", "AI fork point — watch this square");
    else if (c.category === CAT.OPEN_THREE) push(cell, "important", "ai", "AI open three extension");
  }

  squares.sort((a, b) => {
    const sev = (s: string) => (s === "vital" ? 0 : 1);
    return sev(a.severity) - sev(b.severity);
  });
  return squares.slice(0, 6);
}

function buildTempo(
  playerThreats: ThreatCounts,
  aiThreats: ThreatCounts
): Analysis["tempo"] {
  const val = (t: ThreatCounts) =>
    t.Five * 10 + t.OpenFour * 9 + t.HalfOpenFour * 7 + t.OpenThree * 5 + t.HalfOpenThree * 2;
  const p = Math.min(10, val(playerThreats));
  const a = Math.min(10, val(aiThreats));
  let urgency: Analysis["tempo"]["urgency"] = "none";
  if (aiThreats.Five > 0 || playerThreats.Five > 0 || aiThreats.OpenFour > 0 || playerThreats.OpenFour > 0)
    urgency = "critical";
  else if (a > p + 2) urgency = "defend";
  else if (p > a + 2) urgency = "attack";
  return { playerInitiative: p, aiInitiative: a, urgency };
}

function buildBoardControl(board: Int8Array, n: number): BoardControl {
  const totalCells = n * n;
  let pStones = 0;
  let aStones = 0;
  let pDist = 0;
  let aDist = 0;
  const mid = (n - 1) / 2;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 1) {
      pStones++;
      const r = Math.floor(i / n);
      const c = i % n;
      pDist += 1 - (Math.abs(r - mid) + Math.abs(c - mid)) / (2 * mid || 1);
    } else if (board[i] === 2) {
      aStones++;
      const r = Math.floor(i / n);
      const c = i % n;
      aDist += 1 - (Math.abs(r - mid) + Math.abs(c - mid)) / (2 * mid || 1);
    }
  }
  const stones = pStones + aStones;
  if (stones === 0) return { playerInfluence: 0, aiInfluence: 0, contested: 100, totalCells };
  const pShare = pStones / stones;
  const aShare = aStones / stones;
  const pCenter = pStones ? pDist / pStones : 0;
  const aCenter = aStones ? aDist / aStones : 0;
  const pInf = Math.round(100 * (0.6 * pShare + 0.4 * pCenter));
  const aInf = Math.round(100 * (0.6 * aShare + 0.4 * aCenter));
  const contested = Math.max(0, 100 - pInf - aInf);
  return { playerInfluence: pInf, aiInfluence: aInf, contested, totalCells };
}

function buildPlayerBestMoves(
  board: Int8Array,
  n: number,
  winLen: number
): PlayerBestMove[] {
  const cells = classifyBoard(board, n, 1, winLen);
  return [...cells.entries()]
    .filter(([, c]) => c.category > CAT.NONE)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([cell, c]) => ({
      row: Math.floor(cell / n),
      col: cell % n,
      description: describeCategory(c.category, c.isFork),
      isFork: c.isFork,
    }));
}

function buildScoringAnalysis(
  board: Int8Array,
  n: number,
  playerTotal: number,
  aiTotal: number
): ScoringAnalysis {
  const empty = board.length - (board[0] === undefined ? 0 : 0);
  void empty;
  let remaining = 0;
  for (let i = 0; i < board.length; i++) if (board[i] === 0) remaining++;
  const filled = board.length - remaining;
  const fillPct = Math.round((filled / board.length) * 100);
  const halfFilled = Math.max(1, filled / 2);
  const playerPace = playerTotal / halfFilled;
  const aiPace = aiTotal / halfFilled;
  const halfRemaining = remaining / 2;

  const topScoringMoves = [...Array(board.length).keys()]
    .filter((i) => board[i] === 0)
    .map((cell) => {
      const row = Math.floor(cell / n);
      const col = cell % n;
      const delta = scoreMoveDelta(board, n, row, col, 1);
      return { cell, row, col, delta, patterns: scoreMovePatterns(board, n, row, col, 1).join(", ") };
    })
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)
    .map((m) => ({ row: m.row, col: m.col, patterns: m.patterns || "position", points: m.delta }));

  return {
    playerTotal,
    aiTotal,
    diff: playerTotal - aiTotal,
    boardFillPct: fillPct,
    playerPace: Math.round(playerPace * 10) / 10,
    aiPace: Math.round(aiPace * 10) / 10,
    projectedPlayerFinal: Math.round(playerTotal + playerPace * halfRemaining),
    projectedAiFinal: Math.round(aiTotal + aiPace * halfRemaining),
    remainingMoves: remaining,
    topScoringMoves,
  };
}

function assessmentFor(evalScore: number): string {
  const a = Math.abs(evalScore);
  if (a < 5) return "Balanced";
  if (evalScore > 0) return a > 30 ? "You are winning" : "You stand better";
  return a > 30 ? "AI stands better" : "AI slightly better";
}

// ---------------------------------------------------------------------------
// Terminal analysis — decisive truth for finished games. The eval bar must
// never show a neutral 50/50 once the game is over (user-reported bug: a WON
// game displayed 50.0% / 50.0% because the move route returned analysis:null,
// and the UI fell back to its 50% default).
// ---------------------------------------------------------------------------

export function buildTerminalAnalysis(opts: {
  status: "won" | "lost" | "draw";
  winLine: [number, number][] | null;
  board: Int8Array;
  n: number;
  winLen: number;
}): Analysis {
  const { status, winLine, board, n, winLen } = opts;
  const line =
    winLine && winLine.length > 0
      ? winLine.map(([r, c]) => coordOf(r * n + c, n)).join("–")
      : "";
  const outcome = `${winLen} in a row`;

  const base: Analysis = {
    evalScore: 0,
    assessment: "Draw",
    winProb: 50,
    aiWinProb: 50,
    moveQuality: "optimal",
    playerBestMoves: [],
    aiCandidateMoves: [],
    playerThreats: emptyThreats(),
    aiThreats: emptyThreats(),
    criticalSquares: [],
    tempo: { playerInitiative: 5, aiInitiative: 5, urgency: "none" },
    boardControl: buildBoardControl(board, n),
    scoringAnalysis: null,
    aiReasoning: "Board full — the game ends in a draw.",
  };

  if (status === "won") {
    return {
      ...base,
      evalScore: 100,
      assessment: "You win!",
      winProb: 100,
      aiWinProb: 0,
      moveQuality: "optimal",
      tempo: { playerInitiative: 10, aiInitiative: 0, urgency: "none" },
      boardControl: { playerInfluence: 100, aiInfluence: 0, contested: 0, totalCells: n * n },
      aiReasoning: line
        ? `You completed ${outcome} at ${line} — game over.`
        : `You completed ${outcome} — game over.`,
    };
  }
  if (status === "lost") {
    return {
      ...base,
      evalScore: -100,
      assessment: "AI wins",
      winProb: 0,
      aiWinProb: 100,
      moveQuality: "optimal",
      tempo: { playerInitiative: 0, aiInitiative: 10, urgency: "none" },
      boardControl: { playerInfluence: 0, aiInfluence: 100, contested: 0, totalCells: n * n },
      aiReasoning: line
        ? `AI completed ${outcome} at ${line} — game over.`
        : `AI completed ${outcome} — game over.`,
    };
  }
  return base;
}

export function buildAnalysis(opts: {
  board: Int8Array;
  n: number;
  winLen: number;
  mode: "classic" | "scoring";
  mcts: MctsResult;
  playerTotal: number;
  aiTotal: number;
  nnWinProb?: number | null; // 0..1, player-1 perspective, already blended
  /** Cell actually played after the 60/40 NN re-rank (may differ from
   *  mcts.move). Reasoning always names the move that was really played. */
  finalMove?: number;
  /** Extra sentence appended to aiReasoning (NN re-rank outcome). */
  reasoningSuffix?: string;
  /** NN blend outcome, echoed verbatim into the analysis payload. */
  nnReRank?: Analysis["nnReRank"];
  /** NN-scored suggestions for the player's next move (post-AI-move board). */
  nnSuggestions?: NnSuggestion[];
  /** NN service metadata (params / training samples). */
  nnMeta?: { params: number; trainingSamples: number } | null;
}): Analysis {
  const { board, n, winLen, mode, mcts, playerTotal, aiTotal, nnWinProb, finalMove, reasoningSuffix, nnReRank, nnSuggestions, nnMeta } = opts;

  const ev = evaluatePosition(board, n, winLen);

  // Blend: 60% search win-rate + 40% NN prior when available (player-1 persp).
  // Precision: one decimal (user request — "increase the accuracy of the eval bar").
  let aiWinPct = Math.round(mcts.rootWinRate * 1000) / 10;
  if (typeof nnWinProb === "number" && Number.isFinite(nnWinProb)) {
    const blended1 = 0.6 * mcts.rootWinRate + 0.4 * nnWinProb;
    aiWinPct = Math.round((1 - blended1) * 1000) / 10; // AI perspective = 1 - player1
  }

  // Decisive-threat clamps (user: the bar was "confidently wrong" and hovered
  // near 50% even in forced-win positions). Sound, board-derived rules —
  // position has the AI to move:
  //   • AI completes five this move       → AI has essentially won (≥97%).
  //   • Player has ≥2 five-completions    → AI can block only one → player wins.
  //   • Player can create an open four on ≥2 distinct lines and neither side
  //     has an immediate five → unstoppable next turn → player ~wins.
  //   • Mirror for the AI (double open-four creation, softer clamp).
  {
    let playerFiveCells = 0;
    let aiFiveCells = 0;
    let playerOpenFourCreates = 0;
    let aiOpenFourCreates = 0;
    for (const [cell, c] of classifyBoard(board, n, 1, winLen)) {
      if (board[cell] !== 0) continue;
      if (c.category === CAT.WIN) playerFiveCells++;
      else if (c.category === CAT.OPEN_FOUR) playerOpenFourCreates++;
    }
    for (const [cell, c] of classifyBoard(board, n, 2, winLen)) {
      if (board[cell] !== 0) continue;
      if (c.category === CAT.WIN) aiFiveCells++;
      else if (c.category === CAT.OPEN_FOUR) aiOpenFourCreates++;
    }
    if (aiFiveCells > 0) aiWinPct = Math.max(aiWinPct, 97);
    // Player-side clamps only apply while the AI cannot five first.
    if (aiFiveCells === 0) {
      if (playerFiveCells >= 2) aiWinPct = Math.min(aiWinPct, 4);
      else if (playerFiveCells === 1) aiWinPct = Math.min(aiWinPct, 45); // blockable four — AI must answer now
      if (playerFiveCells === 0 && playerOpenFourCreates >= 2)
        aiWinPct = Math.min(aiWinPct, 30); // live open three(s): forcing, but blockable — never "AI winning"
      if (playerOpenFourCreates >= 1 && playerFiveCells === 0 && aiOpenFourCreates === 0)
        aiWinPct = Math.min(aiWinPct, 55); // any live player open three caps AI optimism
    }
    if (aiOpenFourCreates >= 2 && playerFiveCells === 0 && aiFiveCells === 0)
      aiWinPct = Math.max(aiWinPct, 90);
  }

  aiWinPct = Math.max(0, Math.min(100, aiWinPct));
  const playerWinPct = 100 - aiWinPct; // derived — bug #17

  const playerThreats = countThreats(board, n, 1, winLen);
  const aiThreats = countThreats(board, n, 2, winLen);

  const aiCandidateMoves: AiCandidateMove[] = mcts.topChildren.map((c) => ({
    row: c.row,
    col: c.col,
    visits: c.visits,
    winRate: c.winRate,
    raveRate: c.raveRate,
  }));

  const baseReason = REASON_TEXT[mcts.reason] ?? "Building position.";
  const nnPart =
    typeof nnWinProb === "number" && Number.isFinite(nnWinProb)
      ? ` (NN eval: ${(nnWinProb * 100).toFixed(1)}%)`
      : "";
  const playedCell = typeof finalMove === "number" ? finalMove : mcts.move;
  const aiReasoning = `Played ${coordOf(playedCell, n)} — ${baseReason}${nnPart}${reasoningSuffix ?? ""}`;

  const scoringAnalysis =
    mode === "scoring" ? buildScoringAnalysis(board, n, playerTotal, aiTotal) : null;

  let moveQuality: Analysis["moveQuality"] = "optimal";
  if (mcts.reason !== "search") moveQuality = "tactical";
  else if (aiWinPct >= 55) moveQuality = "optimal";
  else if (aiWinPct >= 45) moveQuality = "strong";
  else moveQuality = "alternative";

  return {
    evalScore: ev.display,
    assessment: assessmentFor(ev.display),
    winProb: playerWinPct,
    aiWinProb: aiWinPct,
    moveQuality,
    playerBestMoves:
      mode === "classic" ? buildPlayerBestMoves(board, n, winLen) : scoringAnalysis?.topScoringMoves.map((m) => ({
        row: m.row,
        col: m.col,
        description: `${m.patterns} (+${m.points})`,
      })) ?? [],
    aiCandidateMoves,
    playerThreats,
    aiThreats,
    criticalSquares: buildCriticalSquares(board, n, winLen),
    tempo: buildTempo(playerThreats, aiThreats),
    boardControl: buildBoardControl(board, n),
    scoringAnalysis,
    aiReasoning,
    nnReRank,
    nnSuggestions: nnSuggestions ?? [],
    nnMeta: nnMeta ?? null,
  };
}

function coordOf(cell: number, n: number): string {
  const row = Math.floor(cell / n);
  const col = cell % n;
  const letter = String.fromCharCode(65 + (col >= 8 ? col + 1 : col));
  return `${letter}${n - row}`;
}

/** Per-turn learning telemetry snapshot for the UI. */
export function buildLearningSnapshot(opts: {
  rave: GlobalRAVE;
  mcts: MctsResult;
}): LearningSnapshot {
  const { rave, mcts } = opts;
  const bestChild = mcts.topChildren[0];
  return {
    globalRaveTotalVisits: rave.totalVisits(),
    globalRaveCoverage: Math.round(rave.coverage() * 100) / 100,
    globalRaveBestRate: Math.round(rave.bestRate() * 100) / 100,
    treeReused: mcts.treeReused,
    totalTreeNodes: mcts.totalTreeNodes,
    bestMoveWinRate: bestChild ? Math.round(bestChild.winRate * 100) / 100 : 0,
    priorTreeVisits: mcts.priorTreeVisits,
    raveBeta: Math.round(mcts.raveBeta * 100) / 100,
  };
}

/** Re-export for convenience. */
export { computeFullScore, CAT, CAT_VALUE };
