// ============================================================================
// Server-side neural-network client.
// Calls the NN eval mini-service (port 3020) directly — server-to-server.
//
// Self-healing: if the service is unreachable, it is (re)spawned as a
// detached child process (`bun mini-services/nn-service/index.ts`) and
// health-polled before giving up. All failures degrade gracefully to
// MCTS-only evaluation by returning null.
// ============================================================================

import { spawn } from "node:child_process";
import path from "node:path";

const NN_BASE = "http://localhost:3020";
const NN_ENTRY = path.join(process.cwd(), "mini-services", "nn-service", "index.ts");

export interface NnPrediction {
  winProb1: number; // player-1 perspective, 0..1
  tookMs: number;
}

let spawning = false;

/** Ensure the NN service is up; spawn it detached if not. */
async function ensureService(timeoutMs = 3000): Promise<boolean> {
  if (await healthOnce(500)) return true;
  if (spawning) return false;
  spawning = true;
  try {
    const child = spawn("bun", [NN_ENTRY], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
  } catch {
    spawning = false;
    return false;
  }
  // Poll for readiness.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    if (await healthOnce(400)) {
      spawning = false;
      return true;
    }
  }
  spawning = false;
  return false;
}

async function healthOnce(timeoutMs: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${NN_BASE}/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function nnHealth(timeoutMs = 800): Promise<boolean> {
  return ensureService(Math.max(timeoutMs, 1500));
}

export async function nnEvaluate(
  board: number[][],
  n: number,
  timeoutMs = 1200
): Promise<NnPrediction | null> {
  try {
    const up = await ensureService(1500);
    if (!up) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${NN_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, n }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as { winProb1?: number; tookMs?: number };
    if (typeof data.winProb1 !== "number" || !Number.isFinite(data.winProb1)) return null;
    return {
      winProb1: Math.max(0, Math.min(1, data.winProb1)),
      tookMs: data.tookMs ?? 0,
    };
  } catch {
    return null;
  }
}

/** Fire-and-forget NN training round (never blocks the caller). */
export async function nnTrainRound(games = 60, boardSize = 11, epochs = 2): Promise<void> {
  try {
    if (!(await ensureService(1500))) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    await fetch(`${NN_BASE}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ games, boardSize, epochs }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
  } catch {
    // ignore — NN training is opportunistic
  }
}
