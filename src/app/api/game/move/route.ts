// ============================================================================
// POST /api/game/move
// Applies the player's move (or an auto move for the current player), then
// runs the AI turn: tactical safety net → MCTS+RAVE → NN blend → analysis.
// Analysis is built from the EXACT board the search ran against.
// ============================================================================

import { NextResponse } from "next/server";
import { boardToInt8, int8ToBoard } from "@/lib/game/types";
import { cloneBoard, findWinLine, legalMoves, runMCTS, checkWinAt } from "@/lib/game/mcts";
import { scoreMoveDelta, computeFullScore, scoreBreakdown } from "@/lib/game/scoring";
import { buildAnalysis, buildLearningSnapshot } from "@/lib/game/analyzer";
import { loadRave, saveRave } from "@/lib/game/engine-runtime";
import { nnEvaluate, nnHealth } from "@/lib/neural-client";
import type { GameMode, GameStatePayload, ScoreState } from "@/lib/game/types";

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
}

function emptyScore(): ScoreState {
  return { total: 0, breakdown: { fives: 0, fours: 0, triples: 0 } };
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

    const moveHistory: GameStatePayload["moveHistory"] = [];
    const playerScore = emptyScore();
    const aiScore = emptyScore();

    flat[moveCell] = mover;
    let moverDelta = 0;
    if (gameMode === "scoring") {
      moverDelta = scoreMoveDelta(flat, boardSize, Math.floor(moveCell / boardSize), moveCell % boardSize, mover);
      if (mover === 1) playerScore.total += moverDelta;
      else aiScore.total += moverDelta;
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
      return NextResponse.json({ ok: true, state, analysis: null, lastStats: null, lastLearning: null });
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

    const aiCell = res.move;
    if (flat[aiCell] !== 0) {
      const lm = legalMoves(flat);
      if (!lm.length) {
        const state = buildState(flat, boardSize, winLength, gameMode, playerPiece, aiPiece, "draw", null, null, moveHistory, playerScore, aiScore, [Math.floor(moveCell / boardSize), moveCell % boardSize], null);
        return NextResponse.json({ ok: true, state, analysis: null, lastStats: null, lastLearning: null });
      }
    }
    flat[aiCell] = aiPiece;

    let aiDelta = 0;
    if (gameMode === "scoring") {
      aiDelta = scoreMoveDelta(flat, boardSize, Math.floor(aiCell / boardSize), aiCell % boardSize, aiPiece);
      aiScore.total += aiDelta;
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
