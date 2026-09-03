// ============================================================================
// Game store — zustand. Single source of truth for the UI.
// All engine work happens server-side via /api/game/*; this store applies
// server responses optimistically with rollback on failure (auto-recovery).
// ============================================================================

'use client';

import { create } from 'zustand';
import type {
  Analysis,
  GameMode,
  GameStatePayload,
  GameStatus,
  LearningSnapshot,
  MoveRecord,
  ScoreState,
  SearchStats,
  TrainingResult,
} from '@/lib/game/types';

// ---------------------------------------------------------------------------
// Server response shapes
// ---------------------------------------------------------------------------

export type { GameStatePayload };

export interface MoveResponse {
  ok: boolean;
  state: GameStatePayload;
  analysis?: Analysis | null;
  lastStats?: SearchStats | null;
  lastLearning?: LearningSnapshot | null;
  crossGameLearning?: { inherited: boolean; priorVisits: number } | null;
  error?: string;
}

export interface NewResponse {
  ok: boolean;
  state: GameStatePayload;
  crossGameLearning?: { inherited: boolean; priorVisits: number } | null;
  raveVisits?: number;
  error?: string;
}

export interface TrainResponse {
  ok: boolean;
  result?: TrainingResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface GameStore {
  // --- state ---
  board: number[][];
  boardSize: number;
  winLength: number;
  status: GameStatus;
  currentPlayer: number;
  playerPiece: number;
  aiPiece: number;
  winner: number | null;
  winLine: [number, number][] | null;
  lastMove: [number, number] | null;
  aiFirstMove: [number, number] | null;
  gameMode: GameMode;
  playerFirst: boolean;
  simulations: number;
  autoMode: boolean;
  isThinking: boolean;
  isInitializing: boolean;
  hoverCell: [number, number] | null;
  moveHistory: MoveRecord[];
  lastStats: SearchStats | null;
  lastLearning: LearningSnapshot | null;
  learningHistory: LearningSnapshot[];
  analysis: Analysis | null;
  playerScore: ScoreState;
  aiScore: ScoreState;
  crossGameLearning: { inherited: boolean; priorVisits: number } | null;
  showArchInfo: boolean;
  isTraining: boolean;
  trainingProgress: string;
  trainingResult: TrainingResult | null;
  previewDuration: number; // seconds; 0 = always visible
  analysisAutoCollapse: number; // seconds
  /** Bumped whenever the AI completes a move — edge-detected by the page
   *  (via subscribe) to trigger the auto-peek state machine without
   *  setState-in-effect. */
  moveTriggered: number;

  // --- actions ---
  setHoverCell: (cell: [number, number] | null) => void;
  makeMove: (row: number, col: number) => Promise<void>;
  /** Plays for the current player (used by Auto Mode / AI-vs-AI). */
  playAuto: () => Promise<void>;
  newGame: () => Promise<void>;
  setGameMode: (m: GameMode) => void;
  setAutoMode: (b: boolean) => void;
  setBoardSize: (n: number) => void;
  setWinLength: (n: number) => void;
  setPlayerFirst: (b: boolean) => void;
  setSimulations: (n: number) => void;
  setPreviewDuration: (n: number) => void;
  setAnalysisAutoCollapse: (n: number) => void;
  setShowArchInfo: (b: boolean) => void;
  runTraining: (allSizes: boolean) => Promise<void>;
  clearTrainingResult: () => void;
  clearMoveTriggered: () => void;
}

const emptyScore = (): ScoreState => ({ total: 0, breakdown: { fives: 0, fours: 0, triples: 0 } });

const initialBoard = (n = 15) => Array.from({ length: n }, () => Array<number>(n).fill(0));

export const useGameStore = create<GameStore>((set, get) => ({
  // --- initial state ---
  board: initialBoard(),
  boardSize: 15,
  winLength: 5,
  status: 'idle',
  currentPlayer: 1,
  playerPiece: 1,
  aiPiece: 2,
  winner: null,
  winLine: null,
  lastMove: null,
  aiFirstMove: null,
  gameMode: 'classic',
  playerFirst: true,
  simulations: 3000,
  autoMode: false,
  isThinking: false,
  isInitializing: false,
  hoverCell: null,
  moveHistory: [],
  lastStats: null,
  lastLearning: null,
  learningHistory: [],
  analysis: null,
  playerScore: emptyScore(),
  aiScore: emptyScore(),
  crossGameLearning: null,
  showArchInfo: false,
  isTraining: false,
  trainingProgress: '',
  trainingResult: null,
  previewDuration: 3,
  analysisAutoCollapse: 6,
  moveTriggered: 0,

  // --- actions ---
  setHoverCell: (cell) => set({ hoverCell: cell }),

  makeMove: async (row, col) => {
    const s = get();
    if (s.status !== 'playing' || s.currentPlayer !== s.playerPiece || s.isThinking) return;
    if (s.board[row]?.[col] !== 0) return;

    // Optimistic local application.
    const prevBoard = s.board;
    const prevHistory = s.moveHistory;
    const nb = s.board.map((r) => r.slice());
    nb[row][col] = s.playerPiece;
    set({
      board: nb,
      moveHistory: [...s.moveHistory, { row, col, player: s.playerPiece }],
      lastMove: [row, col],
      currentPlayer: s.aiPiece,
      isThinking: true,
      hoverCell: null,
    });

    try {
      const res = await fetch('/api/game/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Server applies the move itself — send the PRE-move board, plus
          // prior history/scores so counters span the whole game.
          board: s.board,
          boardSize: s.boardSize,
          winLength: s.winLength,
          gameMode: s.gameMode,
          playerPiece: s.playerPiece,
          aiPiece: s.aiPiece,
          row,
          col,
          simulations: s.simulations,
          moveHistory: s.moveHistory,
          playerScore: s.playerScore,
          aiScore: s.aiScore,
        }),
      });
      const data: MoveResponse = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Move failed');

      set({
        board: data.state.board,
        currentPlayer: data.state.currentPlayer,
        status: data.state.status,
        winner: data.state.winner,
        winLine: data.state.winLine,
        lastMove: data.state.lastMove,
        aiFirstMove: data.state.aiFirstMove,
        moveHistory: data.state.moveHistory,
        playerScore: data.state.playerScore,
        aiScore: data.state.aiScore,
        analysis: data.analysis ?? null,
        lastStats: data.lastStats ?? null,
        lastLearning: data.lastLearning ?? null,
        learningHistory: data.lastLearning
          ? [...get().learningHistory.slice(-59), data.lastLearning]
          : get().learningHistory,
        crossGameLearning: data.crossGameLearning ?? get().crossGameLearning,
        isThinking: false,
        moveTriggered: get().moveTriggered + 1,
      });
    } catch {
      // Auto-recovery: revert to the exact pre-move state.
      set({
        board: prevBoard,
        moveHistory: prevHistory,
        currentPlayer: s.playerPiece,
        isThinking: false,
      });
    }
  },

  playAuto: async () => {
    const s = get();
    if (s.status !== 'playing' || s.isThinking) return;
    set({ isThinking: true });
    try {
      const res = await fetch('/api/game/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: s.board,
          boardSize: s.boardSize,
          winLength: s.winLength,
          gameMode: s.gameMode,
          playerPiece: s.playerPiece,
          aiPiece: s.aiPiece,
          auto: true,
          simulations: s.simulations,
          moveHistory: s.moveHistory,
          playerScore: s.playerScore,
          aiScore: s.aiScore,
        }),
      });
      const data: MoveResponse = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Auto move failed');
      set({
        board: data.state.board,
        currentPlayer: data.state.currentPlayer,
        status: data.state.status,
        winner: data.state.winner,
        winLine: data.state.winLine,
        lastMove: data.state.lastMove,
        moveHistory: data.state.moveHistory,
        playerScore: data.state.playerScore,
        aiScore: data.state.aiScore,
        analysis: data.analysis ?? get().analysis,
        lastStats: data.lastStats ?? get().lastStats,
        lastLearning: data.lastLearning ?? get().lastLearning,
        isThinking: false,
        moveTriggered: get().moveTriggered + 1,
      });
    } catch {
      set({ isThinking: false });
    }
  },

  newGame: async () => {
    const s = get();
    set({ isInitializing: true, status: 'idle', analysis: null, winLine: null, winner: null });
    try {
      const res = await fetch('/api/game/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardSize: s.boardSize,
          winLength: s.winLength,
          gameMode: s.gameMode,
          playerFirst: s.playerFirst,
        }),
      });
      const data: NewResponse = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'New game failed');
      set({
        board: data.state.board,
        currentPlayer: data.state.currentPlayer,
        status: data.state.status,
        winner: null,
        winLine: null,
        lastMove: null,
        aiFirstMove: data.state.aiFirstMove,
        moveHistory: [],
        playerScore: data.state.playerScore,
        aiScore: data.state.aiScore,
        analysis: null,
        lastStats: null,
        lastLearning: null,
        crossGameLearning: data.crossGameLearning ?? null,
        isInitializing: false,
        isThinking: false,
      });
    } catch {
      // Offline-safe: start a purely local idle game so the UI never dead-ends.
      set({
        board: initialBoard(s.boardSize),
        currentPlayer: s.playerFirst ? s.playerPiece : s.aiPiece,
        status: s.playerFirst ? 'playing' : 'idle',
        isInitializing: false,
        isThinking: false,
        moveHistory: [],
      });
    }
  },

  setGameMode: (m) => {
    set({ gameMode: m });
    void get().newGame();
  },
  setAutoMode: (b) => set({ autoMode: b }),
  setBoardSize: (n) => {
    set({ boardSize: n });
    void get().newGame();
  },
  setWinLength: (n) => {
    set({ winLength: n });
    void get().newGame();
  },
  setPlayerFirst: (b) => {
    set({ playerFirst: b });
    void get().newGame();
  },
  setSimulations: (n) => set({ simulations: n }),
  setPreviewDuration: (n) => set({ previewDuration: n }),
  setAnalysisAutoCollapse: (n) => set({ analysisAutoCollapse: n }),
  setShowArchInfo: (b) => set({ showArchInfo: b }),

  runTraining: async (allSizes) => {
    const s = get();
    if (s.isTraining) return;
    set({ isTraining: true, trainingProgress: allSizes ? 'Training all sizes…' : 'Training…' });
    try {
      const res = await fetch('/api/game/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allSizes,
          boardSize: s.boardSize,
          winLength: s.winLength,
          gameMode: s.gameMode,
          numGames: allSizes ? 40 : 200,
        }),
      });
      const data: TrainResponse = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Training failed');
      set({
        isTraining: false,
        trainingProgress: '',
        trainingResult: data.result ?? null,
      });
    } catch {
      set({ isTraining: false, trainingProgress: '' });
    }
  },

  clearTrainingResult: () => set({ trainingResult: null }),
  clearMoveTriggered: () => set({ moveTriggered: 0 }),
}));

// Dev-only debugging handle (excluded from production builds) — lets the
// console / E2E checks drive the store directly (e.g. rig a finished game
// to verify the eval bar's terminal truth override).
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __gameStore: typeof useGameStore }).__gameStore = useGameStore;
}
