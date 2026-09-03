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
  | "counter-four"
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

/**
 * A move suggestion scored by the neural net. Produced AFTER the AI's move
 * (i.e. for the player's next turn) by NN-evaluating the position that
 * results from each candidate — the number is the PLAYER's win probability
 * (0..100) according to the network, so higher = better for you.
 */
export interface NnSuggestion {
  row: number;
  col: number;
  /** NN win probability for the player after this move, 0..100. */
  nnWinProb: number;
  /** Tactical label from the threat classifier (e.g. "Open three — …"). */
  tag: string;
  isFork?: boolean;
  /** True when the NN's #1 pick also matches the threat classifier's top cell. */
  tactical?: boolean;
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
  /** Present when the NN blend (60% MCTS / 40% NN) confirmed or re-ranked
   *  the MCTS top pick. `agreed` = NN kept the search's #1 choice. */
  nnReRank?: {
    agreed: boolean;
    from?: string; // MCTS pick coord (only when re-ranked)
    to?: string; // final pick coord
    candidates: number; // how many candidates the NN scored
  };
  /** NN-scored suggestions for the player's NEXT move (empty in scoring
   *  mode or when the NN service is unavailable). */
  nnSuggestions?: NnSuggestion[];
  /** NN service metadata (params / training samples), when available. */
  nnMeta?: { params: number; trainingSamples: number } | null;
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
// Game review (NN replay) — produced by POST /api/game/review
// ---------------------------------------------------------------------------

export type ReviewGrade =
  | "brilliant" // took the win / best tactical shot
  | "great" // clear eval gain
  | "good" // roughly neutral, sound
  | "inaccuracy" // small eval loss
  | "mistake" // significant eval loss / allowed a strong threat
  | "blunder"; // missed a win or missed a forced block

/** One graded move in the review. */
export interface GameReviewMove {
  moveNo: number; // 1-based
  player: number; // 1 = human, 2 = AI
  row: number;
  col: number;
  coord: string; // e.g. "H8"
  grade: ReviewGrade;
  /** Eval swing from the MOVER's perspective, in win-% points. */
  delta: number;
  winProbBefore: number; // player perspective, 0..100
  winProbAfter: number; // player perspective, 0..100
  headline: string; // e.g. "Missed the winning move at J9"
}

/** Full NN game review payload. */
export interface GameReviewData {
  usedNn: boolean; // true = neural net scored every position
  accuracy: { player: number; ai: number }; // 0..100
  grades: {
    player: Partial<Record<ReviewGrade, number>>;
    ai: Partial<Record<ReviewGrade, number>>;
  };
  /** Win-prob curve (player perspective) AFTER each move; index 0 = start (50). */
  points: { move: number; winProb: number }[];
  moves: GameReviewMove[];
  summary: string[]; // 1-3 human-readable takeaways
}

export interface ReviewResponse {
  ok: boolean;
  review?: GameReviewData;
  error?: string;
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
