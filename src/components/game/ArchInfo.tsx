'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useGameStore } from '@/store/game-store';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BrainCircuit,
  Zap,
  GraduationCap,
  AlertTriangle,
  TreePine,
  GitBranch,
  Database,
} from 'lucide-react';

export function ArchInfo() {
  const { showArchInfo, setShowArchInfo } = useGameStore();

  return (
    <Sheet open={showArchInfo} onOpenChange={setShowArchInfo}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5" />
            Adaptive MCTS + Global RAVE AI
          </SheetTitle>
          <SheetDescription>
            A rules-driven AI that learns during play via persistent position knowledge — no pretraining required.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] pr-4 mt-4">
          <div className="space-y-6 pb-8">
            {/* Layer 1 */}
            <LayerCard
              number={1}
              icon={<TreePine className="w-5 h-5 text-emerald-500" />}
              title="Monte Carlo Tree Search (MCTS)"
              color="emerald"
            >
              <p className="text-sm text-muted-foreground">
                The base reasoning engine. MCTS builds a search tree by simulating thousands of
                random games from the current position, then choosing the move that led to the
                most wins.
              </p>
              <div className="mt-3 space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Four Phases per Simulation:</h4>
                <ol className="text-xs text-muted-foreground space-y-1 ml-3 list-decimal">
                  <li><strong className="text-foreground">Selection</strong> — Walk down the tree using UCT-RAVE to balance exploitation vs exploration, guided by both local and global RAVE values.</li>
                  <li><strong className="text-foreground">Expansion</strong> — Add a new child node for an untried move.</li>
                  <li><strong className="text-foreground">Simulation</strong> — Play out a game from the new node, biased by the Global RAVE table and spatial features.</li>
                  <li><strong className="text-foreground">Backpropagation</strong> — Update tree nodes AND the Global RAVE table with the result.</li>
                </ol>
              </div>
              <div className="mt-3 p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  <strong>Key property:</strong> Needs only <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1 rounded">legal_moves()</code> and <code className="bg-emerald-100 dark:bg-emerald-900/50 px-1 rounded">terminal_value()</code> — the same code runs at any board size with zero retraining.
                </p>
              </div>
            </LayerCard>

            {/* Layer 2: Global RAVE */}
            <LayerCard
              number={2}
              icon={<Database className="w-5 h-5 text-amber-500" />}
              title="Global RAVE — Persistent Learning"
              color="amber"
            >
              <p className="text-sm text-muted-foreground">
                A <strong>Global RAVE Table</strong> (per player, per board position) persists for the
                <em> entire game</em>, independent of tree structure. This is the primary mechanism
                by which the AI &quot;learns during play.&quot;
              </p>
              <div className="mt-3 space-y-2">
                <h4 className="text-xs font-semibold text-foreground">How it works:</h4>
                <ul className="text-xs text-muted-foreground space-y-1 ml-3 list-disc">
                  <li>Every simulation updates both tree nodes AND the global table.</li>
                  <li>During UCT selection, global RAVE is blended with local RAVE for robust evaluation.</li>
                  <li>During playouts, global RAVE biases move selection for higher-quality simulations (Rimmel et al. 2010).</li>
                  <li><strong className="text-foreground">Survives tree pruning failures:</strong> even if the opponent&apos;s move wasn&apos;t in the tree, global RAVE knowledge persists.</li>
                </ul>
              </div>
              <div className="mt-3 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>Why Global RAVE?</strong> Standard RAVE lives in tree nodes — when the tree is
                  pruned between turns, that knowledge is partially lost. Global RAVE is a
                  position-level table that is NEVER discarded during a game.
                </p>
              </div>
              <div className="mt-3 space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Tree Reuse (3-level fallback):</h4>
                <ol className="text-xs text-muted-foreground space-y-1 ml-3 list-decimal">
                  <li><strong className="text-foreground">Full prune</strong> — Descend root → AI move → player move. Best case.</li>
                  <li><strong className="text-foreground">Partial advance</strong> — Descend root → AI move only. When player&apos;s move wasn&apos;t expanded.</li>
                  <li><strong className="text-foreground">Fresh tree + Global RAVE</strong> — Tree lost, but learning persists via global table.</li>
                </ol>
              </div>
              <div className="mt-3 space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Feature-Weighted Playout Policy:</h4>
                <p className="text-xs text-muted-foreground">
                  Simulations are biased by spatial features AND Global RAVE knowledge:
                </p>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  {['Creates winning line', 'Blocks opponent win', 'Line of N-1 (open)', 'Blocks N-1', 'Adjacent to pieces', 'Center proximity', 'Global RAVE bias', 'Local RAVE bias'].map((f) => (
                    <Badge key={f} variant="secondary" className="text-[10px] justify-center">{f}</Badge>
                  ))}
                </div>
              </div>
            </LayerCard>

            {/* Layer 2b: Standard RAVE */}
            <LayerCard
              number="2b"
              icon={<Zap className="w-5 h-5 text-orange-500" />}
              title="Local RAVE (AMAF) — Tree-Level"
              color="amber"
            >
              <p className="text-sm text-muted-foreground">
                Standard RAVE (Rapid Action Value Estimation) uses the AMAF (All Moves As First)
                heuristic within the search tree. When a move appears anywhere in a simulation,
                its result is attributed to that move at every ancestor node.
              </p>
              <div className="mt-3 space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Role in this system:</h4>
                <ul className="text-xs text-muted-foreground space-y-1 ml-3 list-disc">
                  <li>Provides <strong className="text-foreground">path-specific</strong> RAVE values — different from Global RAVE&apos;s position-level values.</li>
                  <li>Works within the tree, giving fast convergence for the current position.</li>
                  <li>β mixing: <code className="bg-muted px-1 rounded">β = √(C / (3v + C))</code> — RAVE influence decreases as visit count grows.</li>
                </ul>
              </div>
              <div className="mt-3 p-2 rounded bg-orange-50 dark:bg-orange-950/20 border border-orange-200/50 dark:border-orange-800/30">
                <p className="text-xs text-orange-700 dark:text-orange-400">
                  <strong>Complementary:</strong> Global RAVE handles cross-turn learning; Local RAVE
                  handles within-turn convergence. Both feed into UCT selection.
                </p>
              </div>
            </LayerCard>

            {/* Layer 3 (future) */}
            <LayerCard
              number={3}
              icon={<GraduationCap className="w-5 h-5 text-violet-500" />}
              title="Curriculum Evaluator (Future Layer)"
              color="violet"
              future
            >
              <p className="text-sm text-muted-foreground">
                For boards larger than ~15×15, a neural network evaluator trained via curriculum
                learning would replace random rollouts. Key design requirements:
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 ml-3 mt-2 list-disc">
                <li><strong className="text-foreground">Size-agnostic architecture</strong> (GNN or fully-convolutional with global pooling) — not a fixed-input CNN.</li>
                <li><strong className="text-foreground">Train small → play large:</strong> train on 6×6, transfer to 15×15 or 24×24.</li>
                <li><strong className="text-foreground">Replay buffers + EWC</strong> to prevent catastrophic forgetting of small-board tactics.</li>
                <li><strong className="text-foreground">Scale N with board size:</strong> if win condition changes (3→5), the curriculum must scale both dimensions.</li>
              </ul>
            </LayerCard>

            <Separator />

            {/* Known Limitations */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Known Limitations</h3>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1.5 ml-6 list-disc">
                <li>Vanilla MCTS signal degrades on large sparse boards. RAVE and feature biasing compensate but have limits.</li>
                <li>Very large boards (20×24) will be slow — the AI uses a time cap and may not reach its full simulation budget.</li>
                <li>The playout policy uses hand-crafted features, not learned ones. This is a deliberate Layer 2 tradeoff.</li>
                <li>Global RAVE knowledge is per-game only — it does not persist across different games.</li>
              </ul>
            </div>

            <Separator />

            {/* Sources */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Key Sources</h3>
              </div>
              <div className="text-xs text-muted-foreground space-y-1 ml-6">
                <p>• Gelly & Silver (2007) — &quot;Combining Online and Offline Knowledge in UCT&quot; (RAVE/AMAF)</p>
                <p>• Rimmel et al. (2010) — &quot;Biasing Monte-Carlo Simulations through RAVE Values&quot; (playout biasing)</p>
                <p>• Sironi et al. (2016) — &quot;Comparison of RAVE Variants for MCTS&quot; (global vs local RAVE)</p>
                <p>• Cazenave et al. — Playout Policy Adaptation (PPA/PPAF)</p>
                <p>• Lanctot et al. (2021) — &quot;Monte Carlo Tree Search&quot; survey</p>
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function LayerCard({
  number,
  icon,
  title,
  color,
  future,
  children,
}: {
  number: number | string;
  icon: React.ReactNode;
  title: string;
  color: 'emerald' | 'amber' | 'violet';
  future?: boolean;
  children: React.ReactNode;
}) {
  const colorClasses = {
    emerald: 'border-emerald-200 dark:border-emerald-800/50',
    amber: 'border-amber-200 dark:border-amber-800/50',
    violet: 'border-violet-200 dark:border-violet-800/50',
  };

  return (
    <div className={`rounded-lg border p-4 space-y-2 ${colorClasses[color]} ${future ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
        {future && <Badge variant="outline" className="text-[10px] ml-1">Planned</Badge>}
      </div>
      {children}
    </div>
  );
}