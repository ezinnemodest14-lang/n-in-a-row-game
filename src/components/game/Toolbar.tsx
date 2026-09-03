'use client';

import { useGameStore } from '@/store/game-store';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  BrainCircuit,
  RotateCcw,
  Settings,
  BarChart3,
  Info,
  Repeat,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolbarProps {
  onOpenSettings: () => void;
  onOpenStats: () => void;
}

/**
 * Reusable toolbar button with proper accessible tooltip.
 * Tooltip triggers on hover (mouse) AND focus (keyboard) per WCAG.
 * aria-label matches tooltip text for voice-input users (SC 2.5.3).
 */
function TButton({
  tooltip,
  children,
  ...btnProps
}: React.ComponentProps<typeof Button> & { tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...btnProps}
          aria-label={tooltip}
          title={tooltip}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function Toolbar({ onOpenSettings, onOpenStats }: ToolbarProps) {
  const {
    gameMode,
    setGameMode,
    autoMode,
    setAutoMode,
    newGame,
    isThinking,
    status,
    setShowArchInfo,
  } = useGameStore();

  const canStart = !isThinking;
  const isPlaying = status === 'playing';

  return (
    <header className="border-b border-border/40 bg-white/70 backdrop-blur-sm flex-shrink-0 z-20">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 h-11 flex items-center justify-between gap-1.5">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-sm">
            <BrainCircuit className="w-4 h-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold tracking-tight leading-none">
              N-in-a-Row
            </h1>
            <p className="text-[9px] text-muted-foreground leading-tight mt-0.5">
              MCTS + RAVE AI
            </p>
          </div>
        </div>

        {/* Center: Mode Toggle — click-based segmented control */}
        <ToggleGroup
          type="single"
          value={gameMode}
          onValueChange={(v) => v && setGameMode(v as 'classic' | 'scoring')}
          className="bg-muted/60 rounded-lg p-0.5"
        >
          <ToggleGroupItem
            value="classic"
            aria-label="Classic mode"
            className="text-[11px] sm:text-xs px-2.5 sm:px-3 h-7 rounded-md data-[state=on]:bg-white data-[state=on]:shadow-sm data-[state=on]:text-foreground font-medium"
          >
            Classic
          </ToggleGroupItem>
          <ToggleGroupItem
            value="scoring"
            aria-label="Score Attack mode"
            className="text-[11px] sm:text-xs px-2.5 sm:px-3 h-7 rounded-md data-[state=on]:bg-white data-[state=on]:shadow-sm data-[state=on]:text-foreground font-medium"
          >
            <span className="hidden xs:inline">Score </span>Attack
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Right: Action Buttons — each with accessible tooltip + visible label */}
        <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
          {/* New Game — uses RotateCcw (single circular arrow) */}
          <TButton
            tooltip="New Game"
            variant={isPlaying ? 'outline' : 'default'}
            size="sm"
            onClick={newGame}
            disabled={!canStart}
            className="h-7 gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">New Game</span>
          </TButton>

          {/* Auto Mode — uses Repeat (rectangular cycle arrows), visually distinct from New Game */}
          <TButton
            tooltip={autoMode ? 'Auto Mode: On' : 'Auto Mode: Off'}
            variant={autoMode ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setAutoMode(!autoMode)}
            aria-pressed={autoMode}
            className={cn(
              'h-7 gap-1.5',
              autoMode && 'bg-amber-500 hover:bg-amber-600 text-white'
            )}
          >
            <Repeat
              className={cn('w-3.5 h-3.5', autoMode && 'animate-spin')}
              style={{ animationDuration: '3s' }}
            />
            <span className="hidden sm:inline text-[11px]">Auto</span>
          </TButton>

          {/* Settings — gear icon */}
          <TButton
            tooltip="Settings"
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            className="h-7 w-7 p-0"
          >
            <Settings className="w-4 h-4" />
          </TButton>

          {/* Stats — chart icon */}
          <TButton
            tooltip="Stats & History"
            variant="ghost"
            size="sm"
            onClick={onOpenStats}
            className="h-7 w-7 p-0"
          >
            <BarChart3 className="w-4 h-4" />
          </TButton>

          {/* Info — i-circle icon */}
          <TButton
            tooltip="How the AI Works"
            variant="ghost"
            size="sm"
            onClick={() => setShowArchInfo(true)}
            className="h-7 w-7 p-0"
          >
            <Info className="w-4 h-4" />
          </TButton>
        </div>
      </div>
    </header>
  );
}
