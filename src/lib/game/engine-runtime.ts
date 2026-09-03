// ============================================================================
// Server-side engine runtime — RAVE memory cache + persistence, shared by
// the /api/game routes. Single-process cache; SQLite is the durable store.
// ============================================================================

import { db } from "@/lib/db";
import { GlobalRAVE } from "@/lib/game/mcts";

interface CacheEntry {
  rave: GlobalRAVE;
  loadedAt: number;
}

const raveCache = new Map<string, CacheEntry>();

export function raveKey(boardSize: number, mode: string): string {
  return `rave_${boardSize}_${mode}`;
}

/** Load the RAVE table for a config — from memory cache, else SQLite, else fresh. */
export async function loadRave(
  boardSize: number,
  mode: string
): Promise<{ rave: GlobalRAVE; inherited: boolean; priorVisits: number }> {
  const key = raveKey(boardSize, mode);
  const cached = raveCache.get(key);
  if (cached) {
    return {
      rave: cached.rave,
      inherited: cached.rave.totalVisits() > 0,
      priorVisits: cached.rave.totalVisits(),
    };
  }

  try {
    const row = await db.raveMemory.findUnique({ where: { key } });
    if (row) {
      const parsed = JSON.parse(row.data) as Parameters<typeof GlobalRAVE.fromJSON>[0];
      const rave = GlobalRAVE.fromJSON(parsed);
      raveCache.set(key, { rave, loadedAt: Date.now() });
      return { rave, inherited: rave.totalVisits() > 0, priorVisits: rave.totalVisits() };
    }
  } catch {
    // fall through to fresh table
  }

  const rave = new GlobalRAVE(boardSize);
  raveCache.set(key, { rave, loadedAt: Date.now() });
  return { rave, inherited: false, priorVisits: 0 };
}

/** Persist a RAVE table to SQLite (best-effort, never throws). */
export async function saveRave(boardSize: number, mode: string, rave: GlobalRAVE): Promise<void> {
  const key = raveKey(boardSize, mode);
  try {
    const data = JSON.stringify(rave.toJSON());
    const totalVisits = rave.totalVisits();
    await db.raveMemory.upsert({
      where: { key },
      create: { key, boardSize, gameMode: mode, data, totalVisits },
      update: { data, totalVisits },
    });
  } catch {
    // persistence is best-effort — gameplay continues from the memory cache
  }
}

export function raveVisitsOf(rave: GlobalRAVE): number {
  return rave.totalVisits();
}
