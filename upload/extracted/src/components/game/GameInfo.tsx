'use client';

import { useGameStore } from '@/store/game-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Circle,
  Loader2,
  Trophy,
  Minus,
  BrainCircuit,
  GitBranch,
  Check,
  Database,
  TrendingUp,
  ArrowRightLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Game info content — designed to be placed inside a Sheet.
 * Shows status, scoreboard (scoring mode), AI analysis, learning data, move history.
 */
export function GameInfoContent() {
  const {
    status,
    currentPlayer,
    playerPiece,
    aiPiece,
    winner,
    moveHistory,
    lastStats,
    lastLearning,
    isThinking,
    boardSize,
    winLength,
    simulations,
    learningHistory,
    playerScore,
    aiScore,
    gameMode,
    crossGameLearning,
  } = useGameStore();

  const isPlayerTurn =
    !isThinking && status === 'playing' && currentPlayer === playerPiece;

  const statusConfig = {
    idle: {
      label: 'Start a game',
      icon: Circle,
      color: 'text-muted-foreground',
      bg: 'bg-muted/50',
    },
    playing: {
      label: isThinking
        ? 'AI is thinking...'
        : isPlayerTurn
          ? 'Your turn'
          : 'AI turn',
      icon: isThinking ? Loader2 : Circle,
      color: isThinking
        ? 'text-amber-600'
        : isPlayerTurn
          ? 'text-emerald-600'
          : 'text-slate-500',
      bg: isThinking
        ? 'bg-amber-50 dark:bg-amber-950/30'
        : isPlayerTurn
          ? 'bg-emerald-50 dark:bg-emerald-950/30'
          : 'bg-slate-50 dark:bg-slate-900/30',
    },
    won: {
      label: 'You win!',
      icon: Trophy,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    },
    lost: {
      label: 'AI wins',
      icon: Trophy,
      color: 'text-red-500',
      bg: 'bg-red-50 dark:bg-red-950/30',
    },
    draw: {
      label: 'Draw',
      icon: Minus,
      color: 'text-muted-foreground',
      bg: 'bg-muted/50',
    },
  };

  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;

  // Compute cumulative Global RAVE stats across all turns
  const cumulativeGlobalVisits =
    learningHistory?.reduce(
      (sum, l) => sum + l.globalRaveTotalVisits,
      0
    ) ?? 0;
  const totalTurns = learningHistory?.length ?? 0;
  const treeReuseCount =
    learningHistory?.filter((l) => l.treeReused).length ?? 0;

  return (
    <div className="space-y-3">
      {/* Status Bar */}
      <div
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 rounded-lg',
          cfg.bg
        )}
      >
        <StatusIcon
          className={cn(
            'w-4 h-4 flex-shrink-0',
            cfg.color,
            isThinking && 'animate-spin'
          )}
        />
        <span className={cn('text-sm font-medium', cfg.color)}>
          {cfg.label}
        </span>
      </div>

      {/* Scoreboard — only in scoring mode */}
      {gameMode === 'scoring' && playerScore && aiScore && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-500" />
              Scoreboard
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-3">
              {/* Player score */}
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground mb-0.5">
                  You
                </div>
                <div
                  className={cn(
                    'text-2xl font-mono font-bold',
                    playerScore.total > aiScore.total
                      ? 'text-emerald-600'
                      : 'text-foreground'
                  )}
                >
                  {playerScore.total}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  {playerScore.breakdown.fives > 0 && (
                    <span>{playerScore.breakdown.fives}x5 </span>
                  )}
                  {playerScore.breakdown.fours > 0 && (
                    <span>{playerScore.breakdown.fours}x4 </span>
                  )}
                  {playerScore.breakdown.triples > 0 && (
                    <span>{playerScore.breakdown.triples}x3</span>
                  )}
                  {playerScore.breakdown.triples === 0 &&
                    playerScore.breakdown.fours === 0 &&
                    playerScore.breakdown.fives === 0 && <span>—</span>}
                </div>
              </div>

              {/* AI score */}
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground mb-0.5">
                  AI
                </div>
                <div
                  className={cn(
                    'text-2xl font-mono font-bold',
                    aiScore.total > playerScore.total
                      ? 'text-slate-700 dark:text-slate-300'
                      : 'text-foreground'
                  )}
                >
                  {aiScore.total}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  {aiScore.breakdown.fives > 0 && (
                    <span>{aiScore.breakdown.fives}x5 </span>
                  )}
                  {aiScore.breakdown.fours > 0 && (
                    <span>{aiScore.breakdown.fours}x4 </span>
                  )}
                  {aiScore.breakdown.triples > 0 && (
                    <span>{aiScore.breakdown.triples}x3</span>
                  )}
                  {aiScore.breakdown.triples === 0 &&
                    aiScore.breakdown.fours === 0 &&
                    aiScore.breakdown.fives === 0 && <span>—</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Card */}
      {lastStats && lastStats.simulations > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <BrainCircuit className="w-3.5 h-3.5 text-muted-foreground" />
              Last AI Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-mono font-semibold">
                  {lastStats.simulations.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Simulations
                </div>
              </div>
              <div>
                <div className="text-lg font-mono font-semibold">
                  {(lastStats.thinkTimeMs / 1000).toFixed(1)}s
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Think Time
                </div>
              </div>
              <div>
                <div className="text-lg font-mono font-semibold">
                  {lastStats.nodesExpanded.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Nodes
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground text-center">
              {(lastStats.simulations / (lastStats.thinkTimeMs / 1000)).toFixed(0)}{' '}
              sims/sec
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cross-Game Learning Badge */}
      {crossGameLearning && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
          crossGameLearning.inherited
            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
            : 'bg-muted/50 text-muted-foreground'
        )}>
          <ArrowRightLeft className="w-3.5 h-3.5 flex-shrink-0" />
          {crossGameLearning.inherited ? (
            <span>
              Inherited <span className="font-mono font-semibold">{crossGameLearning.priorVisits.toLocaleString()}</span> learned positions from previous games
            </span>
          ) : (
            <span>First game on this board — AI will learn as you play</span>
          )}
        </div>
      )}

      {/* Persistent Learning Card — Global RAVE */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-amber-500" />
            AI Memory (Global RAVE)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          {lastLearning ? (
            <div className="space-y-1.5 text-xs">
              {/* Global RAVE Knowledge Base */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Knowledge Base
                  </span>
                  <span className="font-mono">
                    {cumulativeGlobalVisits.toLocaleString()} entries
                  </span>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, lastLearning.globalRaveCoverage * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground -mt-0.5">
                  {(lastLearning.globalRaveCoverage * 100).toFixed(1)}% of
                  positions explored
                </p>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Positions Known
                </span>
                <span className="font-mono">
                  {Math.round(lastLearning.globalRaveCoverage * boardSize * boardSize)}{' '}
                  / {boardSize * boardSize}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Best Move RAVE
                </span>
                <span className="font-mono">
                  {(lastLearning.globalRaveBestRate * 100).toFixed(1)}% win
                  rate
                </span>
              </div>

              <div className="border-t border-border/30 my-1" />

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Tree Reused
                </span>
                {lastLearning.treeReused ? (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Check className="w-3.5 h-3.5" /> Yes
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-600">
                    <TrendingUp className="w-3.5 h-3.5" /> Global RAVE only
                  </span>
                )}
              </div>

              {totalTurns > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Tree Reuse Rate
                  </span>
                  <span className="font-mono">
                    {treeReuseCount}/{totalTurns} turns
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Tree Size
                </span>
                <span className="font-mono">
                  {lastLearning.totalTreeNodes.toLocaleString()} nodes
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  AI Confidence
                </span>
                <span className="font-mono">
                  {(lastLearning.bestMoveWinRate * 100).toFixed(1)}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Prior Visits
                </span>
                <span className="font-mono">
                  {lastLearning.priorTreeVisits}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  RAVE β (influence)
                </span>
                <span className="font-mono">
                  {(lastLearning.raveBeta * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground -mt-1">
                Lower β → AI trusts its own experience more
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              Play a move to see learning data
            </p>
          )}
        </CardContent>
      </Card>

      {/* Game Config Summary */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
          {boardSize}x{boardSize}
        </Badge>
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
          {winLength}-in-a-row
        </Badge>
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
          <BrainCircuit className="w-2.5 h-2.5 mr-1" />
          {simulations.toLocaleString()} sims
        </Badge>
        <Badge variant="outline" className="text-[10px] px-2 py-0.5">
          Move {moveHistory.length}
        </Badge>
      </div>

      {/* Move History */}
      {moveHistory.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
              Move History
              <span className="ml-auto text-[10px] text-muted-foreground font-normal">
                {moveHistory.length} moves
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <ScrollArea className="max-h-64">
              <div className="space-y-px pr-2">
                {moveHistory.map((move, i) => {
                  const colLabel = String.fromCharCode(
                    65 + (move.col >= 8 ? move.col + 1 : move.col)
                  );
                  const rowLabel = boardSize - move.row;
                  const isLast = i === moveHistory.length - 1;
                  const isPlayer = move.player === playerPiece;
                  return (
                    <div
                      key={`move-${i}-${move.row}-${move.col}-${move.player}`}
                      className={cn(
                        'flex items-center gap-2 text-xs py-1 px-1.5 rounded',
                        isLast && 'bg-muted/50'
                      )}
                    >
                      <span className="text-muted-foreground w-6 text-right font-mono text-[10px]">
                        {i + 1}.
                      </span>
                      <div
                        className={cn(
                          'w-3 h-3 rounded-full flex-shrink-0',
                          isPlayer
                            ? 'bg-gradient-to-br from-emerald-400 to-emerald-600'
                            : 'bg-gradient-to-br from-gray-600 to-gray-800'
                        )}
                      />
                      <span className="font-mono text-xs">
                        {colLabel}
                        {rowLabel}
                      </span>
                      {move.pointsScored != null &&
                        move.pointsScored > 0 && (
                          <span className="inline-flex items-center text-[10px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950/40 rounded px-1.5 py-0.5">
                            +{move.pointsScored}
                          </span>
                        )}
                      <span className="text-muted-foreground ml-auto text-[10px]">
                        {isPlayer ? 'You' : 'AI'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
