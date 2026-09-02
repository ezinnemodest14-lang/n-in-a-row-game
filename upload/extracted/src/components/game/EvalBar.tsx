'use client';

import { useGameStore } from '@/store/game-store';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';

const PLAYER_GRAD = 'linear-gradient(0deg, #34d399, #059669)';
const AI_GRAD = 'linear-gradient(180deg, #475569, #1e293b)';
const TRACK_BG = '#e2e2e2';

interface EvalBarProps {
  isSidePanelVisible?: boolean;
}

export function EvalBar({ isSidePanelVisible }: EvalBarProps) {
  const { analysis, gameMode, playerScore, aiScore, isThinking } = useGameStore();
  const isScoring = gameMode === 'scoring';

  if (isScoring && playerScore && aiScore) {
    const total = playerScore.total + aiScore.total;
    const playerRatio = total > 0 ? playerScore.total / total : 0.5;
    const aiHeight = (1 - playerRatio) * 100;
    return (
      <div className={cn('flex flex-col items-center w-8 flex-shrink-0 select-none cursor-pointer relative transition-all duration-200', isSidePanelVisible && 'scale-105')}>
        <div className='flex items-center gap-1.5 pb-1.5'>
          <div className='w-3.5 h-3.5 rounded-full shadow-sm' style={{ background: AI_GRAD }} />
          <span className='text-[11px] font-mono font-bold text-slate-700'>{aiScore.total}</span>
        </div>
        <div className='w-7 flex-1 rounded-full relative overflow-visible' style={{ background: TRACK_BG, minHeight: 120 }}>
          <motion.div className='absolute top-0 left-0 right-0 rounded-t-full' style={{ background: AI_GRAD }} animate={{ height: `${aiHeight}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} />
          <motion.div className='absolute bottom-0 left-0 right-0 rounded-b-full' style={{ background: PLAYER_GRAD }} animate={{ height: `${playerRatio * 100}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} />
          <motion.div className='absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-md z-10' style={{ background: playerRatio > 0.5 ? '#059669' : '#475569' }} animate={{ bottom: `${playerRatio * 100}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} />
          <div className='absolute left-1 right-1 top-1/2 h-px bg-white/70 -translate-y-1/2 z-5' />
        </div>
        <div className='flex items-center gap-1.5 pt-1.5'>
          <div className='w-3.5 h-3.5 rounded-full shadow-sm' style={{ background: PLAYER_GRAD }} />
          <span className='text-[11px] font-mono font-bold text-emerald-700'>{playerScore.total}</span>
        </div>
      </div>
    );
  }

  if (!analysis) {
    if (isThinking) {
      return (
        <div className='flex flex-col items-center w-8 flex-shrink-0 select-none opacity-30 animate-pulse'>
          <div className='flex items-center gap-1.5 pb-1.5'>
            <div className='w-3.5 h-3.5 rounded-full' style={{ background: AI_GRAD }} />
            <span className='text-[11px] font-mono font-bold text-slate-400'>50%</span>
          </div>
          <div className='w-7 flex-1 rounded-full relative' style={{ background: TRACK_BG, minHeight: 120 }}>
            <div className='absolute top-0 left-0 right-0 h-1/2 rounded-t-full' style={{ background: AI_GRAD, opacity: 0.4 }} />
            <div className='absolute bottom-0 left-0 right-0 h-1/2 rounded-b-full' style={{ background: PLAYER_GRAD, opacity: 0.4 }} />
          </div>
          <div className='flex items-center gap-1.5 pt-1.5'>
            <div className='w-3.5 h-3.5 rounded-full' style={{ background: PLAYER_GRAD }} />
            <span className='text-[11px] font-mono font-bold text-emerald-400'>50%</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const { winProb, evalScore } = analysis;
  const aiWinPct = 100 - winProb;

  return (
    <div className={cn('flex flex-col items-center w-8 flex-shrink-0 select-none cursor-pointer relative group transition-all duration-200', isSidePanelVisible && 'scale-105')}>
      {/* Hover hint eye icon */}
      <div className={cn('absolute -left-4 top-1/2 -translate-y-1/2 transition-all duration-200 pointer-events-none', isSidePanelVisible ? 'opacity-0 -left-2' : 'opacity-0 group-hover:opacity-60')}>
        <Eye className='w-3 h-3 text-muted-foreground' />
      </div>

      <div className='flex items-center gap-1.5 pb-1.5'>
        <div className='w-3.5 h-3.5 rounded-full shadow-sm' style={{ background: AI_GRAD }} />
        <span className='text-[11px] font-mono font-bold text-slate-700'>{aiWinPct}%</span>
      </div>
      <div className='w-7 flex-1 rounded-full relative overflow-visible' style={{ background: TRACK_BG, minHeight: 120 }}>
        <motion.div className='absolute top-0 left-0 right-0 rounded-t-full' style={{ background: AI_GRAD }} animate={{ height: `${aiWinPct}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} />
        <motion.div className='absolute bottom-0 left-0 right-0 rounded-b-full' style={{ background: PLAYER_GRAD }} animate={{ height: `${winProb}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} />
        <motion.div className='absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow-md z-10' style={{ background: winProb > 50 ? '#059669' : '#475569' }} animate={{ bottom: `${winProb}%` }} transition={{ type: 'spring', stiffness: 180, damping: 24 }} />
        <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10'>
          <span className={cn('text-[8px] font-mono font-bold px-1 py-0.5 rounded-full bg-white/90 shadow-sm whitespace-nowrap', evalScore > 3 ? 'text-emerald-700' : evalScore < -3 ? 'text-slate-700' : 'text-amber-600')}>
            {evalScore > 0 ? `+${evalScore}` : evalScore}
          </span>
        </div>
        <div className='absolute left-1 right-1 top-1/2 h-px bg-white/70 -translate-y-1/2 z-5' />
      </div>
      <div className='flex items-center gap-1.5 pt-1.5'>
        <div className='w-3.5 h-3.5 rounded-full shadow-sm' style={{ background: PLAYER_GRAD }} />
        <span className='text-[11px] font-mono font-bold text-emerald-700'>{winProb}%</span>
      </div>
    </div>
  );
}
