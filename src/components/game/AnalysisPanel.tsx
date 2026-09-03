'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { cn } from '@/lib/utils';
import {
  Brain, Zap, Shield, BarChart3, Target, Timer, BookOpen, GitBranch,
  ChevronUp, ChevronDown, TrendingUp, Eye, Lightbulb, AlertTriangle,
  Award, Clock, Activity, Layers, Sparkles, Info, Crosshair,
  Map, Sword, Gauge, CheckCircle2, History, MessageSquare,
  Trophy, Minus, Loader2
} from 'lucide-react';
import { coordLabel } from '@/lib/game/threat-classifier';
import type { PlayerBestMove, ScoringAnalysis, CriticalSquare } from '@/lib/game/threat-classifier';
import { motion, AnimatePresence } from 'framer-motion';

const PLAYER_DOT = 'bg-gradient-to-br from-emerald-400 to-emerald-600';
const AI_DOT = 'bg-gradient-to-br from-slate-600 to-slate-800';

function AcrylicCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white/60 backdrop-blur-2xl border border-white/40 rounded-2xl shadow-xl', className)}>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, badge, accent }: {
  icon: React.ElementType; title: string; badge?: React.ReactNode; accent?: string;
}) {
  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-1.5'>
        <Icon className={cn('w-3.5 h-3.5', accent || 'text-muted-foreground')} />
        <span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>{title}</span>
      </div>
      {badge}
    </div>
  );
}

function Collapsible({ title, icon: Icon, accent, children, defaultOpen = true, badge }: {
  title: string; icon: React.ElementType; accent?: string;
  children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className='space-y-1.5'>
      <button
        onClick={() => setOpen(!open)}
        className='flex items-center justify-between w-full group cursor-pointer'
        aria-expanded={open}
      >
        <SectionHeader icon={Icon} title={title} accent={accent} badge={badge} />
        <span className='text-muted-foreground group-hover:text-foreground transition-colors'>
          {open ? <ChevronUp className='w-3.5 h-3.5' /> : <ChevronDown className='w-3.5 h-3.5' />}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='overflow-hidden'
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayerMoveRow({ m, boardSize }: { m: PlayerBestMove; boardSize: number }) {
  return (
    <div className='flex items-center gap-2 text-[11px] py-0.5'>
      <span className='font-mono font-bold text-emerald-700 w-8 shrink-0'>{coordLabel(m.row, m.col, boardSize)}</span>
      <span className='flex-1 text-foreground/70 truncate'>{m.description}</span>
      {m.isFork && (
        <span className='inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full'>
          <Zap className='w-2.5 h-2.5' /> Fork
        </span>
      )}
    </div>
  );
}

function AiMoveRow({ move, maxVisits, isBest, boardSize }: {
  move: { row: number; col: number; visits: number; winRate: number; raveRate: number };
  maxVisits: number; isBest?: boolean; boardSize: number;
}) {
  const barPct = maxVisits > 0 ? Math.min(100, (move.visits / maxVisits) * 100) : 0;
  return (
    <div className={cn('flex items-center gap-2 text-[11px] py-0.5', isBest && 'bg-amber-50/50 -mx-1.5 px-1.5 rounded')}>
      <span className='font-mono font-bold text-slate-600 w-8 shrink-0'>{coordLabel(move.row, move.col, boardSize)}</span>
      <div className='flex-1 h-2 bg-slate-100 rounded-full overflow-hidden'>
        <motion.div className='h-full rounded-full' style={{ background: 'linear-gradient(90deg, #475569, #64748b)' }} initial={{ width: 0 }} animate={{ width: `${barPct}%` }} transition={{ duration: 0.4 }} />
      </div>
      <span className='font-mono text-muted-foreground w-11 text-right shrink-0 text-[10px]'>
        {move.winRate.toFixed(0)}%<span className='text-muted-foreground/50'> w</span>
      </span>
    </div>
  );
}

function ThreatDisplay({ label, counts, playerColor }: { label: string; counts: Record<string, number>; playerColor: 'player' | 'ai' }) {
  const entries = Object.entries(counts);
  const dotClass = playerColor === 'player' ? PLAYER_DOT : AI_DOT;
  const textColor = playerColor === 'player' ? 'text-emerald-600' : 'text-slate-600';
  const totalThreats = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-1.5'>
        <div className={cn('w-2 h-2 rounded-full', dotClass)} />
        <span className={cn('text-[10px] font-semibold', textColor)}>{label}</span>
        <span className={cn('text-[9px] font-mono font-bold ml-auto', totalThreats > 0 ? 'text-foreground/60' : 'text-muted-foreground')}>{totalThreats} total</span>
      </div>
      {entries.length === 0 ? (
        <p className='text-[10px] text-muted-foreground italic ml-3.5'>No active threats detected. Position is stable.</p>
      ) : (
        <div className='flex flex-wrap gap-1 ml-3.5'>
          {entries.map(([name, count]) => {
            const severity = name.includes('Five') ? 'bg-red-100 text-red-700 border-red-200'
              : name.includes('Four') ? 'bg-amber-100 text-amber-700 border-amber-200'
              : name.includes('Three') ? 'bg-sky-100 text-sky-700 border-sky-200'
              : 'bg-muted text-muted-foreground border-border/50';
            return (
              <span key={name} className={cn('inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md border font-medium', severity)}>
                {name} <span className='font-mono font-bold'>{count}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoringSection({ sa }: { sa: ScoringAnalysis }) {
  const totalScore = sa.playerTotal + sa.aiTotal;
  const playerPct = totalScore > 0 ? (sa.playerTotal / totalScore) * 100 : 50;
  const isLeading = sa.diff > 0;
  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-3'>
        <span className={cn('text-lg font-mono font-bold', isLeading ? 'text-emerald-600' : 'text-muted-foreground')}>{sa.playerTotal}</span>
        <div className='flex-1 h-3 bg-slate-100 rounded-full overflow-hidden relative'>
          <motion.div className={cn('h-full rounded-full', isLeading ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-slate-400 to-slate-500')} animate={{ width: `${playerPct}%` }} transition={{ type: 'spring', stiffness: 100, damping: 18 }} />
          <div className='absolute left-1/2 top-0 bottom-0 w-px bg-white/80 -translate-x-1/2' />
        </div>
        <span className={cn('text-lg font-mono font-bold', !isLeading && totalScore > 0 ? 'text-slate-700' : 'text-muted-foreground')}>{sa.aiTotal}</span>
      </div>
      <div className='grid grid-cols-3 gap-1.5 text-center'>
        <div className='bg-white/40 rounded-lg p-1.5'>
          <div className='text-[9px] text-muted-foreground'>Fill</div>
          <div className='text-[11px] font-mono font-bold'>{sa.boardFillPct}%</div>
        </div>
        <div className='bg-white/40 rounded-lg p-1.5'>
          <div className='text-[9px] text-muted-foreground'>Pace</div>
          <div className='text-[11px] font-mono font-bold'>
            <span className={sa.playerPace > sa.aiPace ? 'text-emerald-600' : ''}>{sa.playerPace}</span>
            <span className='text-muted-foreground/40'>/</span>
            <span className={sa.aiPace > sa.playerPace ? 'text-slate-600' : ''}>{sa.aiPace}</span>
          </div>
        </div>
        <div className='bg-white/40 rounded-lg p-1.5'>
          <div className='text-[9px] text-muted-foreground'>Proj</div>
          <div className='text-[11px] font-mono font-bold'>
            <span className={sa.projectedPlayerFinal > sa.projectedAiFinal ? 'text-emerald-600' : ''}>{sa.projectedPlayerFinal}</span>
            <span className='text-muted-foreground/40'>/</span>
            <span className={sa.projectedAiFinal > sa.projectedPlayerFinal ? 'text-slate-600' : ''}>{sa.projectedAiFinal}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesSection() {
  const { winLength, boardSize, gameMode } = useGameStore();
  const isScoring = gameMode === 'scoring';
  return (
    <div className='space-y-2 text-[11px] text-foreground/70 leading-relaxed'>
      <div className='flex items-start gap-2 bg-amber-50/60 rounded-lg p-2'>
        <Target className='w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0' />
        <div>
          <span className='font-semibold text-foreground/90'>Objective: </span>
          Place <span className='font-bold text-amber-600'>{winLength} stones in a row</span> (horizontal, vertical, or diagonal) to win.
        </div>
      </div>
      {isScoring && (
        <div className='flex items-start gap-2 bg-emerald-50/60 rounded-lg p-2'>
          <Award className='w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0' />
          <div>
            <span className='font-semibold text-foreground/90'>Score Attack: </span>
            Even without winning, you earn points — +1 per triple, +5 per four, +15 per five-in-a-row, +10 for a full row or column, +20 for a full diagonal, +3 for a cross pattern (one stone completing a horizontal AND vertical three at once), +2 for breaking an opponent line of 3 or more. Highest score wins when the board is full.
          </div>
        </div>
      )}
      <div className='flex items-start gap-2 bg-sky-50/60 rounded-lg p-2'>
        <Layers className='w-3.5 h-3.5 text-sky-500 mt-0.5 shrink-0' />
        <div>
          <span className='font-semibold text-foreground/90'>Board: </span>
          {boardSize}×{boardSize} grid ({boardSize * boardSize} positions). Each player takes turns placing one stone.
        </div>
      </div>
    </div>
  );
}

function PatternSection() {
  const { analysis, lastLearning, learningHistory } = useGameStore();
  if (!analysis && !lastLearning) return null;
  const totalPositions = learningHistory?.reduce((s, l) => s + l.globalRaveTotalVisits, 0) ?? 0;
  const coverage = lastLearning?.globalRaveCoverage ?? 0;
  const bestRate = lastLearning?.bestMoveWinRate ?? 0;
  const raveBeta = lastLearning?.raveBeta ?? 1;
  const treeReused = lastLearning?.treeReused ?? false;
  const treeNodes = lastLearning?.totalTreeNodes ?? 0;
  return (
    <div className='space-y-2'>
      <div className='space-y-1'>
        <div className='flex items-center justify-between text-[10px]'>
          <span className='text-muted-foreground'>Positions explored</span>
          <span className='font-mono font-bold'>{(coverage * 100).toFixed(1)}%</span>
        </div>
        <div className='h-2 bg-slate-100 rounded-full overflow-hidden'>
          <motion.div className='h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full' animate={{ width: `${Math.min(100, coverage * 100)}%` }} transition={{ duration: 0.5 }} />
        </div>
        <div className='text-[9px] text-muted-foreground'>{totalPositions.toLocaleString()} total learned entries across all games played.</div>
      </div>
      <div className='grid grid-cols-2 gap-1.5'>
        <div className='bg-white/40 rounded-lg p-2 text-center'>
          <div className='text-[9px] text-muted-foreground'>Best RAVE Rate</div>
          <div className='text-xs font-mono font-bold'>{(bestRate * 100).toFixed(1)}%</div>
          <div className='text-[8px] text-muted-foreground'>Historical win rate of best move pattern</div>
        </div>
        <div className='bg-white/40 rounded-lg p-2 text-center'>
          <div className='text-[9px] text-muted-foreground'>RAVE Influence</div>
          <div className='text-xs font-mono font-bold'>{(raveBeta * 100).toFixed(0)}%</div>
          <div className='text-[8px] text-muted-foreground'>How much prior knowledge guides this move</div>
        </div>
        <div className='bg-white/40 rounded-lg p-2 text-center'>
          <div className='text-[9px] text-muted-foreground'>Tree Reuse</div>
          <div className={cn('text-xs font-bold', treeReused ? 'text-emerald-600' : 'text-amber-600')}>{treeReused ? 'Yes' : 'No'}</div>
          <div className='text-[8px] text-muted-foreground'>{treeReused ? 'Previous tree carried forward' : 'Fresh search tree built'}</div>
        </div>
        <div className='bg-white/40 rounded-lg p-2 text-center'>
          <div className='text-[9px] text-muted-foreground'>Tree Size</div>
          <div className='text-xs font-mono font-bold'>{treeNodes.toLocaleString()}</div>
          <div className='text-[8px] text-muted-foreground'>Total nodes in search tree</div>
        </div>
      </div>
    </div>
  );
}

function MoveReasoning() {
  const { analysis, moveHistory, boardSize } = useGameStore();
  if (!analysis || moveHistory.length < 2) return null;
  const lastMove = moveHistory[moveHistory.length - 1];
  const colLabel = String.fromCharCode(65 + (lastMove.col >= 8 ? lastMove.col + 1 : lastMove.col));
  const rowLabel = boardSize - lastMove.row;
  const isPlayer = lastMove.player === 1;
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-2'>
        <div className={cn('w-3 h-3 rounded-full shadow-sm', isPlayer ? PLAYER_DOT : AI_DOT)} />
        <span className='text-[11px] font-medium'>
          {isPlayer ? 'You' : 'AI'} played <span className='font-mono font-bold'>{colLabel}{rowLabel}</span>
          {lastMove.pointsScored != null && lastMove.pointsScored > 0 && (
            <span className='inline-flex items-center ml-1.5 text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full'>+{lastMove.pointsScored} pts</span>
          )}
        </span>
      </div>
      {analysis.aiReasoning && (
        <p className='text-[11px] text-foreground/70 leading-relaxed pl-5 italic'>{analysis.aiReasoning}</p>
      )}
    </div>
  );
}

function MoveTimeline() {
  const { moveHistory, boardSize, playerPiece, analysis } = useGameStore();
  if (moveHistory.length < 2) return null;

  // Show last 8 moves, newest first
  const recent = moveHistory.slice(-8).reverse();
  const totalCells = boardSize * boardSize;

  return (
    <div className='space-y-1'>
      {recent.map((m, i) => {
        const isPlayer = m.player === playerPiece;
        const moveNum = moveHistory.length - i;
        const phase = moveNum <= totalCells * 0.15 ? 'Opening' : moveNum <= totalCells * 0.5 ? 'Midgame' : 'Endgame';
        const isLast = i === 0;
        return (
          <div key={moveNum} className={cn('flex items-center gap-2 text-[10px] py-1 px-1.5 rounded-lg', isLast ? 'bg-amber-50/60 border border-amber-200/50' : 'hover:bg-white/40 transition-colors')}>
            <span className='text-muted-foreground font-mono w-5 text-right shrink-0'>#{moveNum}</span>
            <div className={cn('w-2 h-2 rounded-full shrink-0', isPlayer ? PLAYER_DOT : AI_DOT)} />
            <span className='text-muted-foreground w-3 shrink-0'>{isPlayer ? 'You' : 'AI'}</span>
            <span className='font-mono font-bold w-7 shrink-0'>{coordLabel(m.row, m.col, boardSize)}</span>
            {m.pointsScored != null && m.pointsScored > 0 && (
              <span className='text-amber-600 font-mono text-[9px] bg-amber-50 px-1 rounded'>+{m.pointsScored}</span>
            )}
            <span className='text-[8px] text-muted-foreground/60 ml-auto shrink-0'>{phase}</span>
            {isLast && <div className='w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0' />}
          </div>
        );
      })}
    </div>
  );
}

function StrategicNarrative() {
  const { analysis, moveHistory, boardSize, playerPiece, lastLearning } = useGameStore();
  if (!analysis) return null;

  const { evalScore, winProb, playerThreats, aiThreats, playerBestMoves, criticalSquares, boardControl, tempo } = analysis;
  const mq = analysis.moveQuality || 'optimal';
  const bc = boardControl || { playerInfluence: 0, aiInfluence: 0, contested: 0, totalCells: 0 };
  const tp = tempo || { playerInitiative: 0, aiInitiative: 0, urgency: 'none' as const };
  const sqs = criticalSquares || [];

  const totalCells = boardSize * boardSize;
  const played = moveHistory.length;
  const fillPct = Math.round((played / totalCells) * 100);
  const phase = played < totalCells * 0.15 ? 'opening' : played < totalCells * 0.5 ? 'midgame' : 'endgame';

  const pFours = (playerThreats.OpenFour || 0) + (playerThreats.HalfOpenFour || 0);
  const pThrees = (playerThreats.OpenThree || 0) + (playerThreats.HalfOpenThree || 0);
  const aFours = (aiThreats.OpenFour || 0) + (aiThreats.HalfOpenFour || 0);
  const aThrees = (aiThreats.OpenThree || 0) + (aiThreats.HalfOpenThree || 0);

  const ctrlTotal = bc.totalCells > 0 ? bc.totalCells : 1;
  const pCtrlPct = Math.round((bc.playerInfluence / ctrlTotal) * 100);
  const aCtrlPct = Math.round((bc.aiInfluence / ctrlTotal) * 100);

  const sentences: string[] = [];

  // Phase and fill
  sentences.push(`Move ${played} of ${totalCells} (${fillPct}% filled). ${phase === 'opening' ? 'Early game — center control and pattern foundations are being laid.' : phase === 'midgame' ? 'Midgame — threats are developing and tactical decisions are critical.' : 'Endgame — the board is filling up; converting patterns to points is key.'}`);

  // Position eval
  if (evalScore > 5) sentences.push('You have a commanding position with strong pattern development. The AI is on the defensive.');
  else if (evalScore > 2) sentences.push('You hold a moderate advantage. Your patterns are developing well, but stay alert to AI counter-play.');
  else if (evalScore > -2) sentences.push('The position is evenly balanced. Both sides have comparable development and opportunities.');
  else if (evalScore > -5) sentences.push('The AI has gained a slight edge. Focus on building connections and disrupting AI patterns.');
  else sentences.push('The AI has a significant advantage. Prioritize blocking threats and look for tactical counter-attacks.');

  // Threat landscape
  if (pFours > 0 || pThrees > 0) {
    const details: string[] = [];
    if (pFours > 0) details.push(`${pFours} four-in-a-row threat${pFours > 1 ? 's' : ''}`);
    if (pThrees > 0) details.push(`${pThrees} three-in-a-row pattern${pThrees > 1 ? 's' : ''}`);
    sentences.push(`Your offensive position includes ${details.join(' and ')}. ${pFours > 0 ? 'These four-threats demand immediate AI response, giving you initiative.' : 'These patterns can be extended into winning threats with careful play.'}`);
  }

  if (aFours > 0 || aThrees > 0) {
    const details: string[] = [];
    if (aFours > 0) details.push(`${aFours} four-threat${aFours > 1 ? 's' : ''}`);
    if (aThrees > 0) details.push(`${aThrees} three-pattern${aThrees > 1 ? 's' : ''}`);
    sentences.push(`The AI is building ${details.join(' and ')}. ${aFours > 0 ? 'Four-threats must be blocked immediately or the game is lost.' : 'Monitor these for potential escalation to four-threats next move.'}`);
  }

  // Board control
  if (pCtrlPct > 60) sentences.push('You dominate board influence, controlling the majority of key positions.');
  else if (aCtrlPct > 60) sentences.push('The AI controls more board territory. Try to contest key zones and build connections in contested areas.');
  else if (bc.contested / ctrlTotal > 0.3) sentences.push('A large portion of the board is contested. Every move here shifts the balance significantly.');

  // Tempo
  if (tp.urgency === 'critical') sentences.push('CRITICAL: The AI has imminent winning threats. You MUST block now or lose the game.');
  else if (tp.urgency === 'defend') sentences.push('Defensive posture recommended. Block AI patterns before pressing your own attacks.');
  else if (tp.urgency === 'attack') sentences.push('Attack window open! Your threats are strong enough to pressure the AI into defensive moves.');

  // Recommendation
  if (playerBestMoves.length > 0) {
    const best = playerBestMoves[0];
    sentences.push(`Recommended move: ${coordLabel(best.row, best.col, boardSize)} — ${best.description}${best.isFork ? ' (creates a fork — two threats at once!)' : ''}.`);
  }

  // Critical squares
  const vitalForAi = sqs.filter(s => s.severity === 'vital' && s.forPlayer === 'ai');
  if (vitalForAi.length > 0) {
    sentences.push(`Vital defensive squares: ${vitalForAi.map(s => `${coordLabel(s.row, s.col, boardSize)} (${s.reason})`).join(', ')}.`);
  }

  return (
    <div className='space-y-2'>
      <div className='bg-gradient-to-br from-amber-50/80 to-sky-50/40 rounded-xl p-3 border border-amber-100/50'>
        <div className='flex items-start gap-2'>
          <MessageSquare className='w-4 h-4 text-amber-500 mt-0.5 shrink-0' />
          <div className='space-y-1.5'>
            {sentences.map((s, i) => (
              <p key={i} className='text-[11px] text-foreground/75 leading-relaxed'>{s}</p>
            ))}
          </div>
        </div>
      </div>
      {/* Phase indicator badges */}
      <div className='flex items-center gap-2 flex-wrap'>
        <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full border',
          phase === 'opening' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
          phase === 'midgame' ? 'bg-amber-50 text-amber-700 border-amber-200' :
          'bg-red-50 text-red-700 border-red-200'
        )}>{phase === 'opening' ? '🌱 Opening' : phase === 'midgame' ? '⚔️ Midgame' : '🏁 Endgame'}</span>
        <span className='text-[9px] text-muted-foreground'>{fillPct}% board filled</span>
        <span className='text-[9px] text-muted-foreground'>{pCtrlPct}% vs {aCtrlPct}% control</span>
        <span className='text-[9px] text-muted-foreground'>{(pThrees + pFours)} vs {(aThrees + aFours)} active threats</span>
      </div>
    </div>
  );
}

// ==================================================
// MAIN ANALYSIS PANEL (no hover/overlay — flow element)
// ==================================================

export function AnalysisPanel() {
  const { analysis, boardSize, gameMode, lastStats, moveHistory, playerPiece } = useGameStore();
  const isScoring = gameMode === 'scoring';

  // When used standalone (not inside BottomPanel), show as before
  if (!analysis) return null;

  const {
    evalScore, winProb, assessment, aiReasoning, playerBestMoves,
    aiCandidateMoves, playerThreats, aiThreats, scoringAnalysis,
    moveQuality, criticalSquares, boardControl, tempo,
  } = analysis;

  const mq = moveQuality || 'optimal';
  const sqs = criticalSquares || [];
  const bc = boardControl || { playerInfluence: 0, aiInfluence: 0, contested: 0, totalCells: 0 };
  const tp = tempo || { playerInitiative: 0, aiInitiative: 0, urgency: 'none' as const };

  const maxVisits = aiCandidateMoves.length > 0 ? aiCandidateMoves[0].visits : 1;
  const evalColor = evalScore > 3 ? 'text-emerald-600' : evalScore < -3 ? 'text-slate-600' : 'text-amber-600';
  const thinkTime = lastStats ? (lastStats.thinkTimeMs / 1000).toFixed(1) : '—';
  const speed = lastStats && lastStats.thinkTimeMs > 0
    ? (lastStats.simulations / (lastStats.thinkTimeMs / 1000)).toFixed(0) : '—';

  const qualityConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    optimal: { label: 'Optimal', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
    strong: { label: 'Strong', color: 'text-sky-600 bg-sky-50 border-sky-200', icon: TrendingUp },
    alternative: { label: 'Alternative', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: GitBranch },
    tactical: { label: 'Tactical Override', color: 'text-violet-600 bg-violet-50 border-violet-200', icon: Shield },
  };
  const q = qualityConfig[mq] || qualityConfig.optimal;
  const QualityIcon = q.icon;

  const urgencyConfig: Record<string, { label: string; color: string; desc: string }> = {
    none: { label: 'Calm', color: 'text-muted-foreground bg-muted/50', desc: 'No immediate threats. Develop your position freely and build connected patterns toward the center.' },
    attack: { label: 'Attack Window', color: 'text-emerald-600 bg-emerald-50', desc: 'Strong threats are in play. Press the advantage — extend your patterns and force the AI into defensive moves.' },
    defend: { label: 'Defense Needed', color: 'text-amber-600 bg-amber-50', desc: 'The AI has developing threats that could escalate. Prioritize blocking while looking for counter-attacking opportunities.' },
    critical: { label: 'Critical Defense', color: 'text-red-600 bg-red-50', desc: 'The AI has imminent winning threats (four-in-a-row or open four). You must block immediately or the game is lost.' },
  };
  const u = urgencyConfig[tp.urgency] || urgencyConfig.none;

  const ctrlTotal = bc.totalCells > 0 ? bc.totalCells : 1;
  const pCtrlPct = Math.round((bc.playerInfluence / ctrlTotal) * 100);
  const aCtrlPct = Math.round((bc.aiInfluence / ctrlTotal) * 100);
  const contestedPct = 100 - pCtrlPct - aCtrlPct;

  const lastMoveEntry = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;

  return (
    <AcrylicCard className='p-3 space-y-3'>
      {/* 1. Strategic Narrative — NEW verbose overview */}
      <Collapsible title='Strategic Overview' icon={MessageSquare} accent='text-amber-500' defaultOpen={false}
        badge={<span className={cn('text-[10px] font-mono font-bold', evalColor)}>{evalScore > 0 ? `+${evalScore}` : evalScore}</span>}
      >
        <StrategicNarrative />
      </Collapsible>

      {/* 2. Position Evaluation */}
      <Collapsible title='Position Evaluation' icon={Activity} accent='text-amber-500' defaultOpen={false}
        badge={<span className={cn('text-xs font-mono font-bold', evalColor)}>{evalScore > 0 ? `+${evalScore}` : evalScore}</span>}
      >
        <div className='space-y-1.5'>
          <div className='flex items-baseline gap-2'>
            <span className={cn('text-2xl font-mono font-bold', evalColor)}>{evalScore > 0 ? `+${evalScore}` : evalScore}</span>
            <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', winProb > 55 ? 'bg-emerald-100 text-emerald-700' : winProb < 45 ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-700')}>{assessment}</span>
          </div>
          <div className='flex items-center gap-2 h-3 bg-slate-100 rounded-full overflow-hidden'>
            <motion.div className='h-full rounded-full' style={{ background: 'linear-gradient(90deg, #34d399, #059669)' }} animate={{ width: `${winProb}%` }} transition={{ type: 'spring', stiffness: 100, damping: 18 }} />
          </div>
          <div className='flex justify-between text-[10px]'>
            <div className='flex items-center gap-1'>
              <div className={cn('w-2 h-2 rounded-full', PLAYER_DOT)} />
              <span className='text-emerald-600 font-medium'>You {winProb}%</span>
            </div>
            <div className='flex items-center gap-1'>
              <span className='text-slate-500 font-medium'>AI {100 - winProb}%</span>
              <div className={cn('w-2 h-2 rounded-full', AI_DOT)} />
            </div>
          </div>
        </div>
      </Collapsible>

      {/* 3. Move Assessment + Tempo */}
      <Collapsible title='Move Assessment' icon={Lightbulb} accent='text-sky-500' defaultOpen={false}>
        <div className='space-y-2'>
          <div className='flex items-center gap-2'>
            <QualityIcon className={cn('w-4 h-4', q.color.split(' ')[0])} />
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', q.color)}>{q.label}</span>
            {lastMoveEntry && (
              <span className='text-[11px] text-foreground/70 ml-auto'>Last: <span className='font-mono font-bold'>{coordLabel(lastMoveEntry.row, lastMoveEntry.col, boardSize)}</span></span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <Gauge className={cn('w-3.5 h-3.5', u.color.split(' ')[0])} />
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', u.color)}>{u.label}</span>
            <span className='text-[10px] text-foreground/60 ml-auto'>Initiative: <span className='font-mono'>{tp.playerInitiative}</span> vs <span className='font-mono'>{tp.aiInitiative}</span></span>
          </div>
          <p className='text-[10px] text-foreground/60 leading-relaxed'>{u.desc}</p>
          {aiReasoning && <MoveReasoning />}
        </div>
      </Collapsible>

      {/* 4. AI Reasoning */}
      {aiReasoning && (
        <Collapsible title='AI Reasoning' icon={Brain} accent='text-slate-500' defaultOpen={false}>
          <p className='text-[11px] text-foreground/70 leading-relaxed'>{aiReasoning}</p>
        </Collapsible>
      )}

      {/* 5. Move Timeline — NEW */}
      <Collapsible title='Move Timeline' icon={History} accent='text-amber-500' defaultOpen={false}
        badge={moveHistory.length > 0 ? <span className='text-[10px] text-amber-500 font-mono'>#{moveHistory.length}</span> : undefined}
      >
        <MoveTimeline />
      </Collapsible>

      {/* 6. Critical Squares */}
      {sqs.length > 0 && (
        <Collapsible title='Critical Squares' icon={Crosshair} accent='text-red-400' defaultOpen={false}
          badge={<span className='text-[10px] text-red-400 font-mono'>{sqs.length}</span>}
        >
          <div className='space-y-1'>{sqs.map((s, i) => <CriticalRow key={i} sq={s} boardSize={boardSize} />)}</div>
        </Collapsible>
      )}

      {/* 7. Scoring Mode */}
      {isScoring && scoringAnalysis && (
        <Collapsible title='Score Board' icon={Award} accent='text-amber-500' defaultOpen={false}
          badge={<span className='text-[10px] font-mono font-bold text-amber-600'>{scoringAnalysis.remainingMoves} left</span>}
        >
          <ScoringSection sa={scoringAnalysis} />
        </Collapsible>
      )}

      {/* 8. Player Best Options */}
      <Collapsible title={isScoring ? 'Best Scoring Moves' : 'Your Best Options'} icon={Target} accent='text-emerald-500' defaultOpen={false}
        badge={playerBestMoves.length > 0 ? <span className='text-[10px] text-emerald-600 font-mono'>{playerBestMoves.length} moves</span> : undefined}
      >
        {isScoring && scoringAnalysis ? (
          <div className='space-y-0.5'>
            {scoringAnalysis.topScoringMoves.length > 0
              ? scoringAnalysis.topScoringMoves.slice(0, 5).map((m, i) => (
                <div key={i} className='flex items-center gap-2 text-[11px] py-0.5'>
                  <span className='font-mono font-bold text-emerald-700 w-8 shrink-0'>{coordLabel(m.row, m.col, boardSize)}</span>
                  <span className='flex-1 text-foreground/70 truncate'>{m.patterns}</span>
                  <span className='font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px]'>+{m.points}</span>
                </div>
              ))
              : <span className='text-[11px] text-muted-foreground italic'>No scoring opportunities detected yet. Focus on building triples and fours.</span>}
          </div>
        ) : (
          <div className='space-y-0.5'>
            {playerBestMoves.length > 0
              ? playerBestMoves.map((m, i) => <PlayerMoveRow key={i} m={m} boardSize={boardSize} />)
              : <span className='text-[11px] text-muted-foreground italic'>No strong moves detected. The position may be very early or heavily constrained.</span>}
          </div>
        )}
      </Collapsible>

      {/* 9. AI Considered Moves */}
      <Collapsible title='AI Considered' icon={Brain} accent='text-slate-500' defaultOpen={false}
        badge={aiCandidateMoves.length > 0 ? <span className='text-[10px] text-slate-500 font-mono'>{aiCandidateMoves.length} moves</span> : undefined}
      >
        <div className='space-y-0.5'>
          {aiCandidateMoves.length > 0
            ? aiCandidateMoves.map((m, i) => <AiMoveRow key={i} move={m} maxVisits={maxVisits} isBest={i === 0} boardSize={boardSize} />)
            : <span className='text-[11px] text-muted-foreground italic'>—</span>}
        </div>
      </Collapsible>

      {/* 10. Threats */}
      <Collapsible title='Threat Analysis' icon={Shield} accent='text-red-400' defaultOpen={false}
        badge={(() => {
          const pt = Object.values(playerThreats).reduce((s, c) => s + c, 0);
          const at = Object.values(aiThreats).reduce((s, c) => s + c, 0);
          return <span className='text-[10px] text-muted-foreground font-mono'>{pt} vs {at}</span>;
        })()}
      >
        <div className='space-y-2'>
          <ThreatDisplay label='Your threats' counts={playerThreats} playerColor='player' />
          <ThreatDisplay label='AI threats' counts={aiThreats} playerColor='ai' />
        </div>
      </Collapsible>

      {/* 11. Board Control */}
      <Collapsible title='Board Control' icon={Map} accent='text-sky-500' defaultOpen={false}
        badge={<span className='text-[10px] text-sky-500 font-mono'>{pCtrlPct}%/{aCtrlPct}%</span>}
      >
        <div className='space-y-2'>
          <div className='flex items-center h-4 bg-slate-100 rounded-full overflow-hidden'>
            <motion.div className='h-full bg-emerald-400 rounded-l-full' animate={{ width: `${pCtrlPct}%` }} transition={{ duration: 0.5 }} />
            <motion.div className='h-full bg-amber-300' animate={{ width: `${contestedPct}%` }} transition={{ duration: 0.5 }} />
            <motion.div className='h-full bg-slate-400 rounded-r-full' animate={{ width: `${aCtrlPct}%` }} transition={{ duration: 0.5 }} />
          </div>
          <div className='flex justify-between text-[10px] text-muted-foreground'>
            <div className='flex items-center gap-1'><div className={cn('w-2 h-2 rounded-full', PLAYER_DOT)} /> You: {bc.playerInfluence} ({pCtrlPct}%)</div>
            <div className='flex items-center gap-1'><div className='w-2 h-2 rounded-full bg-amber-300' /> Contested: {bc.contested}</div>
            <div className='flex items-center gap-1'><div className={cn('w-2 h-2 rounded-full', AI_DOT)} /> AI: {bc.aiInfluence} ({aCtrlPct}%)</div>
          </div>
          {pCtrlPct > 60 && <p className='text-[10px] text-emerald-600 bg-emerald-50/50 rounded-lg p-2'>You control the majority of the board. Maintain this advantage by solidifying your influence zones and extending threats from controlled areas.</p>}
          {aCtrlPct > 60 && <p className='text-[10px] text-slate-600 bg-slate-50/50 rounded-lg p-2'>The AI has board dominance. Focus on contesting key positions and building patterns in the AI's weaker zones to shift the balance.</p>}
        </div>
      </Collapsible>

      {/* 12. AI Search Stats */}
      <Collapsible title='AI Search Performance' icon={BarChart3} accent='text-violet-500' defaultOpen={false}
        badge={lastStats ? <span className='text-[10px] text-violet-500 font-mono'>{thinkTime}s</span> : undefined}
      >
        {lastStats ? (
          <div className='space-y-2'>
            <div className='grid grid-cols-3 gap-1.5 text-center'>
              <div className='bg-white/50 rounded-lg p-2'>
                <div className='text-sm font-mono font-bold'>{lastStats.simulations.toLocaleString()}</div>
                <div className='text-[9px] text-muted-foreground'>Simulations</div>
                <div className='text-[8px] text-muted-foreground/60'>Random playouts used to evaluate positions</div>
              </div>
              <div className='bg-white/50 rounded-lg p-2'>
                <div className='text-sm font-mono font-bold'>{thinkTime}s</div>
                <div className='text-[9px] text-muted-foreground'>Think Time</div>
                <div className='text-[8px] text-muted-foreground/60'>Wall-clock time for this move</div>
              </div>
              <div className='bg-white/50 rounded-lg p-2'>
                <div className='text-sm font-mono font-bold'>{lastStats.nodesExpanded.toLocaleString()}</div>
                <div className='text-[9px] text-muted-foreground'>Nodes</div>
                <div className='text-[8px] text-muted-foreground/60'>Unique positions explored in search tree</div>
              </div>
            </div>
            <div className='text-[10px] text-muted-foreground text-center'>{speed} simulations/sec throughput</div>
          </div>
        ) : <span className='text-[11px] text-muted-foreground italic'>No search data available yet.</span>}
      </Collapsible>

      {/* 13. Pattern Learning */}
      <Collapsible title='Pattern Learning & RAVE' icon={Sparkles} accent='text-amber-500' defaultOpen={false}>
        <PatternSection />
      </Collapsible>

      {/* 14. Rules & Context */}
      <Collapsible title='Rules & Game Context' icon={BookOpen} accent='text-sky-500' defaultOpen={false}>
        <RulesSection />
      </Collapsible>
    </AcrylicCard>
  );
}

// ---- Critical Square Row ----
function CriticalRow({ sq, boardSize }: { sq: CriticalSquare; boardSize: number }) {
  const severityColor = sq.severity === 'vital' ? 'bg-red-100 text-red-700 border-red-200'
    : sq.severity === 'important' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-sky-50 text-sky-600 border-sky-200';
  const forColor = sq.forPlayer === 'player' ? PLAYER_DOT
    : sq.forPlayer === 'ai' ? AI_DOT
    : 'bg-gradient-to-br from-amber-300 to-amber-500';
  const forLabel = sq.forPlayer === 'player' ? 'You' : sq.forPlayer === 'ai' ? 'AI' : 'Both';
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg border', severityColor)}>
      <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', forColor)} />
      <span className='font-mono font-bold text-[11px] w-8 shrink-0'>{coordLabel(sq.row, sq.col, boardSize)}</span>
      <span className='flex-1 text-[11px]'>{sq.reason}</span>
      <span className='text-[9px] font-medium opacity-70'>{forLabel}</span>
    </div>
  );
}

// ==================================================
// BOTTOM PANEL v3 — slim status strip (in flow, ~32px)
// + hover-expanded analysis overlay that rises ABOVE
// the strip and floats over the board's lower edge.
//
// Layout law: the Board self-caps at 85vw/85vh, so this
// strip must stay minimal for the board to keep ≥85%
// viewport during play. The overlay is hover-transient
// (visible = eval-hover || strip-hover || pinned) and
// translucent warm acrylic — the board is never
// permanently covered and nothing auto-opens after moves.
// ==================================================

export function BottomPanel({ visible, onHoverEnter, onHoverLeave, onTogglePin }: {
  visible: boolean;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onTogglePin: () => void;
}) {
  const { status, isThinking, gameMode, playerPiece, currentPlayer,
          playerScore, aiScore, moveHistory, analysis } = useGameStore();

  const isGameOver = status === 'won' || status === 'lost' || status === 'draw';
  const isPlayerTurn = !isThinking && status === 'playing' && currentPlayer === playerPiece;
  const isAiTurn = status === 'playing' && isThinking;

  return (
    <div
      className='relative w-full flex-shrink-0'
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
    >
      {/* ---- Analysis overlay — rises above the strip, floats over the board ---- */}
      <div
        aria-hidden={!visible}
        className={cn(
          'absolute bottom-full left-1.5 right-1.5 mb-1.5 z-30',
          'transition-[opacity,transform] duration-200 ease-out',
          visible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-2 pointer-events-none'
        )}
      >
        <div className='max-w-3xl mx-auto max-h-[min(55vh,30rem)] overflow-y-auto scrollbar-thin bg-[#fbf7ef]/60 dark:bg-stone-900/60 backdrop-blur-xl border border-[#d8c9a8]/50 dark:border-stone-700/50 rounded-2xl shadow-[0_-8px_32px_rgba(90,70,30,0.14)]'>
          {analysis ? (
            <>
              <div className='px-2 pt-2'>
                <AnalysisPanel />
              </div>
              <div className='border-t border-white/30 px-3 py-1'>
                <p className='text-[9px] text-muted-foreground/70 text-center'>
                  MCTS + RAVE (Gelly &amp; Silver) · Neural-net blend (60/40) · Threat Classifier · Global learning
                </p>
              </div>
            </>
          ) : (
            <p className='px-4 py-3 text-[11px] text-muted-foreground text-center'>
              Make a move to unlock the full game analysis.
            </p>
          )}
        </div>
      </div>

      {/* ---- Slim status strip (in flow below the board) ---- */}
      <section
        onClick={onTogglePin}
        title={visible ? 'Click to unpin analysis' : 'Hover to preview · click to pin'}
        className='bg-[#fbf7ef]/70 dark:bg-stone-900/55 backdrop-blur-xl border border-[#d8c9a8]/50 dark:border-stone-700/50 shadow-[0_2px_12px_rgba(90,70,30,0.06)] rounded-xl cursor-pointer select-none'
      >
        <div className='max-w-3xl mx-auto px-3 h-8 flex items-center justify-between gap-3'>
          {/* Left — players */}
          <div className='flex items-center gap-2'>
            <div className='flex items-center gap-1.5'>
              <div className={cn('w-2.5 h-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm transition-opacity', isPlayerTurn ? 'opacity-100 ring-2 ring-emerald-400/50' : 'opacity-50')} />
              <span className='text-[11px] font-medium text-muted-foreground'>You</span>
            </div>
            <span className='hidden xs:inline text-[9px] text-muted-foreground/60'>vs</span>
            <div className='flex items-center gap-1.5'>
              <div className={cn('w-2.5 h-2.5 rounded-full bg-gradient-to-br from-gray-600 to-gray-800 shadow-sm transition-opacity', isAiTurn ? 'opacity-100 ring-2 ring-amber-400/50' : 'opacity-50')} />
              <span className='text-[11px] font-medium text-muted-foreground'>AI</span>
            </div>
          </div>

          {/* Center — status */}
          <div className='flex items-center min-w-0'>
            {isGameOver ? (
              <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold', status === 'won' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : status === 'lost' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-muted text-muted-foreground')}>
                {status === 'won' && <Trophy className='w-3 h-3' />}
                {status === 'lost' && <Trophy className='w-3 h-3' />}
                {status === 'draw' && <Minus className='w-3 h-3' />}
                {status === 'won' ? 'You win!' : status === 'lost' ? 'AI wins' : 'Draw'}
              </span>
            ) : isAiTurn ? (
              <span className='inline-flex items-center gap-1.5 text-[11px] text-amber-600'><Loader2 className='w-3 h-3 animate-spin' /> Thinking…</span>
            ) : status === 'playing' && isPlayerTurn ? (
              <span className='text-[11px] text-emerald-600 font-medium'>Your turn</span>
            ) : null}
          </div>

          {/* Right — score, move #, analysis toggle */}
          <div className='flex items-center gap-2.5'>
            {gameMode === 'scoring' && playerScore && aiScore && (
              <div className='flex items-center gap-1.5 text-[11px] font-mono'>
                <span className={cn('font-bold', playerScore.total > aiScore.total ? 'text-emerald-600' : 'text-muted-foreground')}>{playerScore.total}</span>
                <span className='text-muted-foreground/50'>:</span>
                <span className={cn('font-bold', aiScore.total > playerScore.total ? 'text-slate-700 dark:text-slate-300' : 'text-muted-foreground')}>{aiScore.total}</span>
              </div>
            )}
            <span className='text-[9px] text-muted-foreground font-mono'>#{moveHistory.length}</span>
            <span
              role='button'
              tabIndex={0}
              aria-expanded={visible}
              aria-label={visible ? 'Collapse analysis' : 'Expand analysis'}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onTogglePin(); } }}
              onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              className='flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors cursor-pointer'
            >
              <Eye className='w-3 h-3' />
              <span className='hidden sm:inline'>Analysis</span>
              <ChevronUp className={cn('w-3 h-3 transition-transform duration-200', visible && 'rotate-180')} />
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
