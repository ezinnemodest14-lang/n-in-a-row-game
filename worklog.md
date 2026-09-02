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
