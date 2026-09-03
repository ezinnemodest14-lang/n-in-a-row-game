'use client';

// ============================================================================
// EvalBar — vertical win-probability / score column.
// Colors intentionally match the playing stones on the board:
//   player = emerald gradient (from-emerald-400 to-emerald-600)
//   AI     = near-black gradient (from-gray-700 to-gray-900)
// Track uses a warm parchment tone to sit naturally in the board's wooden
// theme. v2 (user request): BIGGER — wider column (w-12/w-14), taller track
// (fills board height up to 380px), larger stones & type; MORE ACCURATE —
// win percentages shown to one decimal place. Verbosity: AI/YOU labels, live
// percentages, floating eval badge, and a thinking pulse — all without ever
// resizing the layout (no scale, no jiggle: opacity/transform only).
// ============================================================================

import { useGameStore } from '@/store/game-store';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';

// Stone-matched gradients
const PLAYER_GRAD = 'linear-gradient(0deg, #34d399, #047857)';
const AI_GRAD = 'linear-gradient(180deg, #4b5563, #111827)';
// Warm parchment track (board theme)
const TRACK_BG = 'linear-gradient(180deg, #efe6d2, #e6d9bd)';

const SPRING = { type: 'spring' as const, stiffness: 320, damping: 34, mass: 0.7 };

// One-decimal precision, robust to float artifacts (100 - 54.3 → "45.7")
const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

interface EvalBarProps {
  isSidePanelVisible?: boolean;
}

function Dots({ color, label, value, dark }: { color: string; label: string; value: string; dark?: boolean }) {
  return (
    <div className='flex flex-col items-center gap-1 py-1.5'>
      <div className='w-4 h-4 sm:w-5 sm:h-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] ring-1 ring-black/10' style={{ background: color }} />
      <span className={cn('text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider', dark ? 'text-gray-600 dark:text-gray-300' : 'text-emerald-700 dark:text-emerald-400')}>
        {label}
      </span>
      <span className={cn('text-xs sm:text-sm font-mono font-bold leading-none', dark ? 'text-gray-800 dark:text-gray-200' : 'text-emerald-800 dark:text-emerald-300')}>
        {value}
      </span>
    </div>
  );
}

export function EvalBar({ isSidePanelVisible }: EvalBarProps) {
  const { analysis, gameMode, playerScore, aiScore, isThinking, status } = useGameStore();
  const isScoring = gameMode === 'scoring';

  // ---- Score Attack: tug-of-war of points ----
  if (isScoring && playerScore && aiScore) {
    const total = playerScore.total + aiScore.total;
    const playerRatio = total > 0 ? playerScore.total / total : 0.5;
    const aiHeight = (1 - playerRatio) * 100;
    return (
      <div
        className='flex flex-col items-center w-12 sm:w-14 flex-shrink-0 select-none cursor-pointer relative h-full max-h-[380px]'
        title='Score balance — hover for Quick View'
      >
        <Dots color={AI_GRAD} label='AI' value={String(aiScore.total)} dark />
        <div className='w-8 sm:w-10 flex-1 rounded-full relative overflow-visible shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)]' style={{ background: TRACK_BG, minHeight: 160 }}>
          <motion.div className='absolute top-0 left-0 right-0 rounded-t-full' style={{ background: AI_GRAD }} animate={{ height: `${aiHeight}%` }} transition={SPRING} />
          <motion.div className='absolute bottom-0 left-0 right-0 rounded-b-full' style={{ background: PLAYER_GRAD }} animate={{ height: `${playerRatio * 100}%` }} transition={SPRING} />
          <motion.div className='absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-white shadow-md z-10' style={{ background: playerRatio > 0.5 ? '#047857' : '#111827' }} animate={{ bottom: `${playerRatio * 100}%` }} transition={SPRING} />
          <div className='absolute left-1 right-1 top-1/2 h-px bg-white/80 -translate-y-1/2 z-[5]' />
          {isThinking && <PulseDot />}
        </div>
        <Dots color={PLAYER_GRAD} label='You' value={String(playerScore.total)} />
      </div>
    );
  }

  // ---- Classic mode ----
  // TRUTH OVERRIDE: a finished game is a fact, not an estimate. Whatever the
  // analysis payload says, the bar must show the actual result — won → 100%
  // YOU, lost → 0%, draw → 50% (user bug: a WON game displayed 50.0/50.0).
  const terminal = status === 'won' ? 100 : status === 'lost' ? 0 : status === 'draw' ? 50 : null;
  const winProb = terminal ?? (analysis?.winProb ?? 50);
  const evalScore = terminal !== null ? (status === 'draw' ? 0 : terminal) : (analysis?.evalScore ?? 0);
  const aiWinPct = 100 - winProb;

  return (
    <div
      className='flex flex-col items-center w-12 sm:w-14 flex-shrink-0 select-none cursor-pointer relative group h-full max-h-[380px]'
      title='Win probability — hover for Quick View'
    >
      {/* Hover hint (opacity-only — no layout shift, no jiggle) */}
      <div
        className={cn(
          'absolute -left-4 top-1/2 -translate-y-1/2 transition-opacity duration-200 pointer-events-none',
          isSidePanelVisible ? 'opacity-0' : 'opacity-0 group-hover:opacity-70'
        )}
      >
        <Eye className='w-3 h-3 text-amber-800/80' />
      </div>

      <Dots color={AI_GRAD} label='AI' value={`${fmt1(aiWinPct)}%`} dark />
      <div className='w-8 sm:w-10 flex-1 rounded-full relative overflow-visible shadow-[inset_0_1px_3px_rgba(0,0,0,0.12)]' style={{ background: TRACK_BG, minHeight: 160 }}>
        <motion.div className='absolute top-0 left-0 right-0 rounded-t-full' style={{ background: AI_GRAD }} animate={{ height: `${aiWinPct}%` }} transition={SPRING} />
        <motion.div className='absolute bottom-0 left-0 right-0 rounded-b-full' style={{ background: PLAYER_GRAD }} animate={{ height: `${winProb}%` }} transition={SPRING} />
        <motion.div className='absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-white shadow-md z-10' style={{ background: winProb > 50 ? '#047857' : '#111827' }} animate={{ bottom: `${winProb}%` }} transition={SPRING} />
        {/* Floating eval badge */}
        {analysis && (
          <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10'>
            <span
              className={cn(
                'text-[11px] sm:text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#fffdf7]/95 shadow-sm border border-amber-900/10 whitespace-nowrap',
                evalScore > 3 ? 'text-emerald-700' : evalScore < -3 ? 'text-gray-800' : 'text-amber-700'
              )}
            >
              {evalScore > 0 ? `+${Number.isInteger(evalScore) ? evalScore : fmt1(evalScore)}` : Number.isInteger(evalScore) ? evalScore : fmt1(evalScore)}
            </span>
          </div>
        )}
        <div className='absolute left-1 right-1 top-1/2 h-px bg-white/80 -translate-y-1/2 z-[5]' />
        {isThinking && <PulseDot />}
      </div>
      <Dots color={PLAYER_GRAD} label='You' value={`${fmt1(winProb)}%`} />
    </div>
  );
}

function PulseDot() {
  return (
    <div className='absolute inset-0 flex items-center justify-center pointer-events-none z-10'>
      <div className='w-2 h-2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)] animate-pulse' />
    </div>
  );
}
