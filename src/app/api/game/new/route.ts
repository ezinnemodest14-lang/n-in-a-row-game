import { NextResponse } from "next/server";
import { int8ToBoard } from "@/lib/game/types";
import { emptyBoard, legalMoves, runMCTS } from "@/lib/game/mcts";
import { loadRave } from "@/lib/game/engine-runtime";
import type { GameMode, GameStatePayload, ScoreState } from "@/lib/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emptyScore(): ScoreState {
  return { total: 0, breakdown: { fives: 0, fours: 0, triples: 0 } };
}

function baseState(
  board: number[][],
  boardSize: number,
  winLength: number,
  gameMode: GameMode,
  currentPlayer: number,
  status: GameStatePayload["status"]
): GameStatePayload {
  return {
    board,
    boardSize,
    winLength,
    gameMode,
    currentPlayer,
    playerPiece: 1,
    aiPiece: 2,
    status,
    winner: null,
    winLine: null,
    lastMove: null,
    aiFirstMove: null,
    moveHistory: [],
    playerScore: emptyScore(),
    aiScore: emptyScore(),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      boardSize?: number;
      winLength?: number;
      gameMode?: GameMode;
      playerFirst?: boolean;
    };

    const boardSize = Math.max(3, Math.min(24, Math.floor(body.boardSize ?? 15)));
    const gameMode: GameMode = body.gameMode === "scoring" ? "scoring" : "classic";
    const winLength =
      gameMode === "scoring"
        ? Math.max(3, Math.floor(body.winLength ?? 5))
        : Math.max(3, Math.min(boardSize, Math.floor(body.winLength ?? 5)));
    const playerFirst = body.playerFirst !== false;

    const { rave, inherited, priorVisits } = await loadRave(boardSize, gameMode);

    const flat = emptyBoard(boardSize);
    let currentPlayer = playerFirst ? 1 : 2;
    let aiFirstMove: [number, number] | null = null;

    // AI opens when the player chose to go second.
    if (!playerFirst) {
      const res = runMCTS({
        board: flat,
        n: boardSize,
        winLen: winLength,
        mode: gameMode,
        aiPlayer: 2,
        simulations: 300,
        timeLimitMs: 500,
        globalRave: rave,
        seed: (Date.now() ^ (boardSize * 2654435761)) >>> 0,
      });
      if (legalMoves(flat).length > 0 && flat[res.move] === 0) {
        flat[res.move] = 2;
        aiFirstMove = [Math.floor(res.move / boardSize), res.move % boardSize];
      }
      currentPlayer = 1;
    }

    const board = int8ToBoard(flat, boardSize);
    const state = baseState(
      board,
      boardSize,
      winLength,
      gameMode,
      currentPlayer,
      currentPlayer === 1 ? "playing" : "idle"
    );
    state.aiFirstMove = aiFirstMove;

    return NextResponse.json({
      ok: true,
      state,
      crossGameLearning: { inherited, priorVisits },
      raveVisits: rave.totalVisits(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "New game failed" },
      { status: 500 }
    );
  }
}
