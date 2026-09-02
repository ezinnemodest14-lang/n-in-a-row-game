'use client';

import { useGameStore } from '@/store/game-store';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Grid3X3,
  Target,
  BrainCircuit,
  Users,
  Trophy,
  RotateCcw,
  Info,
  GraduationCap,
  Loader2,
  Zap,
  X,
  Timer,
  Eye,
  Activity,
} from 'lucide-react';

/**
 * Settings content — designed to be placed inside a Sheet.
 * No Card wrappers, no hover-dependent Tooltips.
 * All interactions are click/tap based.
 */
export function SettingsContent() {
  const {
    boardSize,
    winLength,
    playerFirst,
    simulations,
    isThinking,
    status,
    gameMode,
    autoMode,
    isTraining,
    trainingProgress,
    trainingResult,
    setBoardSize,
    setWinLength,
    setPlayerFirst,
    setSimulations,
    setAutoMode,
    previewDuration,
    analysisAutoCollapse,
    setPreviewDuration,
    setAnalysisAutoCollapse,
    newGame,
    setShowArchInfo,
    runTraining,
    clearTrainingResult,
  } = useGameStore();

  const isPlaying = status === 'playing';
  const canStart = !isThinking;
  const isScoringMode = gameMode === 'scoring';

  const simLabel = (() => {
    if (simulations < 1000) return `${simulations}`;
    if (simulations < 10000) return `${(simulations / 1000).toFixed(1)}k`;
    return `${(simulations / 1000).toFixed(0)}k`;
  })();

  const presetLabel =
    boardSize === 3 && winLength === 3
      ? 'Tic-Tac-Toe'
      : boardSize === 15 && winLength === 5
        ? 'Gomoku (15x15)'
        : boardSize === 19 && winLength === 5
          ? 'Gomoku (19x19)'
          : `${boardSize}x${boardSize}, ${winLength}-in-a-row`;

  return (
    <div className="space-y-5">
      {/* Preset indicator */}
      <div className="text-xs text-center py-1.5 px-3 rounded-lg bg-muted/60 font-medium">
        {presetLabel}
      </div>

      {/* Scoring Rules Info Box — only in scoring mode */}
      {isScoringMode && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/60 dark:border-amber-800/40 dark:bg-amber-950/20 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
            Scoring Rules
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+1</span>
              <span>Triple (3-in-a-row, overlapping counts)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+5</span>
              <span>Four-in-a-row bonus</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+15</span>
              <span>Five-in-a-row bonus</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+10</span>
              <span>Full row or column</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+20</span>
              <span>Full diagonal</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+3</span>
              <span>Cross pattern (H+V through stone)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400 font-mono font-bold w-7 text-right">+2</span>
              <span>Opponent line break (3+)</span>
            </li>
          </ul>
        </div>
      )}

      <Separator />

      {/* Board Size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Grid3X3 className="w-3.5 h-3.5" />
            Board Size
          </Label>
          <span className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
            {boardSize}x{boardSize}
          </span>
        </div>
        <Slider
          value={[boardSize]}
          onValueChange={([v]) => setBoardSize(v)}
          min={3}
          max={24}
          step={1}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/70">
          <span>3x3</span>
          <span>15x15</span>
          <span>24x24</span>
        </div>

      </div>

      {/* Win Length — disabled in scoring mode */}
      <div className={isScoringMode ? 'opacity-50 pointer-events-none' : ''}>
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" />
            Win Condition
          </Label>
          <span className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
            {winLength}-in-a-row
          </span>
        </div>
        <Slider
          value={[winLength]}
          onValueChange={([v]) => setWinLength(v)}
          min={3}
          max={boardSize}
          step={1}
          disabled={isScoringMode}
          className="mt-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/70">
          <span>3</span>
          <span>{Math.ceil(boardSize / 2)}</span>
          <span>{boardSize}</span>
        </div>
        {isScoringMode && (
          <p className="text-[10px] text-muted-foreground mt-1">Not used in Score Attack</p>
        )}

      </div>

      <Separator />

      {/* Simulations (Thinking Budget) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <BrainCircuit className="w-3.5 h-3.5" />
            Thinking Budget
          </Label>
          <span className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
            {simLabel} sims
          </span>
        </div>
        <Slider
          value={[simulations]}
          onValueChange={([v]) => setSimulations(v)}
          min={100}
          max={50000}
          step={100}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/70">
          <span>Quick (100)</span>
          <span>Normal (3k)</span>
          <span>Deep (50k)</span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          More simulations = stronger but slower. The AI also improves during each game via Global RAVE.
        </p>
      </div>

      <Separator />

      {/* Player First Toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          You Play First
        </Label>
        <Switch checked={playerFirst} onCheckedChange={setPlayerFirst} />
      </div>

      {/* Auto Mode Toggle */}
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          Auto Mode
          <span className="text-[10px] text-muted-foreground font-normal">
            — auto-restart games
          </span>
        </Label>
        <Switch checked={autoMode} onCheckedChange={setAutoMode} />
      </div>

      <Separator />

      {/* Display Timers */}
      <div className='space-y-3'>
        <div className='flex items-center gap-1.5'>
          <Timer className='w-3.5 h-3.5 text-violet-500' />
          <span className='text-xs font-semibold'>Display Timers</span>
        </div>
        <div className='space-y-2'>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <Label className='text-[11px] flex items-center gap-1.5'>
                <Eye className='w-3 h-3 text-sky-500' />
                Quick Preview Duration
              </Label>
              <span className='text-[10px] font-mono text-muted-foreground'>
                {previewDuration === 0 ? 'Always' : `${previewDuration}s`}
              </span>
            </div>
            <Slider
              value={[previewDuration]}
              onValueChange={([v]) => setPreviewDuration(v)}
              min={0}
              max={15}
              step={1}
            />
            <div className='flex justify-between text-[9px] text-muted-foreground/70'>
              <span>Always</span>
              <span>5s</span>
              <span>10s</span>
              <span>15s</span>
            </div>
            <p className='text-[9px] text-muted-foreground'>How long the side preview stays visible after each move.</p>
          </div>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <Label className='text-[11px] flex items-center gap-1.5'>
                <Activity className='w-3 h-3 text-amber-500' />
                Analysis Auto-Collapse
              </Label>
              <span className='text-[10px] font-mono text-muted-foreground'>
                {analysisAutoCollapse === 0 ? 'Always' : `${analysisAutoCollapse}s`}
              </span>
            </div>
            <Slider
              value={[analysisAutoCollapse]}
              onValueChange={([v]) => setAnalysisAutoCollapse(v)}
              min={0}
              max={30}
              step={1}
            />
            <div className='flex justify-between text-[9px] text-muted-foreground/70'>
              <span>Always</span>
              <span>10s</span>
              <span>20s</span>
              <span>30s</span>
            </div>
            <p className='text-[9px] text-muted-foreground'>How long the full analysis panel stays expanded.</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* New Game Button */}
      <Button
        onClick={newGame}
        disabled={!canStart}
        className="w-full gap-2"
        variant={isPlaying ? 'outline' : 'default'}
      >
        <RotateCcw className="w-4 h-4" />
        {isPlaying ? 'Restart Game' : 'New Game'}
      </Button>

      <Separator />

      {/* Training Section */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-xs font-semibold">Quick Train</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Run AI-vs-AI games to build position knowledge.
          Training persists across your games.
        </p>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => runTraining(false)}
            disabled={isTraining}
          >
            {isTraining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Current ({boardSize}x{boardSize})
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => runTraining(true)}
            disabled={isTraining}
          >
            {isTraining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GraduationCap className="w-3.5 h-3.5" />}
            All Sizes
          </Button>
        </div>

        {/* Training status */}
        {isTraining && (
          <div className="flex items-center gap-2 text-xs text-amber-600">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{trainingProgress}</span>
          </div>
        )}

        {/* Training results */}
        {trainingResult && !isTraining && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-emerald-600">
                {trainingProgress}
              </span>
              <button
                onClick={clearTrainingResult}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss results"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border/40 bg-muted/30 p-2 space-y-1">
              {trainingResult.results.map((r, i) => {
                const modeLabel = r.config.gameMode === 'scoring' ? 'Score' : 'Classic';
                const total = r.config.numGames;
                const winRate = total > 0 ? ((r.p1Wins + r.p2Wins) / 2 / total * 100).toFixed(0) : '0';
                return (
                  <div key={i} className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-mono">
                      {r.config.boardSize}x{r.config.boardSize} {modeLabel}
                    </span>
                    <span className="flex items-center gap-2">
                      <span>{r.p1Wins}W-{r.p2Wins}W-{r.draws}D</span>
                      <span className="font-mono">{(r.totalMs / 1000).toFixed(1)}s</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Architecture Info Button */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground gap-1.5"
        onClick={() => setShowArchInfo(true)}
      >
        <Info className="w-3.5 h-3.5" />
        How the AI Works
      </Button>
    </div>
  );
}
