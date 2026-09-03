'use client';

import { useGameStore } from '@/store/game-store';
import { cn } from '@/lib/utils';
import {
  Brain, Target, Shield, Zap, Activity,
  Eye, Crosshair, Gauge, Map, Sword,
  TrendingDown, TrendingUp, Minus, Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { coordLabel } from '@/lib/game/threat-classifier';
import type { CriticalSquare } from '@/lib/game/threat-classifier';
import type { NnSuggestion } from '@/lib/game/types';

const PLAYER_DOT = 'bg-gradient-to-br from-emerald-400 to-emerald-600';
const AI_DOT = 'bg-gradient-to-br from-slate-600 to-slate-800';

interface QuickPreviewProps {
  visible: boolean;
}

export function QuickPreview({ visible }: QuickPreviewProps) {
  const { analysis, isThinking, lastStats, boardSize, moveHistory, playerPiece } = useGameStore();

  if (!analysis) return null;

  const {
    evalScore, winProb, assessment, aiReasoning,
    playerBestMoves, aiCandidateMoves, playerThreats, aiThreats,
    nnSuggestions, nnMeta,
  } = analysis;

  const nnPicks: NnSuggestion[] = nnSuggestions ?? [];

  const mq = analysis.moveQuality || 'optimal';
  const sqs = analysis.criticalSquares || [];
  const bc = analysis.boardControl || { playerInfluence: 0, aiInfluence: 0, contested: 0, totalCells: 0 };
  const tp = analysis.tempo || { playerInitiative: 0, aiInitiative: 0, urgency: 'none' as const };

  const evalColor = evalScore > 3 ? 'text-emerald-600' : evalScore < -3 ? 'text-slate-600' : 'text-amber-600';
  const thinkTime = lastStats ? (lastStats.thinkTimeMs / 1000).toFixed(1) : '—';
  const speed = lastStats && lastStats.thinkTimeMs > 0 ? (lastStats.simulations / (lastStats.thinkTimeMs / 1000)).toFixed(0) : '—';
  const lastMoveEntry = moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
  const isLastMovePlayer = lastMoveEntry?.player === playerPiece;
  const lastMoveLabel = lastMoveEntry ? coordLabel(lastMoveEntry.row, lastMoveEntry.col, boardSize) : '—';
  const playerThreatCount = Object.values(playerThreats).reduce((s, c) => s + c, 0);
  const aiThreatCount = Object.values(aiThreats).reduce((s, c) => s + c, 0);

  // Move quality config
  const ql: Record<string, { label: string; color: string }> = {
    optimal: { label: 'Optimal', color: 'text-emerald-600 bg-emerald-50' },
    strong: { label: 'Strong', color: 'text-sky-600 bg-sky-50' },
    alternative: { label: 'Alternative', color: 'text-amber-600 bg-amber-50' },
    tactical: { label: 'Tactical', color: 'text-violet-600 bg-violet-50' },
  };
  const qInfo = ql[mq] || ql.optimal;

  // Urgency config
  const ul: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    none: { label: 'Calm', color: 'text-muted-foreground bg-muted/50', icon: Gauge },
    attack: { label: 'Attack!', color: 'text-emerald-600 bg-emerald-50', icon: Sword },
    defend: { label: 'Defend', color: 'text-amber-600 bg-amber-50', icon: Shield },
    critical: { label: 'Critical!', color: 'text-red-600 bg-red-50', icon: Zap },
  };
  const uInfo = ul[tp.urgency] || ul.none;
  const UIcon = uInfo.icon;

  // Board control
  const bcTotal = bc.totalCells > 0 ? bc.totalCells : 1;

  // Eval trend
  const EvalTrendIcon = evalScore > 3 ? TrendingUp : evalScore < -3 ? TrendingDown : Minus;

  // Strategic narrative
  const narrative = buildNarrative(analysis, moveHistory, boardSize, playerPiece);

  return (
    <AnimatePresence>
      {visible && !isThinking && (
        <motion.div
          key='side-preview'
          initial={{ x: 6, opacity: 0, scale: 1 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: 6, opacity: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className='absolute top-0 bottom-0 z-30 pointer-events-auto'
          style={{ right: '100%', marginRight: '-2px', width: '18rem' }}
        >
          <div className='h-full bg-[#fbf7ef]/45 dark:bg-stone-900/45 backdrop-blur-xl border border-[#d8c9a8]/50 dark:border-stone-700/50 rounded-2xl shadow-[0_8px_32px_rgba(90,70,30,0.16)] overflow-hidden flex flex-col'>
            {/* Header */}
            <div className='flex items-center justify-between px-3 py-2 border-b border-[#d8c9a8]/40 dark:border-stone-700/40 flex-shrink-0'>
              <div className='flex items-center gap-1.5'>
                <Eye className='w-3.5 h-3.5 text-muted-foreground' />
                <span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Quick View</span>
              </div>
              <div className='flex items-center gap-1.5'>
                <EvalTrendIcon className={cn('w-3 h-3', evalColor)} />
                <span className={cn('text-sm font-mono font-bold', evalColor)}>
                  {evalScore > 0 ? `+${evalScore}` : evalScore}
                </span>
              </div>
            </div>

            {/* Scrollable content */}
            <div className='flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3'>
              {/* Position Eval + Win Probability */}
              <div className='space-y-1.5'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-1.5'>
                    <Activity className='w-3.5 h-3.5 text-amber-500' />
                    <span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Position</span>
                  </div>
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', qInfo.color)}>{qInfo.label}</span>
                </div>
                <div className='flex items-center h-2.5 bg-slate-100/80 rounded-full overflow-hidden'>
                  <motion.div className='h-full rounded-full' style={{ background: 'linear-gradient(90deg, #34d399, #059669)' }} animate={{ width: `${winProb}%` }} transition={{ duration: 0.4 }} />
                </div>
                <div className='flex justify-between text-[10px]'>
                  <div className='flex items-center gap-1'><div className={cn('w-2 h-2 rounded-full', PLAYER_DOT)} /><span className='text-emerald-600 font-medium'>{winProb}%</span></div>
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full', winProb > 55 ? 'bg-emerald-100 text-emerald-700' : winProb < 45 ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-700')}>{assessment}</span>
                  <div className='flex items-center gap-1'><span className='text-slate-500 font-medium'>{100 - winProb}%</span><div className={cn('w-2 h-2 rounded-full', AI_DOT)} /></div>
                </div>
              </div>

              {/* NN Suggestions — neural-net-ranked moves for YOUR next turn */}
              {nnPicks.length > 0 && (
                <div className='space-y-1.5'>
                  <div className='flex items-center gap-1.5'>
                    <Brain className='w-3.5 h-3.5 text-violet-500' />
                    <span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>NN Suggestions</span>
                    <Sparkles className='w-3 h-3 text-violet-400 ml-auto' />
                  </div>
                  {nnPicks.map((s, i) => (
                    <div key={i} className={cn(
                      'rounded-lg px-2 py-1.5 space-y-1 border',
                      i === 0 ? 'bg-violet-50/70 border-violet-200/60' : 'bg-white/25 dark:bg-white/5 border-transparent'
                    )}>
                      <div className='flex items-center gap-1.5'>
                        <span className={cn(
                          'w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center shrink-0',
                          i === 0 ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground'
                        )}>{i + 1}</span>
                        <span className='font-mono font-bold text-[11px] text-foreground'>{coordLabel(s.row, s.col, boardSize)}</span>
                        {s.tactical && (
                          <span className='text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded-full shrink-0'>ENGINE ✓</span>
                        )}
                        {s.isFork && <Zap className='w-3 h-3 text-amber-500 shrink-0' />}
                        <span className='ml-auto font-mono text-[11px] font-bold text-violet-600'>{s.nnWinProb.toFixed(1)}%</span>
                      </div>
                      <div className='flex items-center gap-1.5'>
                        <div className='flex-1 h-1.5 bg-slate-200/70 rounded-full overflow-hidden'>
                          <motion.div
                            className='h-full rounded-full'
                            style={{ background: 'linear-gradient(90deg, #a78bfa, #7c3aed)' }}
                            initial={{ width: 0 }}
                            animate={{ width: `${s.nnWinProb}%` }}
                            transition={{ duration: 0.4, delay: i * 0.05 }}
                          />
                        </div>
                      </div>
                      <p className='text-[9px] text-muted-foreground leading-snug truncate'>{s.tag}</p>
                    </div>
                  ))}
                  {nnMeta && (
                    <p className='text-[8px] text-muted-foreground/70 text-center'>
                      {nnMeta.params.toLocaleString()} params · {(nnMeta.trainingSamples / 1000).toFixed(1)}k training samples
                    </p>
                  )}
                </div>
              )}

              {/* Strategic Narrative */}
              <div className='bg-white/25 dark:bg-white/5 rounded-xl p-2.5'>
                <p className='text-[10px] text-foreground/70 leading-relaxed'>{narrative}</p>
              </div>

              {/* Tempo & Urgency */}
              <div className='flex items-center gap-2'>
                <UIcon className={cn('w-3.5 h-3.5', tp.urgency === 'critical' ? 'text-red-500 animate-pulse' : 'text-muted-foreground')} />
                <span className='text-[10px] text-muted-foreground'>Tempo:</span>
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', uInfo.color)}>{uInfo.label}</span>
                <div className='flex-1 flex items-center gap-1 ml-auto'>
                  <div className='flex-1 h-1.5 bg-emerald-100 rounded-full overflow-hidden'><div className='h-full bg-emerald-500 rounded-full' style={{ width: `${tp.playerInitiative * 10}%` }} /></div>
                  <span className='text-[8px] text-muted-foreground w-6 text-right'>{tp.playerInitiative}/{tp.aiInitiative}</span>
                  <div className='flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden'><div className='h-full bg-slate-500 rounded-full' style={{ width: `${tp.aiInitiative * 10}%` }} /></div>
                </div>
              </div>

              {/* Last Move */}
              {lastMoveEntry && (
                <div className='bg-white/25 dark:bg-white/5 rounded-xl p-2.5 space-y-1.5'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-1.5'>
                      <div className={cn('w-2.5 h-2.5 rounded-full', isLastMovePlayer ? PLAYER_DOT : AI_DOT)} />
                      <span className='text-[10px] font-bold text-muted-foreground uppercase tracking-wider'>{isLastMovePlayer ? 'You played' : 'AI played'}</span>
                    </div>
                    <span className='text-[11px] font-mono font-bold text-foreground'>{lastMoveLabel}</span>
                  </div>
                  {aiReasoning && <p className='text-[10px] text-foreground/70 leading-relaxed italic'>{aiReasoning}</p>}
                </div>
              )}

              {/* Critical Squares */}
              {sqs.length > 0 && (
                <div className='space-y-1.5'>
                  <div className='flex items-center gap-1.5'>
                    <Crosshair className='w-3.5 h-3.5 text-red-400' />
                    <span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Critical Squares</span>
                    <span className='text-[9px] font-mono text-red-400 ml-auto'>{sqs.length}</span>
                  </div>
                  <div className='space-y-1'>{sqs.slice(0, 4).map((s, i) => <CSRow key={i} sq={s} boardSize={boardSize} />)}</div>
                </div>
              )}

              {/* Threats */}
              <div className='space-y-1.5'>
                <div className='flex items-center gap-1.5'><Shield className='w-3.5 h-3.5 text-red-400' /><span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Threats</span></div>
                <div className='grid grid-cols-2 gap-1.5'>
                  <div className='bg-emerald-50/60 rounded-lg p-2 text-center'>
                    <div className='text-[9px] text-emerald-600 font-medium'>Yours</div>
                    <div className={cn('text-base font-mono font-bold', playerThreatCount > 0 ? 'text-emerald-700' : 'text-muted-foreground')}>{playerThreatCount}</div>
                    <div className='text-[8px] text-muted-foreground mt-0.5'>{describeThreats(playerThreats)}</div>
                  </div>
                  <div className='bg-slate-50/60 rounded-lg p-2 text-center'>
                    <div className='text-[9px] text-slate-500 font-medium'>AI</div>
                    <div className={cn('text-base font-mono font-bold', aiThreatCount > 0 ? 'text-slate-700' : 'text-muted-foreground')}>{aiThreatCount}</div>
                    <div className='text-[8px] text-muted-foreground mt-0.5'>{describeThreats(aiThreats)}</div>
                  </div>
                </div>
              </div>

              {/* Board Control */}
              {bc.totalCells > 0 && (
                <div className='space-y-1.5'>
                  <div className='flex items-center gap-1.5'><Map className='w-3.5 h-3.5 text-sky-500' /><span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Board Control</span></div>
                  <div className='flex items-center h-2.5 bg-slate-100/80 rounded-full overflow-hidden'>
                    <div className='h-full bg-emerald-400 rounded-l-full' style={{ width: `${(bc.playerInfluence / bcTotal) * 100}%` }} />
                    <div className='h-full bg-amber-300' style={{ width: `${(bc.contested / bcTotal) * 100}%` }} />
                    <div className='h-full bg-slate-400 rounded-r-full' style={{ width: `${(bc.aiInfluence / bcTotal) * 100}%` }} />
                  </div>
                  <div className='flex justify-between text-[9px] text-muted-foreground'>
                    <span className='text-emerald-600'>{bc.playerInfluence} you</span>
                    <span>{bc.contested} contested</span>
                    <span className='text-slate-600'>{bc.aiInfluence} AI</span>
                  </div>
                </div>
              )}

              {/* Key Positions */}
              <div className='space-y-1.5'>
                <div className='flex items-center gap-1.5'><Target className='w-3.5 h-3.5 text-emerald-500' /><span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Key Positions</span></div>
                {playerBestMoves.slice(0, 3).map((m, i) => (
                  <div key={i} className='flex items-center gap-2 bg-emerald-50/50 rounded-lg px-2 py-1.5'>
                    <span className='font-mono font-bold text-emerald-700 text-[11px] w-7'>{coordLabel(m.row, m.col, boardSize)}</span>
                    <span className='flex-1 text-[10px] text-foreground/70 truncate'>{m.description}</span>
                    {m.isFork && <Zap className='w-3 h-3 text-amber-500 shrink-0' />}
                  </div>
                ))}
                {aiCandidateMoves.slice(0, 3).map((m, i) => (
                  <div key={`ai-${i}`} className='flex items-center gap-2 bg-slate-50/50 rounded-lg px-2 py-1.5'>
                    <span className='font-mono font-bold text-slate-600 text-[11px] w-7'>{coordLabel(m.row, m.col, boardSize)}</span>
                    <div className='flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden'><div className='h-full bg-slate-400 rounded-full' style={{ width: `${(m.visits / (aiCandidateMoves[0]?.visits || 1)) * 100}%` }} /></div>
                    <span className='text-[9px] font-mono text-muted-foreground'>{m.winRate.toFixed(0)}%</span>
                  </div>
                ))}
              </div>

              {/* Search Stats */}
              {lastStats && (
                <div className='space-y-1.5'>
                  <div className='flex items-center gap-1.5'><Brain className='w-3.5 h-3.5 text-violet-500' /><span className='text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>Search</span></div>
                  <div className='grid grid-cols-3 gap-1 text-center'>
                    <div className='bg-white/40 rounded-lg p-1.5'><div className='text-[10px] font-mono font-bold'>{(lastStats.simulations / 1000).toFixed(1)}k</div><div className='text-[8px] text-muted-foreground'>sims</div></div>
                    <div className='bg-white/40 rounded-lg p-1.5'><div className='text-[10px] font-mono font-bold'>{thinkTime}s</div><div className='text-[8px] text-muted-foreground'>time</div></div>
                    <div className='bg-white/40 rounded-lg p-1.5'><div className='text-[10px] font-mono font-bold'>{speed}/s</div><div className='text-[8px] text-muted-foreground'>speed</div></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CSRow({ sq, boardSize }: { sq: CriticalSquare; boardSize: number }) {
  const sc = sq.severity === 'vital' ? 'bg-red-100 text-red-700 border-red-200'
    : sq.severity === 'important' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-sky-50 text-sky-600 border-sky-200';
  const fc = sq.forPlayer === 'player' ? PLAYER_DOT : sq.forPlayer === 'ai' ? AI_DOT : 'bg-gradient-to-br from-amber-300 to-amber-500';
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1 rounded-lg border', sc)}>
      <div className={cn('w-2 h-2 rounded-full shrink-0', fc)} />
      <span className='font-mono font-bold text-[11px] w-7 shrink-0'>{coordLabel(sq.row, sq.col, boardSize)}</span>
      <span className='flex-1 text-[10px] truncate'>{sq.reason}</span>
    </div>
  );
}

function describeThreats(counts: Record<string, number>): string {
  const parts: string[] = [];
  if (counts.Five) parts.push(`${counts.Five}×5`);
  if (counts.OpenFour) parts.push(`${counts.OpenFour} of4`);
  if (counts.HalfOpenFour) parts.push(`${counts.HalfOpenFour} hof4`);
  if (counts.OpenThree) parts.push(`${counts.OpenThree} of3`);
  if (counts.HalfOpenThree) parts.push(`${counts.HalfOpenThree} hof3`);
  return parts.length > 0 ? parts.join(' · ') : 'None';
}

function buildNarrative(
  analysis: NonNullable<ReturnType<typeof useGameStore.getState>['analysis']>,
  moveHistory: ReturnType<typeof useGameStore.getState>['moveHistory'],
  boardSize: number,
  playerPiece: number,
): string {
  const { evalScore, winProb, playerThreats, aiThreats, playerBestMoves, criticalSquares } = analysis;
  const tp = analysis.tempo || { playerInitiative: 0, aiInitiative: 0, urgency: 'none' as const };

  const parts: string[] = [];

  if (evalScore > 5) parts.push('You have a commanding position');
  else if (evalScore > 2) parts.push('You hold a slight advantage');
  else if (evalScore > -2) parts.push('The position is roughly balanced');
  else if (evalScore > -5) parts.push('The AI has a slight edge');
  else parts.push('The AI has a strong position');

  parts.push(`(${winProb}% win probability).`);

  const pFours = (playerThreats.OpenFour || 0) + (playerThreats.HalfOpenFour || 0);
  const pThrees = (playerThreats.OpenThree || 0) + (playerThreats.HalfOpenThree || 0);
  const aFours = (aiThreats.OpenFour || 0) + (aiThreats.HalfOpenFour || 0);
  const aThrees = (aiThreats.OpenThree || 0) + (aiThreats.HalfOpenThree || 0);

  if (pFours > 0) parts.push(`You have ${pFours} four-in-a-row threat${pFours > 1 ? 's' : ''} building.`);
  else if (pThrees > 0) parts.push(`You're developing ${pThrees} three-in-a-row pattern${pThrees > 1 ? 's' : ''}.`);

  if (aFours > 0) parts.push(`The AI has ${aFours} four-threat${aFours > 1 ? 's' : ''} — watch carefully.`);
  else if (aThrees > 0) parts.push(`AI has ${aThrees} three-pattern${aThrees > 1 ? 's' : ''} developing.`);

  if (tp.urgency === 'critical') parts.push('Immediate defense is required!');
  else if (tp.urgency === 'defend') parts.push('Consider defensive moves.');
  else if (tp.urgency === 'attack') parts.push('Look for attacking opportunities.');

  if (playerBestMoves.length > 0) {
    const best = playerBestMoves[0];
    parts.push(`Best move: ${coordLabel(best.row, best.col, boardSize)} — ${best.description}.`);
  }

  const sqs = criticalSquares || [];
  const vitalSqs = sqs.filter(s => s.severity === 'vital' && s.forPlayer === 'ai');
  if (vitalSqs.length > 0) {
    parts.push(`Vital square${vitalSqs.length > 1 ? 's' : ''}: ${vitalSqs.map(s => coordLabel(s.row, s.col, boardSize)).join(', ')}.`);
  }

  const totalCells = boardSize * boardSize;
  const played = moveHistory.length;
  const phase = played < totalCells * 0.15 ? 'opening' : played < totalCells * 0.5 ? 'midgame' : 'endgame';
  if (phase === 'opening') parts.push('Still in the opening — prioritize center control and building connected patterns.');
  else if (phase === 'endgame') parts.push('Endgame approaches — focus on converting threats and blocking AI advances.');

  return parts.join(' ');
}
