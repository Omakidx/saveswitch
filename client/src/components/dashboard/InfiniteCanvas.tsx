"use client";

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

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

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;

function clampZoom(value: number) {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function getPointerDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getPointerMidpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
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
  const containerRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const animationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(offset);
  const zoomRef = useRef(zoom);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragPointerIdRef = useRef<number | null>(null);
  const pinchStartRef = useRef<{
    distance: number;
    midpoint: { x: number; y: number };
    offset: { x: number; y: number };
    zoom: number;
  } | null>(null);

  const updateView = useCallback((nextOffset: { x: number; y: number }, nextZoom = zoomRef.current) => {
    offsetRef.current = nextOffset;
    zoomRef.current = nextZoom;
    setOffset(nextOffset);
    setZoom(nextZoom);
    if (canvasOffsetRef) canvasOffsetRef.current = nextOffset;
  }, [canvasOffsetRef]);

  const getViewportCenter = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  };

  const beginPinchGesture = () => {
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length < 2) {
      pinchStartRef.current = null;
      return;
    }

    const [first, second] = pointers;
    pinchStartRef.current = {
      distance: Math.max(getPointerDistance(first, second), 1),
      midpoint: getPointerMidpoint(first, second),
      offset: { ...offsetRef.current },
      zoom: zoomRef.current,
    };
  };

  // Reset offset when toggling canvas mode off
  useEffect(() => {
    if (!isActive) {
      activePointersRef.current.clear();
      dragPointerIdRef.current = null;
      pinchStartRef.current = null;
      setIsDragging(false);
      updateView({ x: 0, y: 0 }, 1);
    }
  }, [isActive, updateView]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

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
      updateView(targetOffset, 1);

      animationTimeout.current = setTimeout(() => {
        setIsAnimatingToTarget(false);
      }, 800); // 800ms matches the transition duration
    },
    getViewState: () => ({ offset: offsetRef.current, zoom: zoomRef.current }),
    setViewState: (state: CanvasViewState) => {
      updateView(state.offset, clampZoom(state.zoom));
    },
  }));

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isActive) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);

    if (activePointersRef.current.size >= 2) {
      dragPointerIdRef.current = null;
      setIsDragging(false);
      beginPinchGesture();
      return;
    }

    dragPointerIdRef.current = e.pointerId;
    setIsDragging(true);
    startPos.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isActive || !activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size >= 2) {
      if (!pinchStartRef.current) beginPinchGesture();
      const pinchStart = pinchStartRef.current;
      if (!pinchStart) return;

      const pointers = Array.from(activePointersRef.current.values());
      const [first, second] = pointers;
      const midpoint = getPointerMidpoint(first, second);
      const distance = Math.max(getPointerDistance(first, second), 1);
      const nextZoom = clampZoom(pinchStart.zoom * (distance / pinchStart.distance));
      const viewportCenter = getViewportCenter();
      const contentPoint = {
        x: (pinchStart.midpoint.x - viewportCenter.x - pinchStart.offset.x) / pinchStart.zoom,
        y: (pinchStart.midpoint.y - viewportCenter.y - pinchStart.offset.y) / pinchStart.zoom,
      };
      const nextOffset = {
        x: midpoint.x - viewportCenter.x - contentPoint.x * nextZoom,
        y: midpoint.y - viewportCenter.y - contentPoint.y * nextZoom,
      };
      updateView(nextOffset, nextZoom);
      return;
    }

    if (!isDragging || dragPointerIdRef.current !== e.pointerId) return;
    const newOffset = {
      x: e.clientX - startPos.current.x,
      y: e.clientY - startPos.current.y,
    };
    updateView(newOffset);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isActive) return;
    activePointersRef.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (activePointersRef.current.size >= 2) {
      beginPinchGesture();
      return;
    }

    pinchStartRef.current = null;

    const remainingPointer = Array.from(activePointersRef.current.entries())[0];
    if (remainingPointer) {
      const [pointerId, pointer] = remainingPointer;
      dragPointerIdRef.current = pointerId;
      startPos.current = { x: pointer.x - offsetRef.current.x, y: pointer.y - offsetRef.current.y };
      setIsDragging(true);
      return;
    }

    dragPointerIdRef.current = null;
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!isActive) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = e.deltaY * -0.002;
      updateView(offsetRef.current, clampZoom(zoomRef.current + delta));
    } else {
      // Pan
      const newOffset = {
        x: offsetRef.current.x - e.deltaX,
        y: offsetRef.current.y - e.deltaY,
      };
      updateView(newOffset);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden transition-colors duration-500 ease-out ${
        isActive ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        zIndex: 0,
        touchAction: isActive ? "none" : "auto",
        overscrollBehavior: isActive ? "none" : "auto",
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
            onClick={() => updateView(offsetRef.current, clampZoom(zoomRef.current - 0.1))}
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
            onClick={() => updateView(offsetRef.current, clampZoom(zoomRef.current + 0.1))}
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
