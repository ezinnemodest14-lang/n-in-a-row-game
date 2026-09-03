'use client';

// ============================================================================
// N-in-a-Row — page composition.
// Layout law (v2, per user request "the analysis still blocks the board"):
// NOTHING may overlay the board. QuickPreview remains a translucent acrylic
// overlay floating over the board's right edge (hover/peek only), while the
// BottomPanel is DOCKED BELOW the board in normal flow — when the analysis
// expands, the board's ResizeObserver shrinks it smoothly. The board is
// never covered.
// Auto-peek state machine: after any move the QuickPreview shows for
// previewDuration seconds (0 = stay), then auto-dismiss. Three expansion
// triggers: hovered || pinned || autoPeek. Hover persistence: hovering a
// panel keeps it open; leaving resets all three; tapping toggles pinned.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Toolbar } from '@/components/game/Toolbar';
import { Board } from '@/components/game/Board';
import { EvalBar } from '@/components/game/EvalBar';
import { QuickPreview } from '@/components/game/QuickPreview';
import { BottomPanel } from '@/components/game/AnalysisPanel';
import { SettingsContent } from '@/components/game/Settings';
import { GameInfoContent } from '@/components/game/GameInfo';
import { ArchInfo } from '@/components/game/ArchInfo';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useGameStore } from '@/store/game-store';

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  // ---- auto-peek state machine ----
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [autoPeek, setAutoPeek] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const clearPeekTimer = useCallback(() => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  }, []);

  // Edge-detect moveTriggered via subscribe — never setState in render.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
    }
    const unsub = useGameStore.subscribe((state, prev) => {
      if (state.moveTriggered !== prev.moveTriggered && state.moveTriggered > 0) {
        setAutoPeek(true);
        clearPeekTimer();
        const dur = useGameStore.getState().previewDuration;
        if (dur > 0) {
          peekTimer.current = setTimeout(() => setAutoPeek(false), dur * 1000);
        }
      }
    });
    return () => {
      unsub();
      clearPeekTimer();
    };
  }, [clearPeekTimer]);

  // Re-arm the peek timer if the user changes the duration mid-peek.
  useEffect(() => {
    const unsub = useGameStore.subscribe((state, prev) => {
      if (state.previewDuration !== prev.previewDuration && autoPeek) {
        clearPeekTimer();
        if (state.previewDuration > 0) {
          peekTimer.current = setTimeout(() => setAutoPeek(false), state.previewDuration * 1000);
        }
      }
    });
    return unsub;
  }, [autoPeek, clearPeekTimer]);

  const previewVisible = hovered || pinned || autoPeek;

  const handleEvalEnter = useCallback(() => setHovered(true), []);
  const handleEvalLeave = useCallback(() => {
    setHovered(false);
    setPinned(false);
    clearPeekTimer();
    setAutoPeek(false);
  }, [clearPeekTimer]);
  const handleEvalTap = useCallback(() => {
    setPinned((p) => {
      const next = !p;
      if (next) clearPeekTimer();
      return next;
    });
  }, [clearPeekTimer]);

  // ---- boot: start a game on first mount (guarded against StrictMode double-invoke) ----
  useEffect(() => {
    const s = useGameStore.getState();
    if (s.status === 'idle' && !s.isInitializing && s.moveHistory.length === 0 && !bootedRef.current) {
      bootedRef.current = true;
      void s.newGame();
    }
  }, []);
  const bootedRef = useRef(false);

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,#faf6ee_0%,#f3ecdd_55%,#ece2cc_100%)] dark:bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#292524_60%,#1c1917_100%)]">
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} onOpenStats={() => setStatsOpen(true)} />

      <main className="flex-1 relative min-h-0 overflow-hidden px-2 py-2 flex flex-col gap-1.5">
        {/* Board container — the ONLY layout anchor. main is display:flex
            (column) so this child gets a DEFINITE stretched height — the
            Board's ResizeObserver always measures real pixels. */}
        <div className="relative w-full flex-1 min-h-0">
          <div className="absolute inset-0 flex items-stretch justify-center gap-1.5 sm:gap-2.5 pb-0.5 pt-1">
            {/* Board zone: fills remaining width, definite height */}
            <div className="relative flex-1 min-w-0 h-full">
              <Board />
            </div>
            {/* Eval zone — hover anchor; QuickPreview docks left of it as an
                absolute overlay (right: 100%) floating OVER the board */}
            <div
              className="relative flex flex-col justify-center flex-shrink-0"
              onMouseEnter={handleEvalEnter}
              onMouseLeave={handleEvalLeave}
              onClick={handleEvalTap}
              role="presentation"
            >
              <QuickPreview visible={previewVisible} />
              <EvalBar isSidePanelVisible={previewVisible} />
            </div>
          </div>
        </div>

        {/* Analysis dock — in normal flow BELOW the board. The board's
            ResizeObserver shrinks it smoothly when the analysis expands;
            nothing ever covers the playing area. */}
        <BottomPanel />
      </main>

      {/* Sheets */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <SettingsContent />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={statsOpen} onOpenChange={setStatsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Stats &amp; History</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <GameInfoContent />
          </div>
        </SheetContent>
      </Sheet>

      <ArchInfo />
    </div>
  );
}
