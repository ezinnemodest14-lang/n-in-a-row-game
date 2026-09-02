# Project Worklog

---
Task ID: 1
Agent: Z.ai Code (main orchestrator + Explore subagent 54e05188)
Task: Study the two uploaded artifacts — `n-in-a-row-game.zip` (Next.js UI layer) and `Pasted Content_1788378919328.txt` (single-file game engine + UI), and conduct supporting research.

Work Log:
- Extracted `n-in-a-row-game.zip` to `/home/z/my-project/upload/extracted/` (contains only `src/components/game/*` (8 components), `src/components/ui/*` (35 shadcn files), `src/hooks/*` (2 files)).
- Read all 8 game components + 2 hooks fully (4,636 lines total across both artifacts).
- Read the 1,801-line pasted txt file completely in 4 chunks.
- Ran 6 web searches on: MCTS+RAVE, threat-space search (VCF/VCT), alpha-beta vs MCTS, Gomoku eval functions, transposition tables/Zobrist, AlphaZero/curriculum transfer for Gomoku.

Stage Summary:
- TXT FILE = a complete self-contained N-in-a-Row game (engine + inline-styled dark UI, default export `GomokuGame`): Int8Array flat board; Classic (winLen) + Score Attack (SCORE_WEIGHTS triple:1 four:5 five:15 fullRow/Col:10 fullDiag:20 cross:3 linebreak:2) modes; threat classifier CAT 0–8 with CAT_VALUE {0:0,1:5,2:50,3:300,4:1200,5:3000,6:8000,7:20000,8:1000000}; `tacticalMove` safety net (win→block-win→open-four→block-four→block-open-four→fork→block-open-three); GlobalRAVE persistent table (Float64Array per player, decay 0.9 on config switch, JSON-serializable); MCTS+RAVE (mulberry32 RNG, raveBeta=√(C/(3v+C)) C=220, threat-prior progressive bias at root priorWeight 0.9, tactical override after search, sims default 1500 + 1500ms cap); trainGames self-play seeding (no tree, no decay, explicit RAVE updates); references "rebuild-spec bugs" (#4, #15, #17) — a prior rebuild spec exists with known pitfalls. UI: win prob derived (player = 100 − ai, bug #17), auto-peek panel state machine, board sizing via ResizeObserver, gameGenRef stale-AI-result guard.
- ZIP = the polished Next.js 16 rewrite UI layer of the same game, consuming a MISSING zustand `@/store/game-store` (useGameStore with getState), MISSING `@/lib/game/threat-classifier` (coordLabel + PlayerBestMove/CriticalSquare/ScoringAnalysis types), MISSING `lib/utils` cn, MISSING `ui/button.tsx` + `ui/toggle-group.tsx`, and app shell (layout/page/globals.css/tailwind config with xs breakpoint + scrollbar-thin).
- ZIP upgrades vs TXT: 14-section collapsible acrylic analysis panel, QuickPreview side-dock, EvalBar vertical column, Go-style coords (skip I), star points ≥13, Board 3–24 vs TXT 5–15 (step 2), sims 100–50k vs 200–6k, Auto Mode, AI-vs-AI training across sizes, crossGameLearning inheritance, learningHistory telemetry, framer-motion, a11y (aria/tooltip/focus), wooden board w/ ghost hover.
- Known UI bugs found: AiMoveRow hardcodes boardSize 15 for coordLabel; contradictory scoring rule text (Settings +1/+5/+15 vs RulesSection "3/4/5 per line"); non-default Tailwind classes (xs:, z-5, scrollbar-thin) silently no-op without config; unused imports; full-store destructuring re-renders all cells on hover.
- Research conclusions: MCTS+RAVE validated (Gelly & Silver 2007; Rimmel et al. 2010); tacticalMove safety net ≈ simplified threat-space search — literature (Allis 1994 TSS, VCF/VCT pruning, UCT progressive bias Cao 2019) suggests deeper VCF/VCT as next upgrade; Rapfi (arXiv) shows compact NN eval beats CNN in limited compute — validates planned "Layer 3 curriculum evaluator"; AlphaZero-style transfer small→large board is a proven path.
- Artifacts: research report delivered in chat; extracted source at `upload/extracted/`.

---
Task ID: 3
Agent: Z.ai Code (main orchestrator)
Task: Study the third artifact — the previous session's full conversation log (Pasted Content_1788379011037.txt, 990 lines) which IS the implementation plan for this project.

Work Log:
- Read all 990 lines of the conversation log completely.
- Cross-referenced its claims against the zip components (verified: QuickPreview/EvalBar/BottomPanel/14-section AnalysisPanel all match what the log describes building).
- Distilled the complete implementation plan (see Stage Summary).

Stage Summary:
FULL HISTORY RECOVERED. The previous session (GLM-5-Turbo) built a ~12,334-line / 70+ file Next.js game. Our zip only contains its UI layer — everything else must be replicated:

1. BACKEND ARCHITECTURE (from the plan):
   - Next.js app port 3000: API routes /api/game/new, /api/game/move, /api/game/train (flat body params).
   - Prisma + SQLite persists RAVE tables server-side (keyed like rave_15_classic). Pre-trained: 1.3M+ total visits (86K+ for 15×15 classic, 540K for 15×15 scoring).
   - Neural network MINI-SERVICE port 3020: MLP 40→128(ReLU)→64(ReLU)→1(Sigmoid), 10,305 params, pure TS, Adam, weights in nn-model-weights.json (125KB). Files: mini-services/nn-service/{features.ts, neural-net.ts, index.ts} + src/lib/{neural-server.ts, neural-client.ts}.
   - Move route blends NN with MCTS: 60% MCTS + 40% NN; AI reasoning text appends "NN eval: XX.X%". Graceful fallback if NN service down.

2. AI v3 SPEC (from the plan):
   - Threat classifier: off-by-one fix (totalConsec = a+b+1 — includes the cell itself); gap patterns X_XX / XX_XX detected; fork detection catches double same-type threats + double-open-three (guaranteed win); closed four = dead not SIMPLE_FOUR; half-open three = SIMPLE_THREE not OPEN_THREE.
   - Scoring: open four 8000, fork 7000, block fork 6000, block-four 900, block-open-four 800, fork bonus +600, +20 per extra threat direction; strategic bonuses 8000 double-open-three / 5000 open four / 3000 fork.
   - MCTS playout priority: win > open four > block win > fork > block fork. MoveFeatures fields: createsFork, createsOpenFour, blocksFork, threatDirections, forkPotential.
   - Tactical safety net (move route): forcedWin > forcedBlock > forkBlock > MCTS bestMove; fork-block prefers cells in MCTS top-5.
   - Training engine v3: gap-aware analyzeMove(), 4 tactical tiers, temperature 3.5 (down from 5.0), randomness 12 (down from 20); ~2,800 games trained; balance P1 53%/P2 46%.

3. UI ARCHITECTURE RULES (user's explicit requirements — MUST honor):
   - Board ALWAYS ≥85% viewport; NO UI element may shrink/push it (F.1/F.2 rule).
   - QuickPreview + BottomPanel are ABSOLUTE translucent acrylic OVERLAYS inside the relative board container (QuickPreview: right-0 top-0 bottom-0 z-20; BottomPanel: left-0 right-0 bottom-0 z-10, maxH 72%, blur 14px) — board never moves.
   - Auto-peek state machine: after any move both panels show for peekDurationMs (default 2200ms) then auto-dismiss; 3 triggers: hovered || pinned || autoPeek; store.moveTriggered detected via useGameStore.subscribe() edge detection (NOT setState-in-effect, passes lint); hover persistence: hovering panel keeps it open; leaving resets hovered+pinned+autoPeek; tap toggles pinned.
   - EvalBar: verbose, colors MUST match player dots (emerald green = player, black/slate = AI), handle dot at win-prob boundary, gradient player dots, floating score badge, thinking pulse dot, responsive.
   - Analysis sections NON-collapsible when panel expanded (all visible); REASON_TEXT natural-language mapping; CategoryChip threat badges; Peek Duration slider (0 = always visible).
   - Cross-cutting: acrylic bg-white/60-70 backdrop-blur-2xl border-white/40; wooden board theme.

4. FINAL UNFINISHED USER REQUESTS (the tail of the conversation — must address in the rebuild):
   - Fix the "jiggle" when the side panel opens → smoother spring/animation (fluidity).
   - Make the side panel MORE TRANSPARENT but still profound / matching the board's wooden theme.
   - EvalBar: use playing-dot colors (black + green), more verbose, fit the board theme.

5. KNOWN OPERATIONAL GOTCHAS (from the plan): sandbox kills background servers between tool calls → start server + verify in single chained commands; store has auto-recovery for server death; lint had pre-existing require() errors in train-ai.ts/server-games.ts.

6. REPLICATION BLUEPRINT (what to build in /home/z/my-project):
   - src/lib/game/: types.ts, threat-classifier.ts (v3), mcts.ts (v3), training-engine.ts (v3), scoring.ts — port from txt engine + apply v3 spec + keep all bug lessons (#15 sign, #17 derived win%, #4 zero-decay training).
   - src/store/game-store.ts: zustand store with full contract from zip components + peekDurationMs/previewDuration, analysisAutoCollapse, moveTriggered, crossGameLearning, training state, auto-recovery.
   - src/app/api/game/{new,move,train}/route.ts + prisma schema (RaveTable model) with db push.
   - mini-services/nn-service/ on port 3020 (Bun, --hot) + src/lib/neural-*.ts client integration (60/40 blend, graceful fallback).
   - Copy zip's 8 UI components + 35 shadcn ui + hooks into src/; add MISSING ui/button.tsx + ui/toggle-group.tsx; fix AiMoveRow hardcode-15 bug; reconcile scoring rule text (+1/+5/+15 per SCORE_WEIGHTS).
   - src/app/page.tsx: overlay composition + auto-peek machine + hover persistence; layout.tsx + globals.css (theme vars, xs breakpoint, scrollbar-thin, dark mode).
   - Style refinements per user's final message: no-jiggle animation (opacity+transform only, spring stiffness↑ damping↑), higher-transparency acrylic panels, black+green eval bar w/ board-theme accents, verbose labels.
   - Train RAVE via API after build; verify end-to-end in Agent Browser (board renders, move → AI reply, panels peek/hover/pin, eval bar, training).
