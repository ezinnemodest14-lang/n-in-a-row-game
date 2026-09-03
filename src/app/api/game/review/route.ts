// ============================================================================
// POST /api/game/review — NN game review (the "Game Review" panel).
//
// Replays the entire game move-by-move and produces a chess.com-style review:
//   • a win-probability curve (player perspective) AFTER every move,
//   • a per-move grade (brilliant / great / good / inaccuracy / mistake /
//     blunder) combining NN eval swings with HARD tactical facts from the
//     threat classifier (missed wins, missed forced blocks, allowed open
//     fours — these override the raw swing so the review never misses a
//     blunder the NN itself is blind to),
//   • per-side accuracy and human-readable takeaways.
//
// Every position is scored by the NEURAL NET in a single /predict-batch call
// (feature-extraction + MLP forward per position, ~1ms each). If the NN
// service is unavailable the heuristic evaluator takes over and `usedNn` is
// reported as false — the review degrades, it never fails.
// ============================================================================

import { NextResponse } from "next/server";
import {
  CAT,
  checkWinAt,
  cloneBoard,
  classifyBoard,
  coordLabel,
  evaluatePosition,
} from "@/lib/game/threat-classifier";
import { int8ToBoard } from "@/lib/game/types";
import { nnEvaluateBatch } from "@/lib/neural-client";
import type {
  GameReviewData,
  GameReviewMove,
  MoveRecord,
  ReviewGrade,
} from "@/lib/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ReviewBody {
  moveHistory?: MoveRecord[];
  boardSize?: number;
  winLength?: number;
  gameMode?: string;
  playerPiece?: number;
  aiPiece?: number;
}

interface ReplayMove {
  row: number;
  col: number;
  player: number;
  cell: number;
}

/** Heuristic fallback: logistic mapping of the signed display eval → 0..100. */
function heuristicWinProb(board: Int8Array, n: number, winLen: number): number {
  const { display } = evaluatePosition(board, n, winLen);
  const wp = 100 / (1 + Math.exp(-display / 12));
  return Math.max(1, Math.min(99, wp));
}

function gradeLabel(delta: number): { grade: ReviewGrade; headline: string } {
  if (delta >= 5) return { grade: "great", headline: "Strong move — swings the game your way" };
  if (delta >= -4) return { grade: "good", headline: "Solid move — keeps the position sound" };
  if (delta >= -12) return { grade: "inaccuracy", headline: "Inaccuracy — the evaluation slips" };
  if (delta >= -25) return { grade: "mistake", headline: "Mistake — a serious drop in evaluation" };
  return { grade: "blunder", headline: "Blunder — the evaluation collapses" };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReviewBody;
    const n = Math.max(3, Math.min(24, Math.floor(body.boardSize ?? 15)));
    const winLen = Math.max(3, Math.min(n, Math.floor(body.winLength ?? 5)));
    const playerPiece = body.playerPiece === 2 ? 2 : 1;
    const aiPiece = playerPiece === 1 ? 2 : 1;

    // ---- sanitize the move list ----
    const raw = Array.isArray(body.moveHistory) ? body.moveHistory.slice(0, n * n) : [];
    const moves: ReplayMove[] = [];
    for (const m of raw) {
      if (!m || typeof m !== "object") continue;
      const r = (m as { row?: unknown }).row;
      const c = (m as { col?: unknown }).col;
      const p = (m as { player?: unknown }).player;
      if (
        typeof r !== "number" || typeof c !== "number" || typeof p !== "number" ||
        !Number.isInteger(r) || !Number.isInteger(c) ||
        r < 0 || c < 0 || r >= n || c >= n || (p !== 1 && p !== 2)
      ) continue;
      moves.push({ row: r, col: c, player: p, cell: r * n + c });
    }
    if (moves.length === 0) {
      return NextResponse.json({ ok: false, error: "No moves to review" }, { status: 400 });
    }
    // Reject moves onto occupied cells (corrupt history).
    const replayBoard = new Int8Array(n * n);
    for (const m of moves) {
      if (replayBoard[m.cell] !== 0) {
        return NextResponse.json({ ok: false, error: "Move history is corrupt" }, { status: 400 });
      }
      replayBoard[m.cell] = m.player;
    }

    // ---- rebuild every position (index 0 = empty board) ----
    const boards: Int8Array[] = [new Int8Array(n * n)];
    for (let i = 0; i < moves.length; i++) {
      const b = cloneBoard(boards[i]);
      b[moves[i].cell] = moves[i].player;
      boards.push(b);
    }

    // ---- evaluate every position (NN batch first, heuristic fallback) ----
    const nnProbs = await nnEvaluateBatch(
      boards.map((b) => int8ToBoard(b, n)),
      n,
      6000
    );
    const usedNn = nnProbs !== null;
    const winProbs: number[] = boards.map((b, i) => {
      const wp1 = usedNn ? (nnProbs as number[])[i] : heuristicWinProb(b, n, winLen) / 100;
      // Convert player-1 perspective → this game's human-player perspective.
      let playerPersp = playerPiece === 1 ? wp1 : 1 - wp1;
      // Trust ramp: the NN's prior on nearly-empty boards is noisy (an empty
      // board is genuinely 50/50). Blend toward 50% until ~8 stones are down.
      const trust = Math.min(1, i / 8);
      playerPersp = 0.5 + (playerPersp - 0.5) * trust;
      return Math.round(playerPersp * 1000) / 10;
    });

    // Terminal truth for the final point (the NN cannot see a raw win line).
    const last = moves[moves.length - 1];
    const lastBoard = boards[boards.length - 1];
    const gameWon = checkWinAt(lastBoard, n, winLen, last.row, last.col, last.player);
    const boardFull = lastBoard.every((v) => v !== 0);
    if (gameWon) {
      winProbs[winProbs.length - 1] = last.player === playerPiece ? 100 : 0;
    } else if (boardFull) {
      winProbs[winProbs.length - 1] = 50;
    }

    // ---- grade every move ----
    const reviewMoves: GameReviewMove[] = [];
    const blankGrades = (): Record<ReviewGrade, number> => ({
      brilliant: 0, great: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0,
    });
    const playerGrades = blankGrades();
    const aiGrades = blankGrades();
    let playerAccSum = 0;
    let playerAccCount = 0;
    let aiAccSum = 0;
    let aiAccCount = 0;
    let biggestSwing: { moveNo: number; delta: number; player: number } | null = null;

    for (let i = 0; i < moves.length; i++) {
      const mv = moves[i];
      const before = winProbs[i];
      const after = winProbs[i + 1];
      const isPlayerMove = mv.player === playerPiece;
      // Eval swing from the MOVER's perspective.
      const delta = isPlayerMove
        ? Math.round((after - before) * 10) / 10
        : Math.round((before - after) * 10) / 10;

      const opp = isPlayerMove ? aiPiece : playerPiece;
      const coord = coordLabel(mv.row, mv.col, n);

      let graded = gradeLabel(delta);

      // Hard tactical facts override the raw swing (board BEFORE the move).
      const preBoard = boards[i];
      const moverCells = classifyBoard(preBoard, n, mv.player, winLen);
      const oppCells = classifyBoard(preBoard, n, opp, winLen);
      const moverWinCells = [...moverCells.entries()].filter(([, c]) => c.category === CAT.WIN).map(([cell]) => cell);
      const oppWinCells = [...oppCells.entries()].filter(([, c]) => c.category === CAT.WIN).map(([cell]) => cell);
      const tookWin = moverWinCells.includes(mv.cell);
      const blockedWin = oppWinCells.includes(mv.cell);

      if (tookWin) {
        graded = { grade: "brilliant", headline: `Takes the win — ${winLen} in a row at ${coord}` };
      } else if (moverWinCells.length > 0) {
        graded = {
          grade: "blunder",
          headline: `Missed the winning move at ${coordLabel(Math.floor(moverWinCells[0] / n), moverWinCells[0] % n, n)}`,
        };
      } else if (oppWinCells.length > 0 && !blockedWin) {
        graded = {
          grade: "blunder",
          headline: `Missed the forced block at ${coordLabel(Math.floor(oppWinCells[0] / n), oppWinCells[0] % n, n)}`,
        };
      } else {
        // Allowed an open four without having a forcing reply? → mistake.
        const postBoard = boards[i + 1];
        const oppOpenFourCells = [...classifyBoard(postBoard, n, opp, winLen).entries()]
          .filter(([, c]) => c.category === CAT.OPEN_FOUR).map(([cell]) => cell);
        const moverForcingCells = [...classifyBoard(postBoard, n, mv.player, winLen).entries()]
          .filter(([, c]) => c.category >= CAT.SIMPLE_FOUR).length;
        if (oppOpenFourCells.length > 0 && moverForcingCells === 0) {
          graded = {
            grade: "mistake",
            headline: `Allows an open four — ${isPlayerMove ? "you lose" : "the AI loses"} the initiative`,
          };
        }
      }

      if (isPlayerMove) {
        playerGrades[graded.grade] = (playerGrades[graded.grade] ?? 0) + 1;
        playerAccSum += 100 * Math.exp(-Math.max(0, -delta) / 20);
        playerAccCount++;
      } else {
        aiGrades[graded.grade] = (aiGrades[graded.grade] ?? 0) + 1;
        aiAccSum += 100 * Math.exp(-Math.max(0, -delta) / 20);
        aiAccCount++;
      }
      if (!biggestSwing || delta < biggestSwing.delta) {
        biggestSwing = { moveNo: i + 1, delta, player: mv.player };
      }

      reviewMoves.push({
        moveNo: i + 1,
        player: mv.player,
        row: mv.row,
        col: mv.col,
        coord,
        grade: graded.grade,
        delta,
        winProbBefore: before,
        winProbAfter: after,
        headline: graded.headline,
      });
    }

    const accuracy = {
      player: playerAccCount > 0 ? Math.round((playerAccSum / playerAccCount) * 10) / 10 : 100,
      ai: aiAccCount > 0 ? Math.round((aiAccSum / aiAccCount) * 10) / 10 : 100,
    };

    // ---- takeaways ----
    const summary: string[] = [];
    const pBlunders = playerGrades.blunder ?? 0;
    const pMistakes = playerGrades.mistake ?? 0;
    const aBlunders = aiGrades.blunder ?? 0;
    if (pBlunders + pMistakes === 0 && accuracy.player >= 90) {
      summary.push("Clean game — the NN found no mistakes or blunders in your play.");
    } else if (pBlunders > 0) {
      summary.push(`The NN flagged ${pBlunders} blunder${pBlunders > 1 ? "s" : ""} in your game — check the red entries.`);
    }
    if (pMistakes > 0 && pBlunders === 0) {
      summary.push(`${pMistakes} mistake${pMistakes > 1 ? "s" : ""} — moments where a stronger move was available.`);
    }
    if (aBlunders > 0) {
      summary.push(`The AI made ${aBlunders} blunder${aBlunders > 1 ? "s" : ""} — winning chances were offered.`);
    }
    if (biggestSwing) {
      const who = biggestSwing.player === playerPiece ? "Your" : "The AI's";
      const dir = biggestSwing.delta <= -12 ? "costliest" : "sharpest";
      summary.push(`${who} ${dir} moment was move #${biggestSwing.moveNo} (${biggestSwing.delta >= 0 ? "+" : ""}${biggestSwing.delta.toFixed(1)}%).`);
    }
    const finalProb = winProbs[winProbs.length - 1];
    if (gameWon) {
      summary.push(last.player === playerPiece
        ? "Final position: you completed the winning line — confirmed by the review."
        : "Final position: the AI completed its line — the review confirms the result.");
    } else {
      summary.push(`Final evaluation: ${finalProb >= 50 ? "you" : "the AI"} stood better at ${(finalProb >= 50 ? finalProb : 100 - finalProb).toFixed(1)}%.`);
    }
    if (!usedNn) summary.push("Neural net unavailable — review produced with the heuristic evaluator.");

    const review: GameReviewData = {
      usedNn,
      accuracy,
      grades: { player: playerGrades, ai: aiGrades },
      points: winProbs.map((wp, i) => ({ move: i, winProb: wp })),
      moves: reviewMoves,
      summary,
    };

    return NextResponse.json({ ok: true, review });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Review failed" },
      { status: 500 }
    );
  }
}
