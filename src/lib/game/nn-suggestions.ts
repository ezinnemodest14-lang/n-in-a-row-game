// ============================================================================
// NN-aided move suggestions for the HUMAN player.
//
// Called right after the AI's move, when it is the player's turn again:
//   1. Candidate cells come from the threat classifier (all tactically
//      meaningful empty cells for the player), topped up with adjacent
//      positional cells when the position is quiet.
//   2. Each candidate is SIMULATED (stone placed) and the resulting position
//      is scored by the neural net — the number shown to the user is the
//      PLAYER's win probability according to the network, so the side panel
//      can rank suggestions by genuine NN judgment rather than heuristics.
//   3. The classifier supplies the human-readable tag ("Open three — …"),
//      and we flag whether the NN's #1 pick is also the classifier's top
//      tactical cell (`tactical` — engine and net agreeing is a strong signal).
//
// Failure mode: if the NN service cannot be reached, suggestions are simply
// empty and the UI falls back to the threat-classifier list.
// ============================================================================

import {
  CAT,
  classifyBoard,
  cloneBoard,
  describeCategory,
  legalMoves,
} from "./threat-classifier";
import { int8ToBoard } from "./types";
import type { NnSuggestion } from "./types";
import { nnEvaluate, nnMeta } from "@/lib/neural-client";

const MAX_CANDIDATES = 7;
const MAX_SUGGESTIONS = 4;

/** Empty cells that touch an occupied cell (8-neighborhood), center-first. */
function positionalCandidates(board: Int8Array, n: number): number[] {
  const out: number[] = [];
  const mid = (n - 1) / 2;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) continue;
    const r = Math.floor(i / n);
    const c = i % n;
    let neighbor = false;
    for (let dr = -1; dr <= 1 && !neighbor; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr * n + cc] !== 0) {
          neighbor = true;
          break;
        }
      }
    }
    if (neighbor) out.push(i);
  }
  // Center-first ordering for stable, sensible top-ups.
  out.sort((a, b) => {
    const da = Math.abs(Math.floor(a / n) - mid) + Math.abs((a % n) - mid);
    const db = Math.abs(Math.floor(b / n) - mid) + Math.abs((b % n) - mid);
    return da - db;
  });
  return out;
}

export async function buildNnSuggestions(opts: {
  board: Int8Array;
  n: number;
  winLen: number;
  playerPiece: number;
  aiPiece: number;
}): Promise<{
  suggestions: NnSuggestion[];
  meta: { params: number; trainingSamples: number } | null;
}> {
  const { board, n, winLen, playerPiece } = opts;
  const empties = legalMoves(board);
  if (empties.length === 0) return { suggestions: [], meta: null };

  // ---- 1) candidates: tactical cells first (classifier score desc) ----
  const classified = classifyBoard(board, n, playerPiece, winLen);
  const tactical = [...classified.entries()]
    .filter(([, c]) => c.category > CAT.NONE)
    .sort((a, b) => b[1].score - a[1].score);

  const candidateCells: number[] = [];
  for (const [cell] of tactical) {
    if (candidateCells.length >= MAX_CANDIDATES) break;
    candidateCells.push(cell);
  }
  if (candidateCells.length < MAX_CANDIDATES) {
    for (const cell of positionalCandidates(board, n)) {
      if (candidateCells.length >= MAX_CANDIDATES) break;
      if (!candidateCells.includes(cell)) candidateCells.push(cell);
    }
  }
  if (candidateCells.length === 0) return { suggestions: [], meta: null };

  // ---- 2) NN-score each candidate (player perspective) ----
  const scored: { cell: number; nnWinProb: number }[] = [];
  const scratch = cloneBoard(board);
  for (const cell of candidateCells) {
    scratch[cell] = playerPiece;
    const pred = await nnEvaluate(int8ToBoard(scratch, n), n, 900);
    scratch[cell] = 0;
    if (!pred) continue;
    const wp1 = pred.winProb1; // player-1 perspective 0..1
    const playerPersp = playerPiece === 1 ? wp1 : 1 - wp1;
    scored.push({ cell, nnWinProb: Math.round(playerPersp * 1000) / 10 });
  }
  if (scored.length === 0) return { suggestions: [], meta: null };
  scored.sort((a, b) => b.nnWinProb - a.nnWinProb);

  // ---- 3) decorate with classifier tags + agreement flag ----
  const topTacticalCell = tactical.length > 0 ? tactical[0][0] : -1;
  const suggestions: NnSuggestion[] = scored.slice(0, MAX_SUGGESTIONS).map(({ cell, nnWinProb }, i) => {
    const c = classified.get(cell);
    const row = Math.floor(cell / n);
    const col = cell % n;
    return {
      row,
      col,
      nnWinProb,
      tag: c ? describeCategory(c.category, c.isFork) : "Positional move — develops influence",
      isFork: c?.isFork || undefined,
      tactical: i === 0 && cell === topTacticalCell,
    };
  });

  // Meta (never blocks suggestions — fetched opportunistically).
  const meta = await nnMeta();

  return { suggestions, meta };
}
