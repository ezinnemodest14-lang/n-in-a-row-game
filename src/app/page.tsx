'use client';

// ============================================================================
// N-in-a-Row — page composition.
// Layout law (v3, per user: "board no longer 85% viewport / analysis doesn't
// show on hover"):
// - The Board self-caps at 85vw/85vh (Board.tsx ResizeObserver), so bottom
//   chrome stays minimal: BottomPanel renders a slim ~32px status strip in
//   flow below the board → the board keeps ≥85% of the viewport in play.
// - The full analysis is a translucent acrylic overlay that rises ABOVE the
//   strip (inside BottomPanel), shown on HOVER only (eval bar, strip, or
//   pinned). It never auto-opens after moves — gameplay stays uncovered.
// - QuickPreview keeps the v1 auto-peek on the right edge: after every move
//   it shows for previewDuration seconds (0 = stays until the pointer leaves).
// - Hover persistence: leaving any trigger closes after a 180ms grace delay,
//   so moving between eval bar ↔ board ↔ strip ↔ overlay never flickers.
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

  // ---- peek state machine ----
  const [hoveredEval, setHoveredEval] = useState(false);     // eval bar hover → full mode
  const [hoveredBottom, setHoveredBottom] = useState(false); // strip/overlay hover
  const [pinEval, setPinEval] = useState(false);             // eval-bar click → pins BOTH panels
  const [pinBottom, setPinBottom] = useState(false);         // strip click → pins bottom overlay only
  const [autoPeek, setAutoPeek] = useState(false);           // QuickPreview only
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootedRef = useRef(false);

  const clearPeekTimer = useCallback(() => {
    if (peekTimer.current) {
      clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
  }, []);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Grace-delayed close: moving between triggers never flickers. Pins are
  // deliberately NOT cleared here — pinning means "stay open until I click
  // again"; hover/leave only governs the transient states.
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setHoveredEval(false);
      setHoveredBottom(false);
      setAutoPeek(false);
      clearPeekTimer();
    }, 180);
  }, [cancelClose, clearPeekTimer]);

  const openEval = useCallback(() => {
    cancelClose();
    setHoveredEval(true);
  }, [cancelClose]);

  const openBottom = useCallback(() => {
    cancelClose();
    setHoveredBottom(true);
  }, [cancelClose]);

  // Strip click: pin/unpin the bottom analysis overlay ONLY (no QuickPreview —
  // on touch devices this keeps the playing area readable while studying).
  const togglePinBottom = useCallback(() => {
    cancelClose();
    setPinBottom((p) => !p);
  }, [cancelClose]);

  // Eval-bar click: full mode — pins BOTH the QuickPreview and the overlay.
  const togglePinEval = useCallback(() => {
    cancelClose();
    setPinEval((p) => {
      const next = !p;
      if (next) clearPeekTimer();
      return next;
    });
  }, [cancelClose, clearPeekTimer]);

  // Edge-detect moveTriggered via subscribe — never setState in render.
  // Auto-peek drives the QuickPreview ONLY; the analysis overlay stays
  // hover-driven so the board is never covered during play.
  useEffect(() => {
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
      cancelClose();
    };
  }, [clearPeekTimer, cancelClose]);

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

  // QuickPreview: eval hover, eval pin, or post-move auto-peek (v1).
  // BottomPanel: eval hover/pin, strip hover, or strip pin (hover-driven).
  const previewVisible = hoveredEval || pinEval || autoPeek;
  const bottomVisible = hoveredEval || pinEval || hoveredBottom || pinBottom;

  // ---- boot: start a game on first mount (guarded against StrictMode double-invoke) ----
  useEffect(() => {
    const s = useGameStore.getState();
    if (s.status === 'idle' && !s.isInitializing && s.moveHistory.length === 0 && !bootedRef.current) {
      bootedRef.current = true;
      void s.newGame();
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(ellipse_at_top,#faf6ee_0%,#f3ecdd_55%,#ece2cc_100%)] dark:bg-[radial-gradient(ellipse_at_top,#1c1917_0%,#292524_60%,#1c1917_100%)]">
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} onOpenStats={() => setStatsOpen(true)} />

      <main className="flex-1 relative min-h-0 overflow-hidden px-2 py-1 flex flex-col gap-1">
        {/* Board container — the ONLY flex-1 anchor. The Board caps itself at
            85vw/85vh; with the slim strip below, that cap is what sizes it. */}
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
              onMouseEnter={openEval}
              onMouseLeave={scheduleClose}
              onClick={togglePinEval}
              role="presentation"
            >
              <QuickPreview visible={previewVisible} />
              <EvalBar isSidePanelVisible={previewVisible} />
            </div>
          </div>
        </div>

        {/* Slim status strip — in flow BELOW the board (~32px). Hovering it
            (or the eval bar, or clicking to pin) reveals the analysis
            overlay, which rises ABOVE the strip over the board's lower edge. */}
        <BottomPanel
          visible={bottomVisible}
          onHoverEnter={openBottom}
          onHoverLeave={scheduleClose}
          onTogglePin={togglePinBottom}
        />
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
