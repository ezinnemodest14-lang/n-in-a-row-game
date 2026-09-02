// ============================================================================
// POST /api/game/train — Quick Train: fast self-play (no tree search) that
// seeds GlobalRAVE for one config or all sizes. Zero decay (bug #4 rule);
// playouts are randomized, never greedy.
// ============================================================================

import { NextResponse } from "next/server";
import { trainGames } from "@/lib/game/mcts";
import { loadRave, saveRave } from "@/lib/game/engine-runtime";
import { nnTrainRound } from "@/lib/neural-client";
import { db } from "@/lib/db";
import type { GameMode, TrainingConfigResult, TrainingResult } from "@/lib/game/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface TrainBody {
  allSizes?: boolean;
  boardSize?: number;
  winLength?: number;
  gameMode?: GameMode;
  numGames?: number;
}

const SINGLE_CAP = 600;
const ALL_SIZES_GAMES = 40;

const ALL_CONFIGS: { boardSize: number; winLength: number; gameMode: GameMode }[] = [
  { boardSize: 3, winLength: 3, gameMode: "classic" },
  { boardSize: 5, winLength: 4, gameMode: "classic" },
  { boardSize: 7, winLength: 4, gameMode: "classic" },
  { boardSize: 9, winLength: 5, gameMode: "classic" },
  { boardSize: 10, winLength: 5, gameMode: "classic" },
  { boardSize: 11, winLength: 5, gameMode: "classic" },
  { boardSize: 13, winLength: 5, gameMode: "classic" },
  { boardSize: 15, winLength: 5, gameMode: "classic" },
  { boardSize: 15, winLength: 5, gameMode: "scoring" },
  { boardSize: 17, winLength: 5, gameMode: "classic" },
  { boardSize: 19, winLength: 5, gameMode: "classic" },
  { boardSize: 19, winLength: 5, gameMode: "scoring" },
  { boardSize: 21, winLength: 6, gameMode: "classic" },
  { boardSize: 24, winLength: 6, gameMode: "classic" },
];

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = (await req.json()) as TrainBody;
    const numGames = Math.max(10, Math.min(SINGLE_CAP, Math.floor(body.numGames ?? 200)));

    const configs = body.allSizes
      ? ALL_CONFIGS
      : [
          {
            boardSize: Math.max(3, Math.min(24, Math.floor(body.boardSize ?? 15))),
            winLength: Math.max(3, Math.floor(body.winLength ?? 5)),
            gameMode: body.gameMode === "scoring" ? ("scoring" as GameMode) : ("classic" as GameMode),
          },
        ];

    const results: TrainingConfigResult[] = [];

    for (const cfg of configs) {
      const { rave } = await loadRave(cfg.boardSize, cfg.gameMode);
      const t0 = Date.now();
      const out = trainGames(
        cfg.boardSize,
        Math.min(cfg.winLength, cfg.boardSize),
        cfg.gameMode,
        body.allSizes ? ALL_SIZES_GAMES : numGames,
        rave,
        (Date.now() & 0xffff) ^ (cfg.boardSize * 7919)
      );
      const visitsAdded = out.visitsAfter - out.visitsBefore;
      await saveRave(cfg.boardSize, cfg.gameMode, rave);
      results.push({
        config: { boardSize: cfg.boardSize, winLength: cfg.winLength, gameMode: cfg.gameMode, numGames: body.allSizes ? ALL_SIZES_GAMES : numGames },
        p1Wins: out.p1,
        p2Wins: out.p2,
        draws: out.draw,
        totalMs: Date.now() - t0,
        visitsAdded,
        totalVisits: out.visitsAfter,
      });
      try {
        await db.trainingRun.create({
          data: {
            boardSize: cfg.boardSize,
            winLength: cfg.winLength,
            gameMode: cfg.gameMode,
            numGames: body.allSizes ? ALL_SIZES_GAMES : numGames,
            p1Wins: out.p1,
            p2Wins: out.p2,
            draws: out.draw,
            totalMs: Date.now() - t0,
            visitsAdded,
          },
        });
      } catch {
        // history is best-effort
      }
    }

    const result: TrainingResult = { results, totalMs: Date.now() - started };

    // Opportunistic NN training round (fire-and-forget).
    void nnTrainRound(60, 11, 2);

    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Training failed" },
      { status: 500 }
    );
  }
}

