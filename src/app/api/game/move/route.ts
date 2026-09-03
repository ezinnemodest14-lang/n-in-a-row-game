// ============================================================================
// POST /api/game/move
// Applies the player's move (or an auto move for the current player), then
// runs the AI turn: tactical safety net → MCTS+RAVE → NN blend → analysis.
// Analysis is built from the EXACT board the search ran against.
// ============================================================================

import { NextResponse } from "next/server";
import { boardToInt8, int8ToBoard } from "@/lib/game/types";
import { cloneBoard, findWinLine, legalMoves, runMCTS, checkWinAt, ensureSafeMove } from "@/lib/game/mcts";
import { REASON_TEXT } from "@/lib/game/threat-classifier";
import { scoreMoveDelta, computeFullScore, scoreBreakdown } from "@/lib/game/scoring";
import { buildAnalysis, buildLearningSnapshot, buildTerminalAnalysis } from "@/lib/game/analyzer";
import { loadRave, saveRave } from "@/lib/game/engine-runtime";
import { nnEvaluate, nnHealth } from "@/lib/neural-client";
import type { Analysis, GameMode, GameStatePayload, ScoreState } from "@/lib/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface MoveBody {
  board?: number[][];
  boardSize?: number;
  winLength?: number;
  gameMode?: GameMode;
  playerPiece?: number;
  aiPiece?: number;
  row?: number;
  col?: number;
  auto?: boolean;
  simulations?: number;
  /** Prior history so the move counter / timeline spans the whole game,
   *  not just the current request. Sanitized below — board is authoritative. */
  moveHistory?: GameStatePayload["moveHistory"];
  /** Prior Score-Attack totals (same rationale as moveHistory). */
  playerScore?: ScoreState;
  aiScore?: ScoreState;
}

function emptyScore(): ScoreState {
  return { total: 0, breakdown: { fives: 0, fours: 0, triples: 0 } };
}

/** Validate a client-supplied ScoreState; fall back to empty. */
function sanitizeScore(v: unknown): ScoreState {
  if (!v || typeof v !== "object") return emptyScore();
  const o = v as { total?: unknown; breakdown?: { fives?: unknown; fours?: unknown; triples?: unknown } };
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  return {
    total: num(o.total),
    breakdown: { fives: num(o.breakdown?.fives), fours: num(o.breakdown?.fours), triples: num(o.breakdown?.triples) },
  };
}

function applyScoreDelta(prev: ScoreState, delta: number): ScoreState {
  const breakdown = { ...prev.breakdown };
  if (delta >= 15) breakdown.fives += 1;
  else if (delta >= 5) breakdown.fours += 1;
  else if (delta >= 1) breakdown.triples += 1;
  return { total: prev.total + delta, breakdown };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as MoveBody;

    const boardSize = Math.max(3, Math.min(24, Math.floor(body.boardSize ?? 15)));
    const gameMode: GameMode = body.gameMode === "scoring" ? "scoring" : "classic";
    const winLength = Math.max(3, Math.min(boardSize, Math.floor(body.winLength ?? 5)));
    const playerPiece = body.playerPiece === 2 ? 2 : 1;
    const aiPiece = playerPiece === 1 ? 2 : 1;
    const simulations = Math.max(100, Math.min(50000, Math.floor(body.simulations ?? 3000)));

    if (!Array.isArray(body.board) || body.board.length !== boardSize) {
      return NextResponse.json({ ok: false, error: "Invalid board" }, { status: 400 });
    }
    let flat = boardToInt8(body.board);

    const { rave } = await loadRave(boardSize, gameMode);

    // ------------------------------------------------------------------
    // 1) Apply the incoming move (explicit cell, or auto-pick for current
    //    player in Auto Mode).
    // ------------------------------------------------------------------
    const isAuto = body.auto === true;
    let mover: number;
    let moveCell: number;

    if (isAuto) {
      // Board holds the position; the current player is whoever's turn it is.
      const stones = flat.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0);
      if (stones === 0) mover = 1;
      else {
        // Infer from counts: 1 moves when counts equal, else 2.
        const c1 = flat.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
        const c2 = stones - c1;
        mover = c1 === c2 ? 1 : 2;
      }
      const autoRes = runMCTS({
        board: flat,
        n: boardSize,
        winLen: winLength,
        mode: gameMode,
        aiPlayer: mover,
        simulations: Math.min(simulations, 2000),
        timeLimitMs: 1200,
        globalRave: rave,
        seed: (Date.now() ^ 0x9e3779b9) >>> 0,
        movePath: [],
      });
      moveCell = autoRes.move;
    } else {
      if (
        typeof body.row !== "number" ||
        typeof body.col !== "number" ||
        body.row < 0 ||
        body.col < 0 ||
        body.row >= boardSize ||
        body.col >= boardSize
      ) {
        return NextResponse.json({ ok: false, error: "Invalid move" }, { status: 400 });
      }
      mover = playerPiece;
      moveCell = body.row * boardSize + body.col;
    }

    if (flat[moveCell] !== 0) {
      return NextResponse.json({ ok: false, error: "Cell occupied" }, { status: 400 });
    }

    // Seed history from the client (sanitized — the board itself stays the
    // source of truth for win/score logic).
    const moveHistory: GameStatePayload["moveHistory"] = [];
    if (Array.isArray(body.moveHistory)) {
      for (const m of body.moveHistory.slice(-boardSize * boardSize)) {
        if (!m || typeof m !== "object") continue;
        const r = (m as { row?: unknown }).row;
        const c = (m as { col?: unknown }).col;
        const p = (m as { player?: unknown }).player;
        const ps = (m as { pointsScored?: unknown }).pointsScored;
        if (typeof r !== "number" || typeof c !== "number" || typeof p !== "number") continue;
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= boardSize || c >= boardSize) continue;
        if (p !== 1 && p !== 2) continue;
        moveHistory.push({ row: r, col: c, player: p, pointsScored: typeof ps === "number" ? ps : null });
      }
    }
    let playerScore = sanitizeScore(body.playerScore);
    let aiScore = sanitizeScore(body.aiScore);

    flat[moveCell] = mover;
    let moverDelta = 0;
    if (gameMode === "scoring") {
      moverDelta = scoreMoveDelta(flat, boardSize, Math.floor(moveCell / boardSize), moveCell % boardSize, mover);
      if (mover === 1) playerScore = applyScoreDelta(playerScore, moverDelta);
      else aiScore = applyScoreDelta(aiScore, moverDelta);
    }
    moveHistory.push({ row: Math.floor(moveCell / boardSize), col: moveCell % boardSize, player: mover, pointsScored: gameMode === "scoring" ? moverDelta : null });

    // Win / draw check for the mover.
    let status: GameStatePayload["status"] = "playing";
    let winner: number | null = null;
    let winLine: [number, number][] | null = null;

    if (gameMode === "classic" && checkWinAt(flat, boardSize, winLength, Math.floor(moveCell / boardSize), moveCell % boardSize, mover)) {
      status = mover === playerPiece ? "won" : "lost";
      winner = mover;
      winLine = findWinLine(flat, boardSize, winLength, Math.floor(moveCell / boardSize), moveCell % boardSize, mover);
    } else if (legalMoves(flat).length === 0) {
      if (gameMode === "classic") {
        status = "draw";
      } else {
        const totals = computeFullScore(flat, boardSize);
        if (totals[1] === totals[2]) status = "draw";
        else {
          const winnerSide = totals[1] > totals[2] ? playerPiece : aiPiece;
          status = winnerSide === playerPiece ? "won" : "lost";
          winner = winnerSide;
        }
      }
    }

    // If the game ended with the mover's move, return immediately (no AI turn).
    if (status !== "playing") {
      if (gameMode === "scoring") {
        const bd = scoreBreakdown(flat, boardSize);
        playerScore.breakdown = { fives: Math.ceil(bd.fives / 2), fours: Math.ceil(bd.fours / 2), triples: Math.ceil(bd.triples / 2) };
        aiScore.breakdown = { fives: bd.fives - Math.ceil(bd.fives / 2), fours: bd.fours - Math.ceil(bd.fours / 2), triples: bd.triples - Math.ceil(bd.triples / 2) };
      }
      const state = buildState(flat, boardSize, winLength, gameMode, playerPiece, aiPiece, status, winner, winLine, moveHistory, playerScore, aiScore, [Math.floor(moveCell / boardSize), moveCell % boardSize], null);
      // Game over on the mover's move — return a DECISIVE terminal analysis.
      // (Returning null here made the eval bar show a neutral 50/50 after a
      // won game — user-reported bug.)
      const terminalAnalysis = buildTerminalAnalysis({ status, winLine, board: flat, n: boardSize, winLen: winLength });
      return NextResponse.json({ ok: true, state, analysis: terminalAnalysis, lastStats: null, lastLearning: null });
    }

    // ------------------------------------------------------------------
    // 2) AI turn — snapshot the exact position the search runs against.
    // ------------------------------------------------------------------
    const boardBefore = cloneBoard(flat);
    const playerScoreBefore = playerScore.total;
    const aiScoreBefore = aiScore.total;

    // NN evaluation of the pre-AI-move position (player-1 perspective).
    const nnUp = await nnHealth(600);
    const nn = nnUp ? await nnEvaluate(int8ToBoard(boardBefore, boardSize), boardSize, 1500) : null;

    const res = runMCTS({
      board: boardBefore,
      n: boardSize,
      winLen: winLength,
      mode: gameMode,
      aiPlayer: aiPiece,
      simulations,
      timeLimitMs: Math.max(600, Math.min(3000, simulations / 2)),
      globalRave: rave,
      seed: (Date.now() ^ (boardSize * 2654435761)) >>> 0,
      // Tree reuse: when the human just moved normally, the cached tree root
      // corresponds to the position after the AI's previous move — the only
      // difference is the player's new stone.
      movePath: !isAuto && mover === playerPiece ? [moveCell] : [],
    });

    // ------------------------------------------------------------------
    // 2b) Neural-net blend — the NN genuinely influences move selection.
    // Top MCTS root candidates are re-scored as 0.6·search + 0.4·NN and the
    // best blended score wins. Tactical overrides (forced wins / blocks)
    // always stand: re-ranking only runs when the search itself chose the
    // move (reason === "search"). Graceful fallback: any NN failure keeps
    // the pure MCTS pick.
    // ------------------------------------------------------------------
    let aiCell = res.move;
    let nnReRank: Analysis["nnReRank"];
    let reasoningSuffix = "";
    if (nn && res.reason === "search" && res.topChildren.length >= 2) {
      const coord = (cell: number) => {
        const r = Math.floor(cell / boardSize);
        const c = cell % boardSize;
        const letter = String.fromCharCode(65 + (c >= 8 ? c + 1 : c));
        return `${letter}${r + 1}`;
      };
      const blend: { cell: number; score: number; nnAi: number }[] = [];
      for (const cand of res.topChildren) {
        if (boardBefore[cand.cell] !== 0) continue;
        const after = cloneBoard(boardBefore);
        after[cand.cell] = aiPiece;
        const pred = await nnEvaluate(int8ToBoard(after, boardSize), boardSize, 900);
        if (!pred) continue;
        const nnAi = aiPiece === 1 ? pred.winProb1 : 1 - pred.winProb1; // AI perspective
        blend.push({ cell: cand.cell, score: 0.6 * cand.winRate + 0.4 * nnAi, nnAi });
      }
      if (blend.length >= 2) {
        blend.sort((a, b) => b.score - a.score);
        const best = blend[0];
        if (best.cell !== aiCell) {
          nnReRank = { agreed: false, from: coord(res.move), to: coord(best.cell), candidates: blend.length };
          reasoningSuffix = ` — NN blend (60/40) re-ranked the top ${blend.length}: ${nnReRank.to} over ${nnReRank.from}`;
          aiCell = best.cell;
        } else {
          nnReRank = { agreed: true, to: coord(best.cell), candidates: blend.length };
        }
      }
    }

    // ------------------------------------------------------------------
    // 2c) Final safety guarantee — the NN blend (or any earlier stage) can
    // never ship a move that leaves the player an unstoppable four. If this
    // overrides the blended pick, say so in the reasoning.
    // ------------------------------------------------------------------
    const coordLabelFor = (cell: number) => {
      const r = Math.floor(cell / boardSize);
      const c = cell % boardSize;
      const letter = String.fromCharCode(65 + (c >= 8 ? c + 1 : c));
      return `${letter}${boardSize - r}`;
    };
    const safety = ensureSafeMove(
      boardBefore,
      boardSize,
      winLength,
      aiPiece,
      playerPiece,
      aiCell,
      res.topChildren.map((t) => t.cell)
    );
    if (safety.cell !== aiCell) {
      reasoningSuffix += ` — safety override: ${coordLabelFor(aiCell)} would have allowed a forcing ${
        safety.danger >= 95 ? "(losing)" : ""
      } threat; ${coordLabelFor(safety.cell)} played instead (${REASON_TEXT[safety.reason] ?? "forced reply"}).`;
      aiCell = safety.cell;
    }

    if (flat[aiCell] !== 0) {
      const lm = legalMoves(flat);
      if (!lm.length) {
        const state = buildState(flat, boardSize, winLength, gameMode, playerPiece, aiPiece, "draw", null, null, moveHistory, playerScore, aiScore, [Math.floor(moveCell / boardSize), moveCell % boardSize], null);
        const terminalDraw = buildTerminalAnalysis({ status: "draw", winLine: null, board: flat, n: boardSize, winLen: winLength });
        return NextResponse.json({ ok: true, state, analysis: terminalDraw, lastStats: null, lastLearning: null });
      }
    }
    flat[aiCell] = aiPiece;

    let aiDelta = 0;
    if (gameMode === "scoring") {
      aiDelta = scoreMoveDelta(flat, boardSize, Math.floor(aiCell / boardSize), aiCell % boardSize, aiPiece);
      aiScore = applyScoreDelta(aiScore, aiDelta);
    }
    moveHistory.push({ row: Math.floor(aiCell / boardSize), col: aiCell % boardSize, player: aiPiece, pointsScored: gameMode === "scoring" ? aiDelta : null });

    // Win / draw check for the AI.
    if (gameMode === "classic" && checkWinAt(flat, boardSize, winLength, Math.floor(aiCell / boardSize), aiCell % boardSize, aiPiece)) {
      status = "lost";
      winner = aiPiece;
      winLine = findWinLine(flat, boardSize, winLength, Math.floor(aiCell / boardSize), aiCell % boardSize, aiPiece);
    } else if (legalMoves(flat).length === 0) {
      if (gameMode === "classic") {
        status = "draw";
      } else {
        const totals = computeFullScore(flat, boardSize);
        if (totals[1] === totals[2]) status = "draw";
        else {
          const winnerSide = totals[1] > totals[2] ? playerPiece : aiPiece;
          status = winnerSide === playerPiece ? "won" : "lost";
          winner = winnerSide;
        }
      }
    }

    // AI's move ended the game — return the DECISIVE terminal analysis
    // instead of a pre-terminal evaluation of the position before the
    // winning move (which understated the result).
    if (status !== "playing") {
      const state = buildState(flat, boardSize, winLength, gameMode, playerPiece, aiPiece, status, winner, winLine, moveHistory, playerScore, aiScore, [Math.floor(aiCell / boardSize), aiCell % boardSize], null);
      const terminalAnalysis = buildTerminalAnalysis({ status, winLine, board: flat, n: boardSize, winLen: winLength });
      return NextResponse.json({ ok: true, state, analysis: terminalAnalysis, lastStats: null, lastLearning: null });
    }

    // ------------------------------------------------------------------
    // 3) Analysis + learning telemetry (from the pre-AI-move position).
    // ------------------------------------------------------------------
    const analysis = buildAnalysis({
      board: boardBefore,
      n: boardSize,
      winLen: winLength,
      mode: gameMode,
      mcts: res,
      playerTotal: playerScoreBefore,
      aiTotal: aiScoreBefore,
      nnWinProb: nn?.winProb1 ?? null,
      finalMove: aiCell,
      reasoningSuffix,
      nnReRank,
    });
    const lastLearning = buildLearningSnapshot({ rave, mcts: res });
    const lastStats = {
      simulations: res.simulations,
      thinkTimeMs: res.elapsedMs,
      nodesExpanded: res.nodesExpanded,
      totalVisits: res.totalVisits,
      raveBeta: res.raveBeta,
      rootWinRate: res.rootWinRate,
    };

    // Persist learning (best-effort).
    void saveRave(boardSize, gameMode, rave);

    const state = buildState(
      flat,
      boardSize,
      winLength,
      gameMode,
      playerPiece,
      aiPiece,
      status,
      winner,
      winLine,
      moveHistory,
      playerScore,
      aiScore,
      [Math.floor(aiCell / boardSize), aiCell % boardSize],
      null
    );

    return NextResponse.json({
      ok: true,
      state,
      analysis,
      lastStats,
      lastLearning,
      crossGameLearning: { inherited: rave.totalVisits() > 0, priorVisits: rave.totalVisits() },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Move failed" },
      { status: 500 }
    );
  }
}

function buildState(
  flat: Int8Array,
  boardSize: number,
  winLength: number,
  gameMode: GameMode,
  playerPiece: number,
  aiPiece: number,
  status: GameStatePayload["status"],
  winner: number | null,
  winLine: [number, number][] | null,
  moveHistory: GameStatePayload["moveHistory"],
  playerScore: ScoreState,
  aiScore: ScoreState,
  lastMove: [number, number] | null,
  _aiFirstMove: [number, number] | null
): GameStatePayload {
  const stones = flat.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0);
  const c1 = flat.reduce((a, v) => a + (v === playerPiece ? 1 : 0), 0);
  const c2 = stones - c1;
  const currentPlayer =
    status !== "playing" ? playerPiece : c1 === c2 ? playerPiece : aiPiece;
  return {
    board: int8ToBoard(flat, boardSize),
    boardSize,
    winLength,
    gameMode,
    currentPlayer,
    playerPiece,
    aiPiece,
    status,
    winner,
    winLine,
    lastMove,
    aiFirstMove: null,
    moveHistory,
    playerScore,
    aiScore,
  };
}
