// ============================================================================
// N-in-a-Row — shared engine types
// The `analysis` shape here is the exact contract consumed by the UI
// components (AnalysisPanel / QuickPreview / EvalBar / BottomPanel).
// ============================================================================

export type GameMode = "classic" | "scoring";

export type GameStatus = "idle" | "playing" | "won" | "lost" | "draw";

/** Cell values on the board. 0 = empty, 1 = human player, 2 = AI. */
export type CellValue = 0 | 1 | 2;

/** Move reason produced by the tactical safety net / search. */
export type MoveReason =
  | "win"
  | "block-win"
  | "open-four"
  | "block-four"
  | "block-open-four"
  | "fork"
  | "block-fork"
  | "block-open-three"
  | "search";

/** A suggested move for the human player (analysis panel). */
export interface PlayerBestMove {
  row: number;
  col: number;
  description: string;
  isFork?: boolean;
}

/** A critical square that must be watched / taken. */
export interface CriticalSquare {
  row: number;
  col: number;
  severity: "vital" | "important" | string;
  forPlayer: "player" | "ai" | string;
  reason: string;
}

/** A top scoring move in Score Attack mode. */
export interface ScoringMove {
  row: number;
  col: number;
  patterns: string;
  points: number;
}

/** Score Attack analytics block. */
export interface ScoringAnalysis {
  playerTotal: number;
  aiTotal: number;
  diff: number;
  boardFillPct: number;
  playerPace: number;
  aiPace: number;
  projectedPlayerFinal: number;
  projectedAiFinal: number;
  remainingMoves: number;
  topScoringMoves: ScoringMove[];
}

/** Tempo / initiative snapshot. */
export interface Tempo {
  playerInitiative: number; // 0..10
  aiInitiative: number; // 0..10
  urgency: "none" | "attack" | "defend" | "critical";
}

/** Board control / influence snapshot. */
export interface BoardControl {
  playerInfluence: number; // 0..100
  aiInfluence: number; // 0..100
  contested: number; // 0..100
  totalCells: number;
}

/** One AI candidate move with MCTS visit stats. */
export interface AiCandidateMove {
  row: number;
  col: number;
  visits: number;
  winRate: number; // 0..1
  raveRate: number; // 0..1
}

/** Threat counts keyed by threat name (UI colors by substring). */
export interface ThreatCounts {
  [key: string]: number;
  Five: number;
  OpenFour: number;
  HalfOpenFour: number;
  OpenThree: number;
  HalfOpenThree: number;
}

/** The full analysis object rendered by the analysis UI. */
export interface Analysis {
  evalScore: number; // signed display score, positive = player ahead
  assessment: string; // short label
  winProb: number; // 0..100, player perspective (derived: 100 - ai)
  aiWinProb: number; // 0..100
  moveQuality: "optimal" | "strong" | "alternative" | "tactical";
  playerBestMoves: PlayerBestMove[];
  aiCandidateMoves: AiCandidateMove[];
  playerThreats: ThreatCounts;
  aiThreats: ThreatCounts;
  criticalSquares: CriticalSquare[];
  tempo: Tempo;
  boardControl: BoardControl;
  scoringAnalysis: ScoringAnalysis | null;
  aiReasoning: string;
}

/** Search telemetry (rendered as sims/sec etc.). */
export interface SearchStats {
  simulations: number;
  thinkTimeMs: number;
  nodesExpanded: number;
  totalVisits: number;
  raveBeta: number;
  rootWinRate: number;
}

/** Per-turn learning telemetry. */
export interface LearningSnapshot {
  globalRaveTotalVisits: number;
  globalRaveCoverage: number; // 0..1
  globalRaveBestRate: number; // 0..1
  treeReused: boolean;
  totalTreeNodes: number;
  bestMoveWinRate: number; // 0..1
  priorTreeVisits: number;
  raveBeta: number; // 0..1
}

/** Result of a training run for one config. */
export interface TrainingConfigResult {
  config: {
    boardSize: number;
    winLength: number;
    gameMode: GameMode;
    numGames: number;
  };
  p1Wins: number;
  p2Wins: number;
  draws: number;
  totalMs: number;
  visitsAdded: number;
  totalVisits: number;
}

export interface TrainingResult {
  results: TrainingConfigResult[];
  totalMs: number;
}

/** One recorded move. */
export interface MoveRecord {
  row: number;
  col: number;
  player: number;
  pointsScored?: number | null;
}

/** Canonical game state payload exchanged with /api/game/*. */
export interface GameStatePayload {
  board: number[][];
  boardSize: number;
  winLength: number;
  gameMode: GameMode;
  currentPlayer: number;
  playerPiece: number;
  aiPiece: number;
  status: GameStatus;
  winner: number | null;
  winLine: [number, number][] | null;
  lastMove: [number, number] | null;
  aiFirstMove: [number, number] | null;
  moveHistory: MoveRecord[];
  playerScore: ScoreState;
  aiScore: ScoreState;
}

/** Score state for Score Attack mode. */
export interface ScoreState {
  total: number;
  breakdown: { fives: number; fours: number; triples: number };
}

// ---------------------------------------------------------------------------
// Internal engine types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  category: number;
  secondCategory: number;
  isFork: boolean;
  score: number;
  direction: [number, number] | null;
  hasGap: boolean;
  openThreeCount: number;
}

export interface MctsResult {
  move: number;
  reason: MoveReason;
  simulations: number;
  elapsedMs: number;
  rootWinRate: number;
  raveBeta: number;
  topChildren: {
    row: number;
    col: number;
    cell: number;
    visits: number;
    winRate: number;
    raveRate: number;
  }[];
  totalVisits: number;
  nodesExpanded: number;
  treeReused: boolean;
  priorTreeVisits: number;
  totalTreeNodes: number;
}

// ---------------------------------------------------------------------------
// Board conversion helpers (UI uses number[][], engine uses Int8Array)
// ---------------------------------------------------------------------------

export function boardToInt8(board: number[][]): Int8Array {
  const n = board.length;
  const flat = new Int8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) flat[r * n + c] = board[r][c];
  return flat;
}

export function int8ToBoard(flat: Int8Array, n: number): number[][] {
  const board: number[][] = [];
  for (let r = 0; r < n; r++) {
    const row: number[] = [];
    for (let c = 0; c < n; c++) row.push(flat[r * n + c]);
    board.push(row);
  }
  return board;
}
