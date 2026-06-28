"use client";

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface InfiniteCanvasRef {
  panTo: (x: number, y: number) => void;
  getViewState: () => CanvasViewState;
  setViewState: (state: CanvasViewState) => void;
}

export interface CanvasViewState {
  offset: { x: number; y: number };
  zoom: number;
}

interface InfiniteCanvasProps {
  children: React.ReactNode;
  isActive: boolean;
  canvasColor?: string;
  canvasOffsetRef?: React.MutableRefObject<{ x: number, y: number }>;
}

const InfiniteCanvas = forwardRef<InfiniteCanvasRef, InfiniteCanvasProps>(({
  children,
  isActive,
  canvasColor = "var(--color-app-bg)",
  canvasOffsetRef,
}, ref) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimatingToTarget, setIsAnimatingToTarget] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const animationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset offset when toggling canvas mode off
  useEffect(() => {
    if (!isActive) {
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      if (canvasOffsetRef) canvasOffsetRef.current = { x: 0, y: 0 };
    }
  }, [isActive, canvasOffsetRef]);

  useImperativeHandle(ref, () => ({
    panTo: (x: number, y: number) => {
      setIsAnimatingToTarget(true);
      if (animationTimeout.current) clearTimeout(animationTimeout.current);

      // A typical resource card is 300px wide and around 200px tall
      // Center it perfectly using half dimensions
      const targetOffset = {
        x: window.innerWidth / 2 - (x + 150),
        y: window.innerHeight / 2 - (y + 100),
      };
      setOffset(targetOffset);
      setZoom(1); // Optional: reset zoom to 1 when panning to a specific resource
      if (canvasOffsetRef) canvasOffsetRef.current = targetOffset;

      animationTimeout.current = setTimeout(() => {
        setIsAnimatingToTarget(false);
      }, 800); // 800ms matches the transition duration
    },
    getViewState: () => ({ offset, zoom }),
    setViewState: (state: CanvasViewState) => {
      setOffset(state.offset);
      setZoom(state.zoom);
      if (canvasOffsetRef) canvasOffsetRef.current = state.offset;
    },
  }));

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isActive) return;
    setIsDragging(true);
    startPos.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !isActive) return;
    const newOffset = {
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    };
    setOffset(newOffset);
    if (canvasOffsetRef) canvasOffsetRef.current = newOffset;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isActive) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!isActive) return;
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = e.deltaY * -0.002;
      setZoom((z) => Math.min(Math.max(z + delta, 0.2), 3));
    } else {
      // Pan
      const newOffset = {
        x: offset.x - e.deltaX,
        y: offset.y - e.deltaY,
      };
      setOffset(newOffset);
      if (canvasOffsetRef) canvasOffsetRef.current = newOffset;
    }
  };

  return (
    <div
      className={`absolute inset-0 overflow-hidden transition-colors duration-500 ease-out ${
        isActive ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        zIndex: 0,
        backgroundColor: isActive ? canvasColor : "transparent",
        backgroundImage: isActive ? "radial-gradient(circle, rgba(0, 0, 0, 0.15) 1.5px, transparent 1.5px)" : "none",
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `calc(50% + ${offset.x}px) calc(50% + ${offset.y}px)`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          transition: isAnimatingToTarget ? "transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)" : (isDragging || isActive ? "none" : "transform 0.5s ease-out"),
        }}
      >
        <div 
          className="transition-all duration-300 ease-out origin-center"
          style={{ 
            transform: isActive ? `scale(${zoom})` : "scale(1)",
            width: "100%",
            height: "100%"
          }}
        >
          {children}
        </div>
      </div>

      {/* ── Zoom Controls ── */}
      {isActive && (
        <div 
          className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-[20px] border border-white/10 bg-[#1D1D1D] px-2 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:bottom-8 sm:gap-3"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <button 
            type="button"
            className="w-8 h-8 rounded-full hover:bg-white/10 text-white flex items-center justify-center font-bold text-lg cursor-pointer"
            onClick={() => setZoom(z => Math.max(z - 0.1, 0.2))}
            title="Zoom Out"
            aria-label="Zoom out"
          >
            -
          </button>
          <span className="text-white font-medium min-w-[3.5rem] text-center text-[13px]">
            {Math.round(zoom * 100)}%
          </span>
          <button 
            type="button"
            className="w-8 h-8 rounded-full hover:bg-white/10 text-white flex items-center justify-center font-bold text-lg cursor-pointer"
            onClick={() => setZoom(z => Math.min(z + 0.1, 3))}
            title="Zoom In"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
});

InfiniteCanvas.displayName = "InfiniteCanvas";

export default InfiniteCanvas;
