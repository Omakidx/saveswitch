"use client";

import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  CANVAS_ZOOM_STEP,
  getCanvasZoomShortcut,
  getHorizontalSwipeNavigation,
  HORIZONTAL_SWIPE_COOLDOWN_MS,
  HORIZONTAL_SWIPE_WINDOW_MS,
  isCanvasEditableTarget,
  type CanvasPageNavigationDirection,
} from "./canvasInteractions";

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
  onNavigatePage?: (direction: CanvasPageNavigationDirection) => void;
  isResourceDragging?: boolean;
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
  onNavigatePage,
  isResourceDragging = false,
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

  const wheelGestureRef = useRef({ x: 0, y: 0, startedAt: 0 });
  const wheelNavigationCooldownRef = useRef(0);

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

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isCanvasEditableTarget(event.target)) return;
      const shortcut = getCanvasZoomShortcut(event);
      if (!shortcut) return;

      event.preventDefault();
      updateView(
        offsetRef.current,
        clampZoom(zoomRef.current + (shortcut === "in" ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP)),
      );
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, updateView]);

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
    if (!isActive || isCanvasEditableTarget(e.target)) return;
    e.preventDefault();
    if (isResourceDragging) return;
    if (e.ctrlKey || e.metaKey) {
      wheelGestureRef.current = { x: 0, y: 0, startedAt: 0 };
      // Zoom
      const delta = e.deltaY * -0.002;
      updateView(offsetRef.current, clampZoom(zoomRef.current + delta));
    } else {
      const now = performance.now();
      const gesture = wheelGestureRef.current;
      if (now - gesture.startedAt > HORIZONTAL_SWIPE_WINDOW_MS) {
        gesture.x = 0;
        gesture.y = 0;
        gesture.startedAt = now;
      }
      gesture.x += e.deltaX;
      gesture.y += e.deltaY;

      const navigationDirection = getHorizontalSwipeNavigation(
        gesture.x,
        gesture.y,
        now - gesture.startedAt,
      );
      if (navigationDirection && onNavigatePage && now >= wheelNavigationCooldownRef.current) {
        wheelNavigationCooldownRef.current = now + HORIZONTAL_SWIPE_COOLDOWN_MS;
        gesture.x = 0;
        gesture.y = 0;
        gesture.startedAt = now;
        onNavigatePage(navigationDirection);
        return;
      }

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
      className="absolute inset-0 overflow-hidden transition-colors duration-500 ease-out"
      style={{
        zIndex: 0,
        touchAction: isActive ? "none" : "auto",
        overscrollBehavior: isActive ? "none" : "auto",
        backgroundColor: isActive ? canvasColor : "transparent",
        backgroundImage: isActive ? "radial-gradient(circle, rgba(0, 0, 0, 0.15) 1.5px, transparent 1.5px)" : "none",
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `calc(50% + ${offset.x}px) calc(50% + ${offset.y}px)`,
        cursor: isActive ? 'url("/icons/cursor-palm.svg") 12 12, move' : undefined,
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
          className="absolute bottom-5 right-5 z-50 flex h-9 items-center gap-0.5 rounded-full border border-white/55 bg-white/[0.28] px-1.5 text-[#2b2b28] shadow-[0_6px_18px_rgba(68,63,42,0.11)] backdrop-blur-2xl"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/45 bg-white/[0.16] text-[#33332f] transition-colors hover:bg-white/[0.48] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff]"
            onClick={() => updateView(offsetRef.current, clampZoom(zoomRef.current - CANVAS_ZOOM_STEP))}
            title="Zoom Out"
            aria-label="Zoom out"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M6 12h12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
            </svg>
          </button>
          <span
            className="inline-grid h-7 min-w-9 place-items-center whitespace-nowrap px-0.5 text-center text-[10px] font-medium leading-none tabular-nums text-[#34342f]"
            aria-label={`Zoom level ${Math.round(zoom * 100)} percent`}
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/45 bg-white/[0.16] text-[#33332f] transition-colors hover:bg-white/[0.48] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff]"
            onClick={() => updateView(offsetRef.current, clampZoom(zoomRef.current + CANVAS_ZOOM_STEP))}
            title="Zoom In"
            aria-label="Zoom in"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
});

InfiniteCanvas.displayName = "InfiniteCanvas";

export default InfiniteCanvas;
