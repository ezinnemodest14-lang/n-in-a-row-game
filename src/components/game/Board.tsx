'use client';

import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { cn } from '@/lib/utils';

// Board color palette
const BOARD_CELL_BG = '#dcb468';
const GRID_LINE_COLOR = '#6b5a3e';
const BOARD_WRAPPER_BG = '#b89860';

export function Board() {
  const {
    board,
    boardSize,
    status,
    playerPiece,
    isThinking,
    isInitializing,
    hoverCell,
    winLine,
    lastMove,
    aiFirstMove,
    setHoverCell,
    makeMove,
  } = useGameStore();

  const isGameOver = status !== 'playing' && status !== 'idle';
  const isPlayerTurn = !isThinking && !isGameOver && status === 'playing';

  // ---- Responsive square sizing: 85% viewport, fits available space ----
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardTarget, setBoardTarget] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0) return;
      // 85% of viewport, but never larger than available space
      const target = Math.floor(Math.min(w, h, 0.85 * window.innerWidth, 0.85 * window.innerHeight));
      setBoardTarget(Math.max(target, 0));
    };

    const observer = new ResizeObserver(() => compute());
    observer.observe(el);
    // Initial + viewport resize
    compute();
    window.addEventListener('resize', compute);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, []);

  // Compute win line set for O(1) lookup
  const winLineSet = useMemo(() => {
    if (!winLine) return new Set<string>();
    return new Set(winLine.map(([r, c]) => `${r},${c}`));
  }, [winLine]);

  const lastMoveKey = lastMove ? `${lastMove[0]},${lastMove[1]}` : null;
  const aiFirstMoveKey = aiFirstMove ? `${aiFirstMove[0]},${aiFirstMove[1]}` : null;

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!isPlayerTurn) return;
      if (board[row][col] !== 0) return;
      makeMove(row, col);
    },
    [isPlayerTurn, board, makeMove]
  );

  // Grid line width adapts to board size
  const gridLineWidth = useMemo(() => {
    if (boardSize <= 5) return 2;
    if (boardSize <= 15) return 1.5;
    return 1;
  }, [boardSize]);

  // Board sizing: boardTarget is computed from available space + 85% viewport cap

  // Show coordinates only for boards <= 15
  const showCoords = boardSize <= 15;
  // Label space
  const labelMargin = showCoords && boardTarget > 0
    ? Math.max(16, Math.min(24, Math.floor(boardTarget * 0.04)))
    : 0;

  // Frame padding around the grid
  const framePad = boardSize <= 5 ? 10 : boardSize <= 15 ? 8 : 5;
  const totalGap = gridLineWidth * (boardSize - 1);

  // Available space for the grid itself
  const gridSpace = boardTarget - labelMargin - framePad * 2;
  const cellSize = Math.max(12, Math.min(64, Math.floor((gridSpace - totalGap) / boardSize)));
  const pieceSize = Math.max(6, Math.floor(cellSize * 0.82));

  const boardPixelW = boardSize * cellSize + totalGap;
  const boardPixelH = boardPixelW; // square

  // Wrapper dimensions include frame padding + label space
  const wrapperW = boardPixelW + framePad * 2 + labelMargin;
  const wrapperH = boardPixelH + framePad * 2 + labelMargin;

  const step = cellSize + gridLineWidth;

  // Show loading overlay while initializing
  const showLoadingOverlay = isInitializing || (status === 'idle' && isThinking);

  // Don't render until we have a container size
  if (boardTarget <= 0) {
    return <div ref={containerRef} className="w-full h-full" />;
  }

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      <div
        className="relative flex-shrink-0"
        style={{
          background: `linear-gradient(145deg, #c9a86c 0%, ${BOARD_WRAPPER_BG} 50%, #a8894e 100%)`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.25)',
          borderRadius: '0.5rem',
          padding: framePad,
          width: wrapperW,
          height: wrapperH,
        }}
      >
        {/* Row labels (left side) */}
        {showCoords && (
          <div
            className="absolute flex flex-col items-center justify-center select-none"
            style={{
              left: 0,
              top: framePad,
              width: labelMargin,
              height: boardPixelH,
              fontSize: Math.max(8, Math.min(12, cellSize * 0.35)),
              color: 'rgba(255,255,255,0.8)',
              fontFamily: 'monospace',
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            {Array.from({ length: boardSize }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-center"
                style={{ height: step, width: '100%' }}
              >
                {boardSize - i}
              </div>
            ))}
          </div>
        )}

        {/* Column labels (bottom) */}
        {showCoords && (
          <div
            className="absolute flex items-center justify-center select-none"
            style={{
              left: labelMargin + framePad,
              bottom: 0,
              width: boardPixelW,
              height: labelMargin,
              fontSize: Math.max(8, Math.min(12, cellSize * 0.35)),
              color: 'rgba(255,255,255,0.8)',
              fontFamily: 'monospace',
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            {Array.from({ length: boardSize }, (_, i) => {
              const letter = String.fromCharCode(65 + (i >= 8 ? i + 1 : i));
              return (
                <div
                  key={i}
                  className="flex items-center justify-center"
                  style={{ width: step, height: '100%' }}
                >
                  {letter}
                </div>
              );
            })}
          </div>
        )}

        {/* Grid container — offset by label margin */}
        <div
          className="relative overflow-hidden"
          style={{
            marginLeft: labelMargin,
            display: 'grid',
            gridTemplateColumns: `repeat(${boardSize}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${boardSize}, ${cellSize}px)`,
            gap: `${gridLineWidth}px`,
            background: GRID_LINE_COLOR,
            borderRadius: '0.125rem',
          }}
        >
          {/* Star points */}
          {boardSize >= 13 && (
            <StarPoints boardSize={boardSize} cellSize={cellSize} gridLineWidth={gridLineWidth} />
          )}

          {/* Loading overlay while game initializes */}
          {showLoadingOverlay && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-amber-800/30 backdrop-blur-[1px] rounded-sm">
              <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              <span className="text-white/80 text-xs mt-2 font-medium">Starting game…</span>
            </div>
          )}

          {board.map((row, r) =>
            row.map((cell, c) => {
              const key = `${r},${c}`;
              const isWinCell = winLineSet.has(key);
              const isLastMove = key === lastMoveKey;
              const isAiFirst = key === aiFirstMoveKey;
              const isHovered = hoverCell?.[0] === r && hoverCell?.[1] === c;
              const isEmpty = cell === 0;
              const isClickable = isPlayerTurn && isEmpty;

              return (
                <button
                  key={key}
                  className={cn(
                    'relative flex items-center justify-center transition-colors duration-100',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1',
                    isClickable && 'cursor-pointer',
                    !isClickable && 'cursor-default',
                    isWinCell && 'z-10',
                  )}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: BOARD_CELL_BG,
                  }}
                  onMouseEnter={() => isClickable && setHoverCell([r, c])}
                  onMouseLeave={() => setHoverCell(null)}
                  onClick={() => handleCellClick(r, c)}
                  aria-label={
                    cell === 0
                      ? `Empty cell row ${r + 1} column ${c + 1}`
                      : cell === playerPiece
                        ? `Your piece at row ${r + 1} column ${c + 1}`
                        : `AI piece at row ${r + 1} column ${c + 1}`
                  }
                >
                  {/* Piece */}
                  {cell !== 0 && (
                    <div
                      className={cn(
                        'rounded-full transition-transform duration-150 shadow-md',
                        cell === playerPiece
                          ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-900/30'
                          : 'bg-gradient-to-br from-gray-700 to-gray-900 shadow-gray-900/40',
                        isWinCell && 'ring-2 ring-amber-400 ring-offset-1 ring-offset-amber-700/20 scale-110 animate-pulse',
                        isLastMove && !isWinCell && 'ring-2 ring-white/70',
                        isAiFirst && !isWinCell && 'ring-2 ring-white/50',
                      )}
                      style={{ width: pieceSize, height: pieceSize }}
                    />
                  )}

                  {/* Hover ghost piece */}
                  {isEmpty && isHovered && isClickable && (
                    <div
                      className={cn(
                        'rounded-full opacity-30 pointer-events-none',
                        playerPiece === 1
                          ? 'bg-emerald-500'
                          : 'bg-gray-700'
                      )}
                      style={{ width: pieceSize, height: pieceSize }}
                    />
                  )}

                  {/* Last move indicator dot */}
                  {isLastMove && !isWinCell && cell !== 0 && (
                    <div
                      className={cn(
                        'absolute rounded-full z-20',
                        cell === playerPiece ? 'bg-emerald-200' : 'bg-gray-300'
                      )}
                      style={{ width: Math.max(4, pieceSize * 0.28), height: Math.max(4, pieceSize * 0.28) }}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>


    </div>
  );
}

/** Star points for Go/Gomoku-style boards */
function StarPoints({ boardSize, cellSize, gridLineWidth }: { boardSize: number; cellSize: number; gridLineWidth: number }) {
  const points = useMemo(() => {
    const pts: [number, number][] = [];
    if (boardSize === 15 || boardSize === 13) {
      const corners = boardSize === 15
        ? [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7], [3, 7], [7, 3], [7, 11], [11, 7]]
        : [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
      for (const [r, c] of corners) {
        if (r < boardSize && c < boardSize) pts.push([r, c]);
      }
    } else if (boardSize === 19) {
      const starCoords = [3, 9, 15];
      for (const r of starCoords) {
        for (const c of starCoords) {
          pts.push([r, c]);
        }
      }
    }
    return pts;
  }, [boardSize]);

  const step = cellSize + gridLineWidth;
  const dotSize = Math.max(3, Math.min(6, cellSize * 0.12));

  return (
    <>
      {points.map(([r, c], i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none z-0"
          style={{
            width: dotSize,
            height: dotSize,
            background: GRID_LINE_COLOR,
            left: c * step + cellSize / 2 - dotSize / 2,
            top: r * step + cellSize / 2 - dotSize / 2,
          }}
        />
      ))}
    </>
  );
}
